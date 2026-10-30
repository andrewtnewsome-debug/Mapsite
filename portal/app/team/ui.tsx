import { STATUS_LABELS } from "@/lib/format";
import type { Status } from "@/lib/types";

export function ScoreRing({ score, size = 38 }: { score: number; size?: number }) {
  const color = score >= 75 ? "var(--green)" : score >= 55 ? "#e0a43a" : "#d9604f";
  return (
    <span
      className="score-ring"
      style={{
        width: size,
        height: size,
        background: `conic-gradient(${color} ${score * 3.6}deg, #eceeea 0deg)`,
        padding: 4,
      }}
    >
      <span
        style={{
          background: "#fff",
          width: "100%",
          height: "100%",
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 700,
          fontSize: size > 50 ? 20 : 13,
        }}
      >
        {score}
      </span>
    </span>
  );
}

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`badge ${status}`}>{STATUS_LABELS[status]}</span>;
}
