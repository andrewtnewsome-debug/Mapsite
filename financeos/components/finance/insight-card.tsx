"use client";

import Link from "next/link";
import { Bot, MessageSquareText } from "lucide-react";
import type { Insight } from "@/lib/finance/insights";
import { AiInterpretation, useNarrative } from "@/components/ai/narrative-panel";
import { SeverityBadge } from "@/components/finance/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/states";
import { Spinner } from "@/components/ui/spinner";

export function InsightCard({ insight }: { insight: Insight }) {
  const n = useNarrative({ kind: "insight", insightId: insight.id });
  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <SeverityBadge severity={insight.severity} />
            <Badge tone="outline">{insight.category.replace("-", " ")}</Badge>
          </div>
          <CardTitle className="text-[15px] leading-snug">{insight.title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-[13px]">
        {insight.facts.length ? (
          <section>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-text-3">Verified facts</p>
            <dl className="divide-y divide-border rounded-lg border border-border">
              {insight.facts.map((f) => (
                <div key={f.label} className="flex justify-between gap-3 px-3 py-1.5">
                  <dt className="text-text-2">{f.label}</dt>
                  <dd className="tabular text-right font-medium">{f.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}
        {insight.forecasts.length ? (
          <section>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-text-3">Mathematical forecast</p>
            <ul className="list-disc space-y-0.5 pl-5 text-text-2">
              {insight.forecasts.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {insight.assumptions.length ? (
          <section>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-text-3">Assumptions</p>
            <ul className="list-disc space-y-0.5 pl-5 text-text-3">
              {insight.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </section>
        ) : null}
        <p className="text-[12px] text-text-3">
          <span className="font-medium text-text-2">Trigger rule:</span> {insight.trigger}
        </p>
        {n.error ? <Notice tone="warning">{n.error}</Notice> : null}
        {n.text ? <AiInterpretation text={n.text} unverified={n.unverified} model={n.model} streaming={n.state === "loading"} /> : null}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" onClick={n.run} disabled={n.state === "loading"}>
            {n.state === "loading" ? <Spinner label="Explaining" /> : <Bot />} {n.state === "done" ? "Explain again" : "Explain with local AI"}
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <Link href={`/ai-cfo?q=${encodeURIComponent(insight.followUpQuestion)}`}>
              <MessageSquareText /> {insight.followUpQuestion}
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
