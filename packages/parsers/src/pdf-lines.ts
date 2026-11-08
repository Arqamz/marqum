/**
 * Turns a PDF into positioned text lines. Works in the browser (pdfjs-dist) and in Node
 * (`pdfjs-dist/legacy/build/pdf.mjs`). The pdf.js module is passed in so this package has no hard dependency on it.
 */

export interface Cell {
  x: number;
  text: string;
}
export interface Line {
  page: number;
  y: number;
  cells: Cell[];
  text: string;
}

interface TextItemLike {
  str?: unknown;
  transform?: unknown;
  width?: unknown;
}
interface PdfPageLike {
  getTextContent(): Promise<{ items: readonly unknown[] }>;
}
interface PdfDocLike {
  numPages: number;
  getPage(n: number): Promise<PdfPageLike>;
}
/** The subset of the pdf.js module used here. */
export interface PdfjsLike {
  // biome-ignore lint/suspicious/noExplicitAny: pdf.js' own getDocument signature varies between versions
  getDocument(src: any): { promise: Promise<PdfDocLike> } | { promise: PromiseLike<unknown> };
}

interface Item {
  x: number;
  y: number;
  w: number;
  str: string;
}

export async function pdfToLines(pdfjs: PdfjsLike, data: Uint8Array, password?: string): Promise<Line[]> {
  const src: { data: Uint8Array; password?: string; verbosity: number } = { data, verbosity: 0 };
  if (password !== undefined) src.password = password;
  const doc = (await pdfjs.getDocument(src).promise) as PdfDocLike;
  const lines: Line[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items: Item[] = [];
    for (const raw of content.items) {
      const it = raw as TextItemLike;
      if (typeof it.str !== "string" || it.str.trim() === "" || !Array.isArray(it.transform)) continue;
      items.push({
        x: Number(it.transform[4]),
        y: Number(it.transform[5]),
        w: typeof it.width === "number" ? it.width : 0,
        str: it.str,
      });
    }

    // group into lines by y (top to bottom), tolerance 3pt
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const groups: Item[][] = [];
    for (const it of items) {
      const g = groups.find((gr) => gr[0] !== undefined && Math.abs(gr[0].y - it.y) <= 3);
      if (g) g.push(it);
      else groups.push([it]);
    }
    groups.sort((a, b) => (b[0]?.y ?? 0) - (a[0]?.y ?? 0));

    for (const g of groups) {
      g.sort((a, b) => a.x - b.x);
      // merge items that are close together into one cell
      const cells: Cell[] = [];
      let end = Number.NEGATIVE_INFINITY;
      for (const it of g) {
        const last = cells.at(-1);
        if (last && it.x - end < 6) last.text += (it.x - end > 1.5 ? " " : "") + it.str;
        else cells.push({ x: it.x, text: it.str });
        end = it.x + it.w;
      }
      for (const c of cells) c.text = c.text.replace(/\s+/g, " ").trim();
      lines.push({ page: p, y: g[0]?.y ?? 0, cells, text: cells.map((c) => c.text).join("  ") });
    }
  }
  return lines;
}
