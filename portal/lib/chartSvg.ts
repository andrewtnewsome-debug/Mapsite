import type { OnePagerChart } from "./types";

/** One-pager chart as SVG markup: used for the on-screen preview and, rasterized, in the Word file. */

const GREEN = "#56a446";
const GRAY = "#414141";
const GRAY_MID = "#7f7f7f";
const PALETTE = [GREEN, GRAY, "#8cc57e", GRAY_MID];
export const CHART_W = 250;
export const CHART_H = 190;

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmt = (v: number, k: string) => (k === "pct" ? `${v}%` : k === "dollar" ? `$${v.toLocaleString("en-US")}` : v.toLocaleString("en-US"));

export function chartSvg(chart: OnePagerChart): string {
  const w = CHART_W;
  const h = CHART_H;
  const bars = chart.series.filter((s) => s.kind === "bar");
  const lines = chart.series.filter((s) => s.kind === "line");
  const legend = chart.series.length > 1;
  const top = 34;
  const bottom = h - (legend ? 32 : 18);
  const plotH = bottom - top;
  const slot = w / chart.categories.length;
  const maxBar = Math.max(1, ...bars.flatMap((s) => s.values)) * (lines.length ? 1.55 : 1.18);
  const groupW = slot * 0.72;
  const barW = groupW / Math.max(bars.length, 1);
  const t = (x: number, y: number, size: number, text: string, fill = GRAY, weight = 400) =>
    `<text x="${x}" y="${y}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(text)}</text>`;
  const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`, `<rect width="${w}" height="${h}" fill="#fff"/>`];
  out.push(t(w / 2, 12, 10.5, chart.title, GRAY, 700));
  for (const i of [1, 2, 3]) out.push(`<line x1="0" x2="${w}" y1="${bottom - (plotH * i) / 4}" y2="${bottom - (plotH * i) / 4}" stroke="#bfbfbf" stroke-width="0.4"/>`);
  out.push(`<line x1="0" x2="${w}" y1="${bottom}" y2="${bottom}" stroke="#bfbfbf" stroke-width="0.8"/>`);
  bars.forEach((s, si) =>
    s.values.forEach((v, ci) => {
      const bh = (Math.max(v, 0) / maxBar) * plotH;
      const bx = ci * slot + (slot - groupW) / 2 + si * barW;
      out.push(`<rect x="${bx}" y="${bottom - bh}" width="${barW * 0.92}" height="${bh}" fill="${PALETTE[si % PALETTE.length]}"/>`);
      out.push(t(bx + (barW * 0.92) / 2, bottom - bh - 3, 7.5, fmt(v, s.fmt)));
    }),
  );
  for (const s of lines) {
    const hi = Math.max(1, ...s.values);
    const pts = s.values.map((v, ci) => [ci * slot + slot / 2, top + 10 + plotH * 0.3 * (1 - Math.max(v, 0) / hi)]);
    out.push(`<polyline points="${pts.map((p) => p.join(",")).join(" ")}" fill="none" stroke="${GRAY_MID}" stroke-width="1.6"/>`);
    pts.forEach(([px, py], i) => {
      out.push(`<circle cx="${px}" cy="${py}" r="2.4" fill="${GRAY_MID}"/>`);
      out.push(t(px, py - 6, 7, fmt(s.values[i], s.fmt), GRAY_MID));
    });
  }
  chart.categories.forEach((c, ci) => out.push(t(ci * slot + slot / 2, bottom + 11, 8.5, c)));
  if (legend) out.push(t(w / 2, bottom + 25, 7.5, chart.series.map((s) => `${s.kind === "line" ? "—" : "■"} ${s.name}`).join("   ")));
  out.push("</svg>");
  return out.join("");
}

/** Rasterizes a chart to PNG bytes (browser only), at 3x for print sharpness. */
export function chartPng(chart: OnePagerChart, scale = 3): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = CHART_W * scale;
      canvas.height = CHART_H * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Charts couldn't be drawn in this browser."));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(async (b) => (b ? resolve(new Uint8Array(await b.arrayBuffer())) : reject(new Error("Charts couldn't be drawn."))), "image/png");
    };
    img.onerror = () => reject(new Error("Charts couldn't be drawn."));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(chartSvg(chart))}`;
  });
}
