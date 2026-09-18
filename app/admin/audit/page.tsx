import { adminPage } from "@/lib/page-guards";
import { listAuditLogs } from "@/lib/queries/audit";
import { AdminShell } from "@/components/admin/AdminShell";
import { card } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const { org } = await adminPage();
  const rows = await listAuditLogs(org.id, 200);

  return (
    <AdminShell orgName={org.name} title="Audit log">
      <p className="mb-4 text-sm text-muted">
        Every admin write, export and donor-PII view, newest first. Append-only at the database. Metadata holds identifiers and counts, never values.
      </p>
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3 font-medium">When</th>
              <th className="px-4 py-3 font-medium">Actor</th>
              <th className="px-4 py-3 font-medium">Action</th>
              <th className="px-4 py-3 font-medium">Target</th>
              <th className="px-4 py-3 font-medium">Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border align-top last:border-0">
                <td className="whitespace-nowrap px-4 py-2.5 text-muted">{r.createdAt.toISOString().replace("T", " ").slice(0, 19)}</td>
                <td className="px-4 py-2.5">{r.actorEmail ?? <span className="text-muted">system</span>}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{r.action}</td>
                <td className="px-4 py-2.5 text-xs text-muted">{r.targetType}{r.targetId ? ` · ${r.targetId.slice(0, 8)}…` : ""}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-muted">{r.metadata && Object.keys(r.metadata).length ? JSON.stringify(r.metadata) : ""}</td>
              </tr>
            ))}
            {rows.length === 0 ? <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">Nothing yet.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
