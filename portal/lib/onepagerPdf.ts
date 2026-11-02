import type { jsPDF } from "jspdf";
import type { OnePager, OnePagerChart } from "./types";

/**
 * Draws the one-pager as a single US-letter PDF in the MLC layout: logo over a green rule,
 * bold centered capital ask, two bulleted sections with green rules, up to two charts side by
 * side, then footnotes and the disclaimer. Shrinks slightly when needed so it stays on one page.
 */

type RGB = [number, number, number];
const GREEN: RGB = [86, 164, 70];
const GREEN_LT: RGB = [140, 197, 126];
const GRAY: RGB = [65, 65, 65];
const GRAY_MID: RGB = [127, 127, 127];
const GRAY_LT: RGB = [191, 191, 191];
const PALETTE = [GREEN, GRAY, GREEN_LT, GRAY_MID];

const PAGE_W = 612;
const PAGE_H = 792;
const LEFT = 50;
const WIDTH = PAGE_W - LEFT * 2;
const TOP = 36;
const BOTTOM = 30;

type Run = { text: string; bold: boolean };

function setFont(doc: jsPDF, size: number, style: "normal" | "bold" | "italic" = "normal", color: RGB = GRAY) {
  doc.setFont("helvetica", style);
  doc.setFontSize(size);
  doc.setTextColor(...color);
}

/** Word-wraps runs of mixed bold and regular text into lines of positioned pieces. */
function wrap(doc: jsPDF, runs: Run[], width: number, size: number) {
  const lines: { text: string; bold: boolean; x: number }[][] = [[]];
  let x = 0;
  for (const run of runs) {
    setFont(doc, size, run.bold ? "bold" : "normal");
    const space = doc.getTextWidth(" ");
    for (const word of run.text.split(/\s+/).filter(Boolean)) {
      const w = doc.getTextWidth(word);
      if (x > 0 && x + w > width) {
        lines.push([]);
        x = 0;
      }
      lines[lines.length - 1].push({ text: word, bold: run.bold, x });
      x += w + space;
    }
  }
  return lines;
}

const fmt = (v: number, kind: string) => (kind === "pct" ? `${v}%` : kind === "dollar" ? `$${v.toLocaleString("en-US")}` : v.toLocaleString("en-US"));

function drawChart(doc: jsPDF, chart: OnePagerChart, x: number, y: number, w: number, h: number) {
  setFont(doc, 10.5, "bold");
  doc.text(chart.title, x + w / 2, y + 11, { align: "center" });
  const bars = chart.series.filter((s) => s.kind === "bar");
  const lines = chart.series.filter((s) => s.kind === "line");
  const legend = chart.series.length > 1;
  const plotTop = y + 30;
  const plotBottom = y + h - (legend ? 30 : 16);
  const plotH = plotBottom - plotTop;
  const n = chart.categories.length;
  const slot = w / n;
  // With a line series, bars keep to the lower part and the line gets its own band above them.
  const maxBar = Math.max(1, ...bars.flatMap((s) => s.values)) * (lines.length ? 1.55 : 1.18);

  doc.setDrawColor(...GRAY_LT);
  doc.setLineWidth(0.4);
  for (let i = 1; i <= 3; i++) doc.line(x, plotBottom - (plotH * i) / 4, x + w, plotBottom - (plotH * i) / 4);
  doc.setLineWidth(0.8);
  doc.line(x, plotBottom, x + w, plotBottom);

  const groupW = slot * 0.72;
  const barW = groupW / Math.max(bars.length, 1);
  bars.forEach((s, si) => {
    s.values.forEach((v, ci) => {
      const bh = (Math.max(v, 0) / maxBar) * plotH;
      const bx = x + ci * slot + (slot - groupW) / 2 + si * barW;
      // Text drawing changes the fill color, so set it for every bar.
      doc.setFillColor(...PALETTE[si % PALETTE.length]);
      doc.rect(bx, plotBottom - bh, barW * 0.92, bh, "F");
      setFont(doc, 7.5, "normal");
      doc.text(fmt(v, s.fmt), bx + (barW * 0.92) / 2, plotBottom - bh - 3, { align: "center" });
    });
  });

  lines.forEach((s) => {
    // Scaled from zero, like the skill's secondary axis, so small moves look small.
    const hi = Math.max(1, ...s.values);
    const bandTop = plotTop + 10;
    const bandH = plotH * 0.3;
    const pts = s.values.map((v, ci) => [x + ci * slot + slot / 2, bandTop + bandH * (1 - Math.max(v, 0) / hi)] as const);
    doc.setDrawColor(...GRAY_MID);
    doc.setLineWidth(1.6);
    for (let i = 1; i < pts.length; i++) doc.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
    pts.forEach(([px, py], i) => {
      doc.setFillColor(...GRAY_MID);
      doc.circle(px, py, 2.4, "F");
      setFont(doc, 7, "normal", GRAY_MID);
      doc.text(fmt(s.values[i], s.fmt), px, py - 6, { align: "center" });
    });
  });

  setFont(doc, 8.5, "normal");
  chart.categories.forEach((c, ci) => doc.text(c, x + ci * slot + slot / 2, plotBottom + 11, { align: "center" }));

  if (legend) {
    setFont(doc, 7.5, "normal");
    const items = chart.series.map((s, i) => ({ s, color: s.kind === "line" ? GRAY_MID : PALETTE[bars.indexOf(s) % PALETTE.length] ?? PALETTE[i] }));
    const widths = items.map(({ s }) => doc.getTextWidth(s.name) + 14);
    let lx = x + (w - widths.reduce((a, b) => a + b, 0)) / 2;
    const ly = plotBottom + 24;
    items.forEach(({ s, color }, i) => {
      doc.setFillColor(...color);
      if (s.kind === "line") doc.rect(lx, ly - 3, 8, 1.6, "F");
      else doc.rect(lx, ly - 5.5, 7, 7, "F");
      setFont(doc, 7.5, "normal");
      doc.text(s.name, lx + 10, ly);
      lx += widths[i];
    });
  }
}

/** Lays out the page; with draw=false it only measures. Returns the y where content ends. */
function layout(doc: jsPDF, p: OnePager, logo: { data: string; w: number; h: number } | null, scale: number, draw: boolean, chartExtra = 0) {
  let y = TOP;
  if (logo) {
    const lw = 169;
    const lh = (lw * logo.h) / logo.w;
    if (draw) doc.addImage(logo.data, "PNG", LEFT, y, lw, lh);
    y += lh;
  }
  y += 5;
  if (draw) {
    doc.setDrawColor(...GREEN);
    doc.setLineWidth(1.75);
    doc.line(LEFT, y, LEFT + WIDTH, y);
  }
  y += 20 * scale;

  const askSize = 12 * scale;
  for (const line of wrap(doc, [{ text: p.capitalAsk, bold: true }], WIDTH - 20, askSize)) {
    if (draw) {
      setFont(doc, askSize, "bold");
      doc.text(line.map((l) => l.text).join(" "), LEFT + WIDTH / 2, y, { align: "center" });
    }
    y += askSize * 1.3;
  }
  y += 6 * scale;

  const section = (title: string, bullets: Run[][]) => {
    y += 8 * scale;
    if (draw) {
      setFont(doc, 11.5 * scale, "bold");
      doc.text(title, LEFT, y);
      doc.setDrawColor(...GREEN);
      doc.setLineWidth(0.75);
      doc.line(LEFT, y + 4, LEFT + WIDTH, y + 4);
    }
    y += 18 * scale;
    const size = 9.5 * scale;
    for (const runs of bullets) {
      const lines = wrap(doc, runs, WIDTH - 14, size);
      lines.forEach((line, i) => {
        if (draw) {
          if (i === 0) {
            setFont(doc, size, "bold", GREEN);
            doc.text("•", LEFT + 2, y);
          }
          for (const piece of line) {
            setFont(doc, size, piece.bold ? "bold" : "normal");
            doc.text(piece.text, LEFT + 14 + piece.x, y);
          }
        }
        y += size * 1.32;
      });
      y += 3 * scale;
    }
  };

  section("Company Overview", p.overview.map((t) => [{ text: t, bold: false }]));
  section("Financial Highlights", p.highlights.map((h) => [{ text: `${h.bold}:`, bold: true }, { text: h.text, bold: false }]));

  const charts = p.charts.slice(0, 2);
  if (charts.length) {
    y += 10 * scale;
    const chartH = 178 * scale + chartExtra;
    const gap = 18;
    const cw = charts.length === 2 ? (WIDTH - gap) / 2 : WIDTH * 0.62;
    if (draw) charts.forEach((c, i) => drawChart(doc, c, charts.length === 2 ? LEFT + i * (cw + gap) : LEFT + (WIDTH - cw) / 2, y, cw, chartH));
    y += chartH + 6;
  }

  for (const note of p.footnotes) {
    for (const line of wrap(doc, [{ text: note, bold: false }], WIDTH, 7)) {
      if (draw) {
        setFont(doc, 7, "italic", GRAY_MID);
        doc.text(line.map((l) => l.text).join(" "), LEFT, y);
      }
      y += 9;
    }
  }
  y += 3;
  for (const line of wrap(doc, [{ text: p.disclaimer, bold: false }], WIDTH, 6.5)) {
    if (draw) {
      setFont(doc, 6.5, "italic", GRAY_MID);
      doc.text(line.map((l) => l.text).join(" "), LEFT, y);
    }
    y += 8.5;
  }
  return y;
}

/** Reads an image's pixel size so the logo keeps its proportions. */
function imageSize(data: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 720, h: img.naturalHeight || 219 });
    img.onerror = () => resolve({ w: 720, h: 219 });
    img.src = data;
  });
}

export async function buildOnePagerPdf(JsPDF: typeof jsPDF, p: OnePager, logoDataUrl: string | null): Promise<Blob> {
  const doc = new JsPDF({ unit: "pt", format: "letter", compress: true });
  const logo = logoDataUrl ? { data: logoDataUrl, ...(await imageSize(logoDataUrl)) } : null;
  let scale = 1;
  for (const s of [1, 0.94, 0.88, 0.82, 0.76]) {
    scale = s;
    if (layout(doc, p, logo, s, false) <= PAGE_H - BOTTOM) break;
  }
  // Spare room at the bottom goes to the charts.
  const spare = p.charts.length ? Math.min(90, Math.max(0, PAGE_H - BOTTOM - layout(doc, p, logo, scale, false) - 10)) : 0;
  layout(doc, p, logo, scale, true, spare);
  doc.setProperties({ title: `MLC ${p.displayName} Teaser`, author: "MAP Lab Center" });
  return doc.output("blob");
}

export function onePagerFileName(p: OnePager): string {
  return `MLC_${p.displayName.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "")}_Teaser.pdf`;
}
