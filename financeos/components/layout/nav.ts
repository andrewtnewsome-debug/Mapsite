import {
  ArrowLeftRight,
  FileChartColumn,
  FilePlus2,
  LayoutDashboard,
  Lightbulb,
  MessageSquareText,
  ReceiptText,
  Send,
  Settings,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Workspace",
    items: [
      { href: "/", label: "Overview", icon: LayoutDashboard },
      { href: "/ai-cfo", label: "AI CFO", icon: MessageSquareText },
    ],
  },
  {
    label: "Finance",
    items: [
      { href: "/receivables", label: "Accounts Receivable", icon: ReceiptText },
      { href: "/cash-flow", label: "Cash Flow", icon: ArrowLeftRight },
      { href: "/profitability", label: "Profitability", icon: TrendingUp },
      { href: "/reports", label: "Financial Reports", icon: FileChartColumn },
    ],
  },
  {
    label: "Automation",
    items: [
      { href: "/collections", label: "Collections", icon: Send },
      { href: "/invoices", label: "Invoice Assistant", icon: FilePlus2 },
      { href: "/insights", label: "Insights", icon: Lightbulb },
    ],
  },
];

export const SETTINGS_ITEM: NavItem = { href: "/settings", label: "Settings", icon: Settings };
