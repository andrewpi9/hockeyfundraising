"use client";

import { useActionState } from "react";
import { confirmUnsubscribe } from "@/app/unsubscribe/actions";
import { Button } from "@/components/ui";

export function UnsubscribeForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(confirmUnsubscribe, null);
  if (state?.done) return <p role="status" className="mt-5 rounded-xl bg-carolina-50 px-4 py-3 text-sm dark:bg-navy-800">{state.message}</p>;
  return (
    <form action={action} className="mt-6">
      <input type="hidden" name="token" value={token} />
      <Button type="submit" variant="solid" disabled={pending} className="w-full">{pending ? "One moment…" : "Unsubscribe"}</Button>
      {state && !state.done ? <p role="alert" className="mt-3 text-sm text-red-600">{state.message}</p> : null}
    </form>
  );
}
