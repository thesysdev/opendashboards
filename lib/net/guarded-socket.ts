import "server-only";

import dns, { type LookupAddress, type LookupAllOptions, type LookupOneOptions } from "node:dns";
import net from "node:net";

import ipaddr from "ipaddr.js";

/**
 * SSRF protection for connections to hosts a user typed in (a Postgres
 * server, say). Only public unicast addresses are allowed: never private
 * networks, loopback, link-local (cloud metadata at 169.254.169.254), CGNAT,
 * multicast, reserved ranges, or IPv6 forms that tunnel to IPv4 (NAT64,
 * 6to4, Teredo).
 *
 * The check runs inside the socket's own DNS lookup, on the addresses it is
 * about to connect to, so a hostname can't pass a check and then resolve
 * somewhere else (DNS rebinding).
 */

/** The host resolves to an address we refuse to connect to. */
export class BlockedAddressError extends Error {
  constructor(
    readonly host: string,
    readonly address: string,
  ) {
    super(`Refusing to connect to ${host}: ${address} is not a public address`);
    this.name = "BlockedAddressError";
  }
}

/**
 * Local development can allow private and loopback hosts (a database in
 * Docker) with PRISM_DEV_ALLOW_LOCAL_DATABASES=true. Production ignores it.
 */
export function localHostsAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== "production" && env.PRISM_DEV_ALLOW_LOCAL_DATABASES === "true";
}

/** Whether an IP address (v4 or v6, as a string) is a public unicast address. */
export function isPublicAddress(address: string): boolean {
  if (!net.isIP(address)) return false;
  let parsed = ipaddr.parse(address);
  // ::ffff:10.0.0.1 is 10.0.0.1: judge the IPv4 address it carries.
  if (parsed.kind() === "ipv6" && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
    parsed = (parsed as ipaddr.IPv6).toIPv4Address();
  }
  return parsed.range() === "unicast";
}

function isAllowed(address: string, allowLocal: boolean): boolean {
  if (isPublicAddress(address)) return true;
  if (!allowLocal || !net.isIP(address)) return false;
  // Development: private networks and loopback, but still never link-local
  // or anything else (metadata endpoints stay unreachable).
  let parsed = ipaddr.parse(address);
  if (parsed.kind() === "ipv6" && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
    parsed = (parsed as ipaddr.IPv6).toIPv4Address();
  }
  return ["private", "loopback", "uniqueLocal"].includes(parsed.range());
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/**
 * A `dns.lookup` replacement for `net.connect`: resolves every address and
 * fails if any of them is blocked, so a host can't mix a public and a private
 * address and hope for the latter.
 */
export function createGuardedLookup(allowLocal = localHostsAllowed()) {
  return function guardedLookup(
    hostname: string,
    options: LookupOneOptions | LookupAllOptions,
    callback: LookupCallback,
  ): void {
    dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error, []);
      const blocked = addresses.find(({ address }) => !isAllowed(address, allowLocal));
      if (blocked) return callback(new BlockedAddressError(hostname, blocked.address), []);
      if (!addresses.length) {
        return callback(Object.assign(new Error(`No addresses for ${hostname}`), { code: "ENOTFOUND" }), []);
      }
      if ((options as LookupAllOptions).all) return callback(null, addresses);
      callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

/**
 * A TCP socket that only connects to allowed addresses. Pass it to drivers
 * that accept a custom socket (pg's `stream` option): they call
 * `socket.connect(port, host)`, which this routes through the guarded lookup.
 * TLS upgrades still see the original hostname, so certificate checks work.
 */
export function createGuardedSocket(allowLocal = localHostsAllowed()): net.Socket {
  const socket = new net.Socket();
  const connect = socket.connect.bind(socket) as (options: net.TcpNetConnectOpts) => net.Socket;
  const lookup = createGuardedLookup(allowLocal);

  socket.connect = ((port: number, host: string) => {
    // Node skips the lookup for IP literals, so check those directly.
    if (net.isIP(host) && !isAllowed(host, allowLocal)) {
      process.nextTick(() => socket.destroy(new BlockedAddressError(host, host)));
      return socket;
    }
    return connect({ port, host, lookup: lookup as net.LookupFunction });
  }) as typeof socket.connect;

  return socket;
}
