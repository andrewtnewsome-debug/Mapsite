import {
  BadgeCheck,
  Bookmark,
  Building2,
  ClipboardCheck,
  FilePen,
  FileSignature,
  Inbox,
  LayoutDashboard,
  LayoutList,
  MessagesSquare,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@/data/types";
import { brand } from "@/config/brand";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badgeKey?: "unread" | "pendingReview" | "certQueue" | "pursuits";
  exact?: boolean;
}

export const NAV: Record<Role, NavItem[]> = {
  investor: [
    { href: "/deals", label: "Deal Feed", icon: LayoutList },
    { href: "/saved", label: "Saved", icon: Bookmark },
    { href: "/pursuits", label: "Pursuits & NDAs", icon: FileSignature },
    { href: "/messages", label: "Messages", icon: MessagesSquare, badgeKey: "unread" },
    { href: "/profile", label: "Firm Profile", icon: Building2 },
  ],
  owner: [
    { href: "/owner", label: "Overview", icon: LayoutDashboard, exact: true },
    { href: "/owner/listing", label: "Listing Builder", icon: FilePen },
    { href: "/owner/inquiries", label: "Investor Pursuits", icon: Inbox, badgeKey: "pursuits" },
    { href: "/messages", label: "Messages", icon: MessagesSquare, badgeKey: "unread" },
  ],
  admin: [
    { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
    { href: "/admin/listings", label: "Listing Review", icon: ClipboardCheck, badgeKey: "pendingReview" },
    { href: "/admin/certifications", label: "Certifications", icon: ShieldCheck, badgeKey: "certQueue" },
    { href: "/admin/investors", label: "Investor Verification", icon: BadgeCheck },
  ],
};

export const ROLE_HOME: Record<Role, string> = {
  investor: "/deals",
  owner: "/owner",
  admin: "/admin",
};

export const ROLE_LABEL: Record<Role, string> = {
  investor: "Investor",
  owner: "Business Owner",
  admin: `${brand.sponsor.short} Admin`,
};
