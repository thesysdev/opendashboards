"use client";

import { ExternalLinkIcon, Loader2Icon, TriangleAlertIcon, UploadIcon } from "lucide-react";
import { Fragment, useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { createConnectionAction, replaceCredentialAction, startMcpSignInAction } from "@/app/(app)/connections/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { connectionNameSchema } from "@/lib/connections/schemas";
import { MCP_SERVICES, type McpAuth, type McpServiceKey } from "@/lib/sources/mcp/services";

import { CertificateCheckField } from "./certificate-check-field";
import { showConnectionWarnings } from "./connection-feedback";
import type { SecretMode } from "./connection-form-dialog";
import { mcpPresetForm, SOURCE_FORMS, type FieldSpec } from "./source-forms";

export type FormSourceType = keyof typeof SOURCE_FORMS;

type Props = {
  type: FormSourceType;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  secretMode: SecretMode;
  /** With type "mcp": a known server from the catalog, whose endpoint is fixed. */
  service?: McpServiceKey;
} & (
  | { mode: "create"; /** Called with the new connection's id once it's saved. */ onCreated?: (id: string) => void }
  | { mode: "replace"; connection: { id: string; name: string } }
);

/** Adds a MySQL, ClickHouse or BigQuery connection, or replaces its password or key. */
export function SourceFormDialog(props: Props) {
  const { type, open, onOpenChange, secretMode, service } = props;
  const replacing = props.mode === "replace";
  const spec = service && type === "mcp" && !replacing ? mcpPresetForm(MCP_SERVICES[service]) : SOURCE_FORMS[type];
  const allFields = replacing ? [spec.credential] : [...spec.fields, spec.credential];
  // MCP servers: sign in with OAuth (the server's own page), or an API key, as the server allows.
  const authOptions: readonly McpAuth[] = spec.oauth && !replacing ? spec.oauth.options : ["key"];
  const [auth, setAuth] = useState<McpAuth>(authOptions[0]);
  const signingIn = auth === "oauth";
  const fields = signingIn ? allFields.filter((field) => !field.keyOnly && field !== spec.credential) : allFields;

  const initial = (): Record<string, string> => Object.fromEntries(allFields.map((field) => [field.name, field.initial ?? ""]));
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [pasted, setPasted] = useState("");
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const baseId = useId();
  const id = (name: string) => `${baseId}-${name}`;
  const storageMissing = secretMode === "unconfigured";

  function reset() {
    setValues(initial());
    setAuth(authOptions[0]);
    setPasted("");
    setPasteNote(null);
    setFieldErrors({});
    setFormError(null);
  }

  function update(name: string, value: string) {
    setValues((current) => ({ ...current, [name]: value, ...spec.derive?.(name, value, current) }));
    setFieldErrors((current) => ({ ...current, [name]: undefined }));
    setFormError(null);
  }

  function applyPaste(text: string) {
    setPasted(text);
    if (!spec.paste || !text.trim()) return setPasteNote(null);
    const parsed = spec.paste.parse(text);
    if (!parsed) return setPasteNote("That isn't a connection string OpenDashboards recognizes.");
    setValues((current) => {
      const next = { ...current, ...Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)])) };
      // The string carries everything but a name: suggest one, so pasting alone is enough to test.
      if (!current.name?.trim() && next.database?.trim()) next.name = next.database.trim();
      return next;
    });
    setFieldErrors({});
    setPasteNote("Filled in the fields below. Check them, then test.");
  }

  /** OAuth instead of a key: the server's own sign-in page, then back to Data Connections. */
  function signIn() {
    startTransition(async () => {
      const name = values.name ?? "";
      const result = await startMcpSignInAction(service ? { name, service } : { name, url: values.url ?? "" });
      if (!result.ok) {
        // Each result replaces the last one's message: a stale error under a field would contradict it.
        if (result.error.field && fields.some((field) => field.name === result.error.field)) {
          setFieldErrors({ [result.error.field]: result.error.message });
          setFormError(null);
        } else {
          setFieldErrors({});
          setFormError(result.error.message);
        }
        return;
      }
      window.location.assign(result.data.authorizationUrl);
    });
  }

  /**
   * The server's own checks, run here first, so every problem shows at once
   * and a slip doesn't cost a round trip. The server still checks everything.
   */
  function validate(): Record<string, string> {
    const errors: Record<string, string> = {};
    // An empty required field reads better as "is required" than as a format complaint.
    for (const field of fields) {
      if (!field.optional && field.kind !== "ssl" && !(values[field.name] ?? "").trim()) {
        errors[field.name] = field.name === "name" ? "Enter a name." : `${field.label} is required.`;
      }
    }
    // Signing in with OAuth sends no key, so there's none to check.
    if (!signingIn) {
      const credential = spec.schemas.credential.safeParse(values[spec.credential.name] ?? "");
      if (!credential.success) errors[spec.credential.name] ??= credential.error.issues[0]?.message ?? "Check this field.";
    }
    if (replacing) return errors;
    const name = connectionNameSchema.safeParse(values.name ?? "");
    if (!name.success) errors.name ??= name.error.issues[0]?.message ?? "Enter a name.";
    const { name: _name, [spec.credential.name]: _credential, ...settings } = values;
    // A known MCP server's endpoint comes from its preset, as it does on the server.
    const config = spec.schemas.config.safeParse(service ? { ...settings, service } : settings);
    if (!config.success) {
      for (const issue of config.error.issues) {
        const field = issue.path[0];
        if (typeof field === "string" && fields.some((candidate) => candidate.name === field)) errors[field] ??= issue.message;
      }
    }
    return errors;
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const errors = validate();
    if (Object.keys(errors).length) {
      setFormError(null);
      return setFieldErrors(errors);
    }
    if (signingIn) return signIn();
    startTransition(async () => {
      const result =
        props.mode === "replace"
          ? await replaceCredentialAction({ id: props.connection.id, credential: values[spec.credential.name] ?? "" })
          : await createConnectionAction(service ? { type, name: values.name ?? "", apiKey: values.apiKey ?? "", service } : { type, ...values });

      if (result.ok) {
        toast.success(replacing ? "Saved" : `Connected to ${(values.name ?? "").trim()}`);
        const data = result.data as { id?: unknown; warnings?: Parameters<typeof showConnectionWarnings>[0] } | undefined;
        showConnectionWarnings(data?.warnings);
        onOpenChange(false);
        reset();
        if (props.mode === "create" && typeof data?.id === "string") props.onCreated?.(data.id);
        return;
      }
      // Each result replaces the last one's message: a stale error under a field would contradict it.
      if (result.error.field && fields.some((field) => field.name === result.error.field)) {
        setFieldErrors({ [result.error.field]: result.error.message });
        setFormError(null);
      } else {
        setFieldErrors({});
        setFormError(result.error.message);
      }
    });
  }

  const renderField = (field: FieldSpec) => {
    const error = fieldErrors[field.name];
    if (field.kind === "ssl") {
      return (
        <CertificateCheckField
          key={field.name}
          value={values[field.name] === "require" ? "require" : "verify-full"}
          onChange={(mode) => update(field.name, mode)}
          error={error}
        />
      );
    }
    return (
      <Field key={field.name} data-invalid={!!error || undefined}>
        <FieldLabel htmlFor={id(field.name)}>{field.label}</FieldLabel>
        {field.kind === "textarea" ? (
          <TextareaWithFile field={field} id={id(field.name)} value={values[field.name] ?? ""} invalid={!!error} onChange={(value) => update(field.name, value)} />
        ) : (
          <Input
            id={id(field.name)}
            type={field.kind === "password" ? "password" : "text"}
            inputMode={field.kind === "number" ? "numeric" : undefined}
            value={values[field.name] ?? ""}
            onChange={(e) => update(field.name, e.target.value)}
            placeholder={field.placeholder && `e.g. ${field.placeholder}`}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={!!error || undefined}
            required={!field.optional}
            autoFocus={replacing ? field === spec.credential : field === fields[0]}
          />
        )}
        {(field.description || field.link) && (
          <FieldDescription>
            {field.description}
            {field.link && (
              <>
                {" "}
                <a
                  href={field.link.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-0.5 font-medium text-foreground underline-offset-2 hover:underline"
                >
                  {field.link.label}
                  <ExternalLinkIcon className="size-3" aria-hidden />
                </a>
              </>
            )}
          </FieldDescription>
        )}
        <FieldError>{error}</FieldError>
      </Field>
    );
  };

  // Half-width fields sit side by side, in pairs.
  const rows: FieldSpec[][] = [];
  for (const field of fields) {
    const last = rows.at(-1);
    if (field.half && last?.length === 1 && last[0].half) last.push(field);
    else rows.push([field]);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{props.mode === "replace" ? spec.replaceTitle : spec.title}</DialogTitle>
            <DialogDescription>
              {props.mode === "replace" ? `For ${props.connection.name}. Everything else stays the same.` : spec.description}
            </DialogDescription>
          </DialogHeader>

          <FieldGroup className="my-6 gap-5">
            {!replacing && spec.paste && (
              <Field>
                <FieldLabel htmlFor={id("paste")}>{spec.paste.label}</FieldLabel>
                <Input
                  id={id("paste")}
                  value={pasted}
                  onChange={(e) => applyPaste(e.target.value)}
                  placeholder={spec.paste.placeholder}
                  autoComplete="off"
                  spellCheck={false}
                />
                <FieldDescription>{pasteNote ?? "Paste one to fill in the fields. It isn't saved."}</FieldDescription>
              </Field>
            )}

            {rows.map((row) => (
              <Fragment key={row.map((field) => field.name).join()}>
                {row.length === 1 ? (
                  renderField(row[0])
                ) : (
                  <div className="grid grid-cols-2 gap-3">{row.map(renderField)}</div>
                )}
                {spec.oauth && !replacing && row.some((field) => field.name === spec.oauth?.after) && (
                  <AuthChoice
                    labelId={id("auth")}
                    options={authOptions}
                    value={auth}
                    server={spec.oauth.server}
                    onChange={(value) => {
                      setAuth(value);
                      setFieldErrors({});
                      setFormError(null);
                    }}
                  />
                )}
              </Fragment>
            ))}

            {!replacing && spec.help && (
              <details className="group rounded-lg border px-3 py-2 text-sm">
                <summary className="cursor-pointer text-muted-foreground select-none group-open:mb-2">{spec.help.summary}</summary>
                <p className="mb-2 text-xs text-muted-foreground">{spec.help.intro}</p>
                {spec.help.code && (
                  <pre className="overflow-x-auto rounded-md bg-neutral-50 p-2.5 text-[0.6875rem] leading-relaxed">{spec.help.code}</pre>
                )}
                {spec.help.steps && (
                  <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
                    {spec.help.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                )}
              </details>
            )}

            {secretMode === "plaintext" && (
              <p className="flex gap-2 text-xs text-muted-foreground">
                <TriangleAlertIcon className="mt-px size-3.5 shrink-0" aria-hidden />
                Local development: {spec.secretNoun} are stored unencrypted. Use test credentials.
              </p>
            )}
            {storageMissing && (
              <p role="alert" className="flex gap-2 text-sm text-destructive">
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                Secret storage isn&apos;t set up on this server, so {spec.secretNoun} can&apos;t be saved yet.
              </p>
            )}
            {formError && (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            )}
          </FieldGroup>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || storageMissing}>
              {pending && <Loader2Icon className="animate-spin" aria-hidden />}
              {signingIn ? (pending ? "Opening sign-in…" : "Sign in") : pending ? "Testing…" : replacing ? spec.replaceAction : "Test & save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A textarea for a pasted key, with a button that reads the key file instead. The file never leaves the browser but as this text. */
function TextareaWithFile({
  field,
  id,
  value,
  invalid,
  onChange,
}: {
  field: FieldSpec;
  id: string;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-2">
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={invalid || undefined}
        rows={5}
        className="min-h-24 w-full rounded-md border bg-transparent px-3 py-2 font-mono text-xs shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive"
      />
      {field.fileAccept && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept={field.fileAccept}
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file && file.size < 20_000) onChange(await file.text());
            }}
          />
          <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => fileRef.current?.click()}>
            <UploadIcon aria-hidden />
            Upload key file
          </Button>
        </>
      )}
    </div>
  );
}

const AUTH_CHOICES: Record<McpAuth, { title: string; who: string }> = {
  oauth: { title: "Sign in", who: "Just for you" },
  key: { title: "API key", who: "Everyone in your workspace can use it" },
};

/**
 * How to connect: signing in is personal (dashboards always run with the
 * viewer's own sign-in); a key is one credential a team can share.
 */
function AuthChoice({
  labelId,
  options,
  value,
  server,
  onChange,
}: {
  labelId: string;
  options: readonly McpAuth[];
  value: McpAuth;
  server: string;
  onChange: (value: McpAuth) => void;
}) {
  const note =
    value === "oauth"
      ? `You sign in on ${server}'s own page. It's yours alone until you share it with your workspace.`
      : "Sent with every request. Anyone you share a dashboard with sees what this key can see.";
  return (
    <Field>
      {options.length > 1 && <FieldLabel id={labelId}>Connect with</FieldLabel>}
      {options.length > 1 && (
        <ToggleGroup
          type="single"
          variant="outline"
          aria-labelledby={labelId}
          value={value}
          onValueChange={(next) => {
            if (next === "oauth" || next === "key") onChange(next);
          }}
          className="w-full"
        >
          {options.map((option) => (
            <ToggleGroupItem key={option} value={option} className="h-auto flex-1 flex-col gap-0 py-2">
              <span className="text-sm font-medium">{AUTH_CHOICES[option].title}</span>
              <span className="text-xs font-normal text-muted-foreground">{AUTH_CHOICES[option].who}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}
      <FieldDescription>{note}</FieldDescription>
    </Field>
  );
}
