"use client";

import { ArrowLeft, ExternalLink, MessagesSquare, Send } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { getUser } from "@/data/users";
import { dateTime, dealRef, relativeTime, shortDate } from "@/lib/format";
import { getBusiness, getDeal, inquiryFor, ndaFor, profileByUser, threadsFor, type Thread } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { VerifiedInvestorBadge } from "@/components/deals/badges";
import { RoleGate } from "@/components/shell/role-gate";
import { Button, LinkButton } from "@/components/ui/button";
import { Avatar, Badge, Card, EmptyState, PageHeader, Skeleton, Textarea } from "@/components/ui/primitives";

export default function MessagesPage() {
  return (
    <RoleGate allow={["investor", "owner"]}>
      <Suspense fallback={<Skeleton className="h-[600px]" />}>
        <Messages />
      </Suspense>
    </RoleGate>
  );
}

function Messages() {
  const { data, currentUser, session } = useStore();
  const params = useSearchParams();
  const router = useRouter();
  const threads = useMemo(() => threadsFor(data, currentUser, session.role), [data, currentUser, session.role]);
  const requested = params.get("thread");
  const activeId = requested && threads.some((t) => t.id === requested) ? requested : undefined;
  const active = threads.find((t) => t.id === activeId);
  const isOwner = session.role === "owner";

  // On wide screens open the most recent thread by default.
  useEffect(() => {
    if (!requested && threads.length && window.matchMedia("(min-width: 1024px)").matches) {
      router.replace(`/messages?thread=${threads[0].id}`);
    }
  }, [requested, threads, router]);

  return (
    <>
      <PageHeader
        title="Messages"
        description={
          isOwner
            ? "Private conversations with investors who have signed the NDA on your listing."
            : "Private conversations with business owners. Threads open after you sign an NDA and send an inquiry."
        }
      />
      {threads.length === 0 ? (
        <Card>
          <EmptyState
            icon={<MessagesSquare />}
            title="No conversations yet"
            body={
              isOwner
                ? "Investors can message you once they sign the NDA on your listing and send an inquiry. You will see their firm profile and answers here."
                : "Open a deal, sign the NDA and send an inquiry. The owner's reply will appear here."
            }
            action={!isOwner ? <LinkButton href="/deals">Browse the deal feed</LinkButton> : <LinkButton href="/owner/listing" variant="outline">Review your listing</LinkButton>}
          />
        </Card>
      ) : (
        <Card className="grid h-[calc(100vh-200px)] min-h-[520px] overflow-hidden lg:grid-cols-[320px_minmax(0,1fr)]">
          <ThreadList threads={threads} activeId={activeId} className={cn(active && "hidden lg:block")} />
          {active ? (
            <Conversation key={active.id} thread={active} />
          ) : (
            <div className="hidden items-center justify-center lg:flex">
              <EmptyState icon={<MessagesSquare />} title="Select a conversation" />
            </div>
          )}
        </Card>
      )}
    </>
  );
}

function ThreadList({ threads, activeId, className }: { threads: Thread[]; activeId?: string; className?: string }) {
  const { data, session } = useStore();
  return (
    <div className={cn("min-h-0 overflow-y-auto border-r border-slate-200", className)}>
      <ul className="divide-y divide-slate-100">
        {threads.map((t) => {
          const deal = getDeal(data, t.dealId);
          const investor = getUser(t.investorUserId);
          const profile = profileByUser(data, t.investorUserId);
          const title = session.role === "owner" ? investor?.firmName : deal?.companyName;
          const sub = session.role === "owner" ? `${investor?.name} · ${profile?.firmType ?? ""}` : `${dealRef(t.dealId)} · ${getBusiness(data, deal?.businessId)?.industry ?? ""}`;
          return (
            <li key={t.id}>
              <Link
                href={`/messages?thread=${t.id}`}
                className={cn("block px-4 py-3 hover:bg-slate-50", t.id === activeId && "bg-slate-50 shadow-[inset_3px_0_0_var(--brand)]")}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("truncate text-[13.5px]", t.unread ? "font-semibold text-slate-900" : "font-medium text-slate-800")}>{title}</span>
                  <span className="shrink-0 text-[11px] text-slate-400">{relativeTime(t.last.createdAt)}</span>
                </div>
                <div className="truncate text-[12px] text-slate-500">{sub}</div>
                <div className="mt-1 flex items-center gap-2">
                  <p className="line-clamp-1 flex-1 text-[12.5px] text-slate-500">{t.last.body}</p>
                  {t.unread > 0 && (
                    <span className="rounded-full bg-brand px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums text-white">{t.unread}</span>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Conversation({ thread }: { thread: Thread }) {
  const { data, currentUser, session, sendMessage, markThreadRead } = useStore();
  const [body, setBody] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const deal = getDeal(data, thread.dealId)!;
  const business = getBusiness(data, deal.businessId)!;
  const investor = getUser(thread.investorUserId)!;
  const owner = getUser(business.ownerUserId)!;
  const profile = profileByUser(data, investor.id);
  const inquiry = inquiryFor(data, deal.id, investor.id);
  const nda = ndaFor(data, deal.id, investor.id);
  const isOwner = session.role === "owner";
  const counterpart = isOwner ? investor : owner;

  useEffect(() => {
    markThreadRead(thread.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.id, thread.messages.length]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [thread.messages.length]);

  const submit = () => {
    if (!body.trim()) return;
    sendMessage(thread.id, body);
    setBody("");
  };

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3">
        <Link href="/messages" className="rounded p-1 text-slate-500 hover:bg-slate-100 lg:hidden" aria-label="All conversations">
          <ArrowLeft className="size-4" />
        </Link>
        <Avatar name={counterpart.name} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold text-slate-900">{isOwner ? investor.firmName : deal.companyName}</span>
            {isOwner && profile && <VerifiedInvestorBadge verified={profile.verified} />}
          </div>
          <div className="text-[12px] text-slate-500">
            {counterpart.name}, {counterpart.title}
            {!isOwner && <> · {dealRef(deal.id)}</>}
            {nda && <> · NDA signed {shortDate(nda.signedAt)}</>}
          </div>
        </div>
        {isOwner && profile ? (
          <LinkButton href={`/investors/${profile.id}`} variant="outline" size="sm">
            Investor profile <ExternalLink />
          </LinkButton>
        ) : (
          <LinkButton href={`/deals/${deal.id}`} variant="outline" size="sm">
            View deal <ExternalLink />
          </LinkButton>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-slate-50/60 px-4 py-4">
        {inquiry && (
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
              <Badge tone="brand">Inquiry</Badge>
              {investor.firmName} → {deal.companyName} · {dateTime(inquiry.createdAt)}
            </div>
            <dl className="mt-2 grid gap-2 text-[12.5px] sm:grid-cols-3">
              {[
                ["Criteria fit", inquiry.criteriaFit],
                ["Capital available", inquiry.capitalAvailable],
                ["Timeline", inquiry.timeline],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[10.5px] font-medium uppercase tracking-wide text-slate-500">{k}</dt>
                  <dd className="text-slate-800">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        {thread.messages.map((m) => {
          const mine = m.senderUserId === currentUser.id;
          const sender = getUser(m.senderUserId);
          return (
            <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[80%]")}>
                <div className={cn("mb-1 text-[11px] text-slate-500", mine && "text-right")}>
                  {mine ? "You" : sender?.name} · {dateTime(m.createdAt)}
                </div>
                <div
                  className={cn(
                    "whitespace-pre-line rounded-lg px-3.5 py-2.5 text-[13.5px] leading-relaxed",
                    mine ? "bg-brand text-white" : "border border-slate-200 bg-white text-slate-800",
                  )}
                >
                  {m.body}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <form
        className="border-t border-slate-200 bg-white p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex items-end gap-2">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={2}
            className="min-h-0 resize-none"
            placeholder={`Reply to ${counterpart.name.split(" ")[0]}…`}
            aria-label="Message"
          />
          <Button type="submit" disabled={!body.trim()}>
            <Send /> Send
          </Button>
        </div>
        <p className="mt-1.5 text-[11px] text-slate-400">
          Enter to send · Shift+Enter for a new line · {/* TODO(notifications): email notification of new messages is out of scope. */}
          Email notifications are not sent in the prototype.
        </p>
      </form>
    </div>
  );
}
