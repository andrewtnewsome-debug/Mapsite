import type { FinancialDataset } from "@/lib/domain/types";
import { formatIsoDate } from "@/lib/domain/dates";
import { openBillsAsOf } from "@/lib/finance/aging";
import { formatCurrency } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { Table, TableWrap, TBody, TD, TH, THead, TR } from "@/components/ui/table";

/** Open vendor bills that are overdue or due within the next 30 days, soonest first. */
export function UpcomingPayments({ dataset }: { dataset: FinancialDataset }) {
  if (!dataset.coverage.bills) {
    return (
      <Card>
        <EmptyState title="Vendor bill data is not available" />
      </Card>
    );
  }
  const bills = openBillsAsOf(dataset.bills, dataset.asOfDate).filter((b) => b.daysOverdue >= -30);
  const total = bills.reduce((s, b) => s + b.balance, 0);
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Upcoming vendor payments</CardTitle>
          <CardDescription>Open bills that are overdue or due in the next 30 days ({formatCurrency(total)} in total). Recorded bills only; FinanceOS never pays bills.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="px-0 pb-2">
        {bills.length === 0 ? (
          <EmptyState title="No bills due in the next 30 days" />
        ) : (
          <TableWrap aria-label="Upcoming vendor payments">
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Vendor</TH>
                  <TH>Bill</TH>
                  <TH>Due date</TH>
                  <TH>Category</TH>
                  <TH numeric>Balance</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {bills.map((b) => (
                  <TR key={b.id}>
                    <TD className="font-medium">{b.vendorName}</TD>
                    <TD className="tabular text-text-2">{b.docNumber ?? b.id}</TD>
                    <TD className="tabular whitespace-nowrap">{formatIsoDate(b.effectiveDueDate)}</TD>
                    <TD className="text-[12px] text-text-3">{b.category ?? "—"}</TD>
                    <TD numeric className="font-medium">{formatCurrency(b.balance, { cents: true })}</TD>
                    <TD>{b.daysOverdue > 0 ? <Badge tone="warning">{b.daysOverdue} days overdue</Badge> : b.daysOverdue >= -7 ? <Badge tone="accent">Due within 7 days</Badge> : <Badge>Due in {-b.daysOverdue} days</Badge>}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </CardContent>
    </Card>
  );
}
