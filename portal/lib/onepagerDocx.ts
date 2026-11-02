import type * as Docx from "docx";
import { CHART_H, CHART_W, chartPng } from "./chartSvg";
import type { OnePager } from "./types";

/**
 * The one-pager as an editable Word file, in the mlc-one-pager skill's layout: Poppins, 0.5in top
 * and 0.7in side margins, logo over a green rule, bold centered ask, green-ruled section headers,
 * green bullets with bold lead-ins, charts side by side, small italic footnotes and disclaimer.
 */

const GREEN = "56A446";
const GRAY = "414141";
const GRAY_MID = "7F7F7F";
const FONT = "Poppins";
const IN = 1440; // twips per inch

async function dataUrlBytes(dataUrl: string): Promise<{ bytes: Uint8Array; w: number; h: number }> {
  const bytes = Uint8Array.from(atob(dataUrl.split(",")[1] ?? ""), (c) => c.charCodeAt(0));
  const size = await new Promise<{ w: number; h: number }>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 720, h: img.naturalHeight || 219 });
    img.onerror = () => resolve({ w: 720, h: 219 });
    img.src = dataUrl;
  });
  return { bytes, ...size };
}

export async function buildOnePagerDocx(docx: typeof Docx, p: OnePager, logoDataUrl: string | null): Promise<Blob> {
  const { AlignmentType, BorderStyle, Document, ImageRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } = docx;
  const run = (text: string, o: { size?: number; bold?: boolean; italics?: boolean; color?: string } = {}) =>
    new TextRun({ text, font: FONT, size: Math.round((o.size ?? 9.5) * 2), bold: o.bold, italics: o.italics, color: o.color ?? GRAY });
  const rule = (size: number) => ({ bottom: { style: BorderStyle.SINGLE, size, color: GREEN, space: 1 } });
  const bullet = (children: Docx.TextRun[]) =>
    new Paragraph({ indent: { left: 280, hanging: 160 }, spacing: { after: 60, before: 0 }, children: [run("•  ", { bold: true, color: GREEN }), ...children] });
  const header = (text: string) => new Paragraph({ spacing: { before: 160, after: 80 }, border: rule(6), children: [run(text, { size: 11.5, bold: true })] });

  const children: (Docx.Paragraph | Docx.Table)[] = [];
  if (logoDataUrl) {
    const logo = await dataUrlBytes(logoDataUrl);
    const w = 226; // 2.35in at 96 dpi, as in the skill
    children.push(new Paragraph({ spacing: { after: 0 }, children: [new ImageRun({ type: "png", data: logo.bytes, transformation: { width: w, height: Math.round((w * logo.h) / logo.w) } })] }));
  }
  children.push(new Paragraph({ spacing: { before: 40, after: 120 }, border: rule(14), children: [] }));
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 40, after: 160 }, children: [run(p.capitalAsk, { size: 12, bold: true })] }));
  children.push(header("Company Overview"));
  p.overview.forEach((t) => children.push(bullet([run(t)])));
  children.push(header("Financial Highlights"));
  p.highlights.forEach((h) => children.push(bullet([run(`${h.bold}${h.text ? ": " : ""}`, { bold: true }), run(h.text)])));

  const charts = p.charts.slice(0, 2);
  if (charts.length) {
    const width = charts.length === 2 ? 322 : 528; // 3.35in each, or 5.5in alone
    const images = await Promise.all(charts.map((c) => chartPng(c)));
    const cell = (bytes: Uint8Array) =>
      new TableCell({
        borders: { top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" } },
        width: { size: 50, type: WidthType.PERCENTAGE },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: "png", data: bytes, transformation: { width, height: Math.round((width * CHART_H) / CHART_W) } })] })],
      });
    children.push(new Paragraph({ spacing: { before: 120, after: 0 }, children: [] }));
    children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ children: images.map(cell) })] }));
  }
  p.footnotes.forEach((f) => children.push(new Paragraph({ spacing: { before: 60, after: 0 }, children: [run(f, { size: 7, italics: true, color: GRAY_MID })] })));
  children.push(new Paragraph({ spacing: { before: 80, after: 0 }, children: [run(p.disclaimer, { size: 6.5, italics: true, color: GRAY_MID })] }));

  const doc = new Document({
    creator: "MAP Lab Center",
    title: `MLC ${p.displayName} Teaser`,
    styles: { default: { document: { run: { font: FONT, color: GRAY } } } },
    sections: [{ properties: { page: { size: { width: 8.5 * IN, height: 11 * IN }, margin: { top: 0.5 * IN, bottom: 0.45 * IN, left: 0.7 * IN, right: 0.7 * IN } } }, children }],
  });
  return Packer.toBlob(doc);
}

export function onePagerWordName(p: OnePager): string {
  return `MLC_${p.displayName.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "")}_Teaser.docx`;
}
