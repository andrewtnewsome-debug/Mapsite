"use client";

import { Bookmark } from "lucide-react";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";

export function SaveDealButton({ dealId, withLabel, className }: { dealId: string; withLabel?: boolean; className?: string }) {
  const { data, currentUser, session, toggleSaveDeal } = useStore();
  const toast = useToast();
  if (session.role !== "investor") return null;
  const saved = data.savedDeals.some((s) => s.dealId === dealId && s.investorUserId === currentUser.id);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const nowSaved = toggleSaveDeal(dealId);
        toast({ tone: "info", title: nowSaved ? "Added to your watchlist" : "Removed from your watchlist" });
      }}
      aria-pressed={saved}
      aria-label={saved ? "Remove from watchlist" : "Save to watchlist"}
      title={saved ? "Remove from watchlist" : "Save to watchlist"}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md text-[13px] font-medium transition-colors",
        withLabel ? "h-9 border border-slate-300 bg-white px-3 shadow-xs hover:bg-slate-50" : "p-1.5 hover:bg-slate-100",
        saved ? "text-brand" : "text-slate-500 hover:text-slate-800",
        className,
      )}
    >
      <Bookmark className={cn("size-4", saved && "fill-current")} />
      {withLabel && (saved ? "Saved" : "Save")}
    </button>
  );
}
