"use client";

import { useId } from "react";

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import type { SslMode } from "@/lib/sources/host";

type Props = {
  value: SslMode;
  onChange: (mode: SslMode) => void;
  error?: string;
  /** Shown instead of the usual text while it's on because the form turned it on. */
  presetReason?: string;
};

/**
 * How far to trust the server's certificate. Off (the default) verifies it; on
 * skips the check. Either way the connection is encrypted: there is no setting
 * that connects without encryption.
 */
export function CertificateCheckField({ value, onChange, error, presetReason }: Props) {
  const id = useId();
  const skipping = value === "require";
  return (
    <Field data-invalid={!!error || undefined}>
      <div className="flex items-center justify-between gap-3">
        <FieldLabel htmlFor={id}>Skip certificate check</FieldLabel>
        <Switch
          id={id}
          checked={skipping}
          onCheckedChange={(checked) => onChange(checked ? "require" : "verify-full")}
          aria-invalid={!!error || undefined}
        />
      </div>
      <FieldDescription>
        {!skipping
          ? "Always encrypted. Turn on only if the server's certificate can't be verified."
          : (presetReason ?? "Still encrypted, but the server's certificate isn't checked.")}
      </FieldDescription>
      <FieldError>{error}</FieldError>
    </Field>
  );
}
