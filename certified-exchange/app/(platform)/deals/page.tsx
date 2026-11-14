"use client";

import { BookmarkPlus, LayoutGrid, Rows3, Search, SearchX, SlidersHorizontal, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { brand } from "@/config/brand";
import { EMPTY_FILTERS } from "@/data/seed";
import type { DealFilters } from "@/data/types";
import { activeFilterCount, criteriaMatch, describeFilters, filterDeals, sortDeals, type SortKey } from "@/lib/deals";
import { dealRows, profileByUser } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { DealCard } from "@/components/deals/deal-card";
import { DealTable } from "@/components/deals/deal-table";
import { FilterPanel } from "@/components/deals/filter-panel";
import { RoleGate } from "@/components/shell/role-gate";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Card, EmptyState, Field, Input, PageHeader, Select, Skeleton } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";

const VIEW_KEY = `${brand.storageKey}:feed-view`;

export default function DealsPage() {
  return (
    <RoleGate allow={["investor", "admin"]}>
      <Suspense fallback={<FeedSkeleton />}>
        <DealFeed />
      </Suspense>
    </RoleGate>
  );
}

function FeedSkeleton() {
  return (
    <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
      <Skeleton className="hidden h-[600px] lg:block" />
      <div className="space-y-3">
        <Skeleton className="h-10" />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-44" />
        ))}
      </div>
    </div>
  );
}

function DealFeed() {
  const { data, currentUser, session, saveSearch } = useStore();
  const toast = useToast();
  const params = useSearchParams();
  const searchParam = params.get("search");

  const [filters, setFilters] = useState<DealFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortKey>("newest");
  const [view, setView] = useState<"cards" | "table">("cards");
  const [activeSearchId, setActiveSearchId] = useState<string>("");
  const [showFilters, setShowFilters] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [searchName, setSearchName] = useState("");

  const profile = session.role === "investor" ? profileByUser(data, currentUser.id) : undefined;
  const mySearches = data.savedSearches.filter((s) => s.investorUserId === currentUser.id);

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(VIEW_KEY);
      if (v === "table" || v === "cards") setView(v);
    } catch {
      /* ignore */
    }
  }, []);

  // Apply a saved search passed as ?search=<id>
  useEffect(() => {
    if (!searchParam) return;
    const s = data.savedSearches.find((x) => x.id === searchParam);
    if (s) {
      setFilters(s.filters);
      setActiveSearchId(s.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParam]);

  const allRows = useMemo(() => dealRows(data, ["live"]), [data]);
  const results = useMemo(() => sortDeals(filterDeals(allRows, filters, profile), sort), [allRows, filters, profile, sort]);
  const signedIds = useMemo(
    () => new Set(data.ndas.filter((n) => n.investorUserId === currentUser.id).map((n) => n.dealId)),
    [data.ndas, currentUser.id],
  );
  const matches = useMemo(() => new Map(results.map((r) => [r.deal.id, criteriaMatch(r, profile)])), [results, profile]);
  const nActive = activeFilterCount(filters);

  const updateFilters = (f: DealFilters) => {
    setFilters(f);
    setActiveSearchId("");
  };

  const setViewPersist = (v: "cards" | "table") => {
    setView(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  };

  const chips = describeFilters(filters).filter((c) => c !== "All live deals");

  return (
    <>
      <PageHeader
        title="Deal Feed"
        description={`${allRows.length} live opportunities from ${brand.sponsor.short}-certified minority business enterprises. Teasers are anonymized; company identity and the CIM are released after an NDA.`}
        actions={
          session.role === "investor" && (
            <>
              {mySearches.length > 0 && (
                <Select
                  aria-label="Saved searches"
                  value={activeSearchId}
                  onChange={(e) => {
                    const s = mySearches.find((x) => x.id === e.target.value);
                    setActiveSearchId(e.target.value);
                    setFilters(s ? s.filters : EMPTY_FILTERS);
                  }}
                  className="w-56"
                >
                  <option value="">Saved searches…</option>
                  {mySearches.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              )}
              <Button
                variant="outline"
                onClick={() => {
                  setSearchName("");
                  setSaveOpen(true);
                }}
                disabled={nActive === 0}
                title={nActive === 0 ? "Apply at least one filter to save a search" : undefined}
              >
                <BookmarkPlus /> Save search
              </Button>
            </>
          )
        }
      />

      <div className="grid items-start gap-5 lg:grid-cols-[260px_1fr]">
        <div className={cn("lg:sticky lg:top-20 lg:block", showFilters ? "block" : "hidden")}>
          <FilterPanel filters={filters} onChange={updateFilters} rows={allRows} hasProfile={!!profile} />
        </div>

        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-56 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={filters.query}
                onChange={(e) => updateFilters({ ...filters, query: e.target.value })}
                placeholder="Search teasers: e.g. aerospace, recurring, Southeast"
                className="pl-8"
                aria-label="Search deals"
              />
            </div>
            <Button variant="outline" className="lg:hidden" onClick={() => setShowFilters((s) => !s)}>
              <SlidersHorizontal /> Filters{nActive ? ` (${nActive})` : ""}
            </Button>
            <Select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="w-44">
              <option value="newest">Sort: Newest</option>
              <option value="revenue">Sort: Revenue (high–low)</option>
              <option value="ebitda">Sort: EBITDA (high–low)</option>
            </Select>
            <div className="flex rounded-md border border-slate-300 bg-white p-0.5 shadow-xs" role="group" aria-label="View">
              <button
                type="button"
                onClick={() => setViewPersist("cards")}
                aria-pressed={view === "cards"}
                className={cn("rounded p-1.5", view === "cards" ? "bg-slate-100 text-slate-900" : "text-slate-400 hover:text-slate-700")}
                title="Card view"
              >
                <LayoutGrid className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewPersist("table")}
                aria-pressed={view === "table"}
                className={cn("rounded p-1.5", view === "table" ? "bg-slate-100 text-slate-900" : "text-slate-400 hover:text-slate-700")}
                title="Table view"
              >
                <Rows3 className="size-4" />
              </button>
            </div>
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[13px] text-slate-600">
            <span className="font-medium text-slate-900 tabular-nums">
              {results.length} {results.length === 1 ? "deal" : "deals"}
            </span>
            {activeSearchId && (
              <span className="text-slate-500">· saved search “{mySearches.find((s) => s.id === activeSearchId)?.name}”</span>
            )}
            {chips.map((c) => (
              <span key={c} className="rounded-full bg-slate-200/70 px-2 py-0.5 text-[12px] text-slate-700">
                {c}
              </span>
            ))}
            {nActive > 0 && (
              <button
                type="button"
                onClick={() => updateFilters(EMPTY_FILTERS)}
                className="inline-flex items-center gap-0.5 text-[12.5px] font-medium text-brand hover:underline"
              >
                <X className="size-3.5" /> Clear all
              </button>
            )}
          </div>

          {results.length === 0 ? (
            <Card>
              <EmptyState
                icon={<SearchX />}
                title="No deals match these filters"
                body="Try widening the revenue or EBITDA range, removing a region, or clearing the search terms. New listings are added after review each week."
                action={
                  <Button variant="outline" onClick={() => updateFilters(EMPTY_FILTERS)}>
                    Clear filters
                  </Button>
                }
              />
            </Card>
          ) : view === "cards" ? (
            <div className="space-y-3">
              {results.map((r) => (
                <DealCard key={r.deal.id} row={r} signed={signedIds.has(r.deal.id)} match={matches.get(r.deal.id)} />
              ))}
            </div>
          ) : (
            <DealTable rows={results} signedIds={signedIds} matches={matches} />
          )}
        </div>
      </div>

      <Dialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title="Save this search"
        description="Saved searches appear in your Saved page and in the feed's search menu."
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!searchName.trim()}
              onClick={() => {
                const s = saveSearch(searchName, filters);
                setActiveSearchId(s.id);
                setSaveOpen(false);
                toast({ title: "Search saved", body: `“${s.name}” is available from the Saved page.` });
              }}
            >
              Save search
            </Button>
          </>
        }
      >
        <form
          className="space-y-3 px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!searchName.trim()) return;
            const s = saveSearch(searchName, filters);
            setActiveSearchId(s.id);
            setSaveOpen(false);
            toast({ title: "Search saved", body: `“${s.name}” is available from the Saved page.` });
          }}
        >
          <Field label="Search name" htmlFor="search-name">
            <Input
              id="search-name"
              data-autofocus
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
              placeholder="e.g. Southeast services, $1M+ EBITDA"
            />
          </Field>
          <div>
            <div className="mb-1 text-[13px] font-medium text-slate-700">Filters included</div>
            <div className="flex flex-wrap gap-1.5">
              {describeFilters(filters).map((c) => (
                <span key={c} className="rounded-full bg-slate-100 px-2 py-0.5 text-[12px] text-slate-700">
                  {c}
                </span>
              ))}
            </div>
          </div>
        </form>
      </Dialog>
    </>
  );
}
