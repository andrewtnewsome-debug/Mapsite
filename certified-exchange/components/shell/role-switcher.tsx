"use client";

import { Check, ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Role } from "@/data/types";
import { ADMIN_USERS, INVESTOR_USERS, OWNER_USERS } from "@/data/users";
import { useStore } from "@/lib/store";
import { profileByUser } from "@/lib/selectors";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { ROLE_HOME, ROLE_LABEL } from "./nav";

const ROLES: Role[] = ["investor", "owner", "admin"];

export function RoleSwitcher() {
  const { session, setRole, setInvestor, setOwner, currentUser, data } = useStore();
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const switchRole = (role: Role) => {
    if (role === session.role) return;
    const { autoSelectedOwner } = setRole(role);
    if (autoSelectedOwner) {
      toast({
        tone: "info",
        title: `Signed in as ${autoSelectedOwner.name}`,
        body: `Owner of ${autoSelectedOwner.firmName}, the business you most recently pursued.`,
      });
    }
    router.push(ROLE_HOME[role]);
  };

  const personas =
    session.role === "investor" ? INVESTOR_USERS : session.role === "owner" ? OWNER_USERS : ADMIN_USERS;

  return (
    <div className="flex items-center gap-2">
      <div className="hidden items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5 sm:flex" role="tablist" aria-label="Switch role">
        {ROLES.map((r) => (
          <button
            key={r}
            type="button"
            role="tab"
            aria-selected={session.role === r}
            onClick={() => switchRole(r)}
            className={cn(
              "rounded-md px-2.5 py-1 text-[12.5px] font-medium transition-colors",
              session.role === r ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900",
            )}
          >
            {ROLE_LABEL[r]}
          </button>
        ))}
      </div>

      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white py-1 pl-1 pr-2 text-left hover:bg-slate-50"
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <Avatar name={currentUser.name} className="size-7" />
          <span className="hidden min-w-0 leading-tight md:block">
            <span className="block max-w-44 truncate text-[12.5px] font-medium text-slate-900">{currentUser.name}</span>
            <span className="block max-w-44 truncate text-[11px] text-slate-500">{currentUser.firmName}</span>
          </span>
          <ChevronDown className="size-3.5 text-slate-400" />
        </button>

        {open && (
          <div className="absolute right-0 z-50 mt-1.5 w-80 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl" role="menu">
            {/* Role choice for small screens where the segmented control is hidden */}
            <div className="flex gap-1 border-b border-slate-200 p-2 sm:hidden">
              {ROLES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    switchRole(r);
                  }}
                  className={cn(
                    "flex-1 rounded-md px-2 py-1 text-xs font-medium",
                    session.role === r ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700",
                  )}
                >
                  {ROLE_LABEL[r]}
                </button>
              ))}
            </div>
            <div className="border-b border-slate-100 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Demo personas · {ROLE_LABEL[session.role]}
            </div>
            <div className="max-h-80 overflow-y-auto py-1">
              {personas.map((u) => {
                const active = u.id === currentUser.id;
                const sub =
                  session.role === "investor"
                    ? `${profileByUser(data, u.id)?.firmType ?? ""} · ${u.firmName}`
                    : session.role === "owner"
                      ? u.firmName
                      : u.title;
                return (
                  <button
                    key={u.id}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setOpen(false);
                      if (session.role === "investor") setInvestor(u.id);
                      else if (session.role === "owner") setOwner(u.id);
                    }}
                    className={cn("flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-slate-50", active && "bg-slate-50")}
                  >
                    <Avatar name={u.name} className="size-7" />
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block truncate text-[13px] font-medium text-slate-900">{u.name}</span>
                      <span className="block truncate text-[11.5px] text-slate-500">{sub}</span>
                    </span>
                    {active && <Check className="size-4 text-brand" />}
                  </button>
                );
              })}
            </div>
            <div className="border-t border-slate-100 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
              {/* TODO(auth): replace persona switching with real sign-in. */}
              The role switcher stands in for sign-in in this prototype.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
