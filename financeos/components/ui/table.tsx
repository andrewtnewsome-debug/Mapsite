import * as React from "react";
import { cn } from "@/lib/utils";

/** Horizontally scrollable table container; focusable so keyboard users can scroll it. */
export function TableWrap({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div tabIndex={0} role="region" aria-label={props["aria-label"] ?? "Table"} className={cn("w-full overflow-x-auto focus-visible:outline-2 focus-visible:outline-ring", className)} {...props} />;
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full border-collapse text-[13px]", className)} {...props} />;
}

export function THead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("[&_tr]:border-b [&_tr]:border-border", className)} {...props} />;
}

export function TBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}

export function TR({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("border-b border-border transition-colors hover:bg-surface-2/60", className)} {...props} />;
}

export function TH({ className, numeric, ...props }: React.ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cn("h-9 whitespace-nowrap px-3 text-left align-middle text-[12px] font-medium text-text-3 first:pl-5 last:pr-5", numeric && "text-right", className)}
      {...props}
    />
  );
}

export function TD({ className, numeric, ...props }: React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return <td className={cn("px-3 py-2.5 align-middle text-text first:pl-5 last:pr-5", numeric && "tabular text-right whitespace-nowrap", className)} {...props} />;
}
