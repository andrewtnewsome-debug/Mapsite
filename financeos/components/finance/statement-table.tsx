import type { StatementTable } from "@/lib/finance/report-tables";
import { formatCurrency, formatSignedPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

export function StatementTableView({ table }: { table: StatementTable }) {
  const cmp = table.comparisonLabel != null;
  return (
    <div tabIndex={0} role="region" aria-label={table.title} className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-[13px]">
        <caption className="sr-only">{table.title}</caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="py-2 pl-5 pr-3 text-left text-[12px] font-medium text-text-3">Line</th>
            <th scope="col" className="px-3 py-2 text-right text-[12px] font-medium text-text-3">{table.currentLabel}</th>
            {cmp ? (
              <>
                <th scope="col" className="px-3 py-2 text-right text-[12px] font-medium text-text-3">{table.comparisonLabel}</th>
                <th scope="col" className="px-3 py-2 text-right text-[12px] font-medium text-text-3">Change</th>
                <th scope="col" className="py-2 pl-3 pr-5 text-right text-[12px] font-medium text-text-3">%</th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r, i) => {
            const section = r.kind === "section";
            const strong = r.kind === "total" || r.kind === "subtotal";
            return (
              <tr key={`${r.label}-${i}`} className={cn("border-b border-border/70", r.kind === "total" && "border-b-border bg-surface-2/50", section && "border-0")}>
                <th
                  scope="row"
                  className={cn("py-1.5 pr-3 text-left font-normal", section ? "pt-4 text-[12px] font-semibold uppercase tracking-wider text-text-3" : "text-text-2", strong && "font-semibold text-text")}
                  style={{ paddingLeft: 20 + r.depth * 14 }}
                >
                  {r.label}
                </th>
                <td className={cn("tabular px-3 py-1.5 text-right", strong ? "font-semibold" : "", r.current != null && r.current < 0 && "text-critical-text")}>{section ? "" : formatCurrency(r.current, { cents: false })}</td>
                {cmp ? (
                  <>
                    <td className={cn("tabular px-3 py-1.5 text-right text-text-2", strong && "font-semibold")}>{section ? "" : formatCurrency(r.comparison)}</td>
                    <td className="tabular px-3 py-1.5 text-right text-text-2">{section || r.change == null ? "" : formatCurrency(r.change)}</td>
                    <td className="tabular py-1.5 pl-3 pr-5 text-right text-text-3">{section || r.changePct == null ? "" : formatSignedPercent(r.changePct)}</td>
                  </>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
