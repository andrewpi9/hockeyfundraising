"use client";

import { useActionState } from "react";
import { updateOrganization } from "@/app/admin/actions";
import { Button, Field, inputStyles } from "@/components/ui";
import { Notice } from "./CampaignForm";

export function OrgForm({ defaults }: { defaults: Record<"name" | "legalName" | "ein" | "addressLine1" | "addressLine2" | "city" | "state" | "postalCode", string> }) {
  const [state, action, pending] = useActionState(updateOrganization, null);
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Display name" hint="Shown in the header and emails.">
          <input name="name" required defaultValue={defaults.name} className={inputStyles} />
        </Field>
        <Field label="Legal name" hint="As registered with the IRS. Printed on receipts.">
          <input name="legalName" defaultValue={defaults.legalName} className={inputStyles} />
        </Field>
      </div>
      <Field label="EIN" hint="Printed on donation receipts.">
        <input name="ein" defaultValue={defaults.ein} placeholder="12-3456789" className={`${inputStyles} max-w-xs`} />
      </Field>
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Mailing address</legend>
        <p className="text-xs text-muted">
          Required before participants can send email. CAN-SPAM requires a valid physical postal address in every message; it also appears on receipts.
        </p>
        <input name="addressLine1" defaultValue={defaults.addressLine1} placeholder="Street address" className={inputStyles} aria-label="Address line 1" />
        <input name="addressLine2" defaultValue={defaults.addressLine2} placeholder="Suite, PO box (optional)" className={inputStyles} aria-label="Address line 2" />
        <div className="grid gap-3 sm:grid-cols-[1fr_80px_140px]">
          <input name="city" defaultValue={defaults.city} placeholder="City" className={inputStyles} aria-label="City" />
          <input name="state" defaultValue={defaults.state} placeholder="NC" maxLength={2} className={`${inputStyles} uppercase`} aria-label="State" />
          <input name="postalCode" defaultValue={defaults.postalCode} placeholder="ZIP" className={inputStyles} aria-label="Postal code" />
        </div>
      </fieldset>
      <Notice state={state} />
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save settings"}</Button>
    </form>
  );
}
