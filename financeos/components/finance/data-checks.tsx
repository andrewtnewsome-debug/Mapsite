import { CheckCircle2, CircleDashed, AlertTriangle } from "lucide-react";
import type { FinancialDataset } from "@/lib/domain/types";
import { reconcileDataset } from "@/lib/finance/reconcile";
import { formatCurrency } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export function DataChecksCard({ dataset }: { dataset: FinancialDataset }) {
  const checks = reconcileDataset(dataset);
  const mismatches = checks.filter((c) => c.status === "mismatch").length;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Data checks</CardTitle>
          <CardDescription>
            Reconciles FinanceOS figures with each other{dataset.source === "quickbooks-sandbox" ? " and with QuickBooks' own report totals" : ""}. Use this after a sync before relying on the numbers.
          </CardDescription>
        </div>
        {mismatches ? (
          <Badge tone="warning">
            <AlertTriangle aria-hidden /> {mismatches} to review
          </Badge>
        ) : (
          <Badge tone="good">
            <CheckCircle2 aria-hidden /> All available checks match
          </Badge>
        )}
      </CardHeader>
      <CardContent className="px-0 pb-2">
        <TableWrap aria-label="Data checks">
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Check</TH>
                <TH numeric>FinanceOS</TH>
                <TH numeric>Compared with</TH>
                <TH numeric>Difference</TH>
                <TH>Result</TH>
              </TR>
            </THead>
            <TBody>
              {checks.map((c) => (
                <TR key={c.id}>
                  <TD className="min-w-64">
                    <p className="font-medium">{c.label}</p>
                    <p className="text-[12px] text-text-3">
                      {c.oursLabel} vs {c.theirsLabel}
                    </p>
                    {c.status === "mismatch" ? <p className="mt-1 text-[12px] text-warning-text">{c.explanation}</p> : null}
                  </TD>
                  <TD numeric>{formatCurrency(c.ours, { cents: true })}</TD>
                  <TD numeric>{formatCurrency(c.theirs, { cents: true })}</TD>
                  <TD numeric className={c.status === "mismatch" ? "font-medium text-warning-text" : "text-text-3"}>
                    {c.difference == null ? "—" : formatCurrency(c.difference, { cents: true })}
                  </TD>
                  <TD>
                    {c.status === "match" ? (
                      <Badge tone="good">
                        <CheckCircle2 aria-hidden /> Match
                      </Badge>
                    ) : c.status === "mismatch" ? (
                      <Badge tone="warning">
                        <AlertTriangle aria-hidden /> Review
                      </Badge>
                    ) : (
                      <Badge>
                        <CircleDashed aria-hidden /> Not available
                      </Badge>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      </CardContent>
    </Card>
  );
}
