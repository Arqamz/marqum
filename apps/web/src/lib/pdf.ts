import type { PdfjsLike } from "@marqum/parsers";

let loaded: Promise<PdfjsLike> | null = null;

/** pdf.js is large, so it loads on the first PDF only, with its worker bundled as a separate asset. */
export function loadPdfjs(): Promise<PdfjsLike> {
  loaded ??= (async () => {
    const [pdfjs, worker] = await Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    ]);
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs as unknown as PdfjsLike;
  })();
  return loaded;
}

export function isPasswordError(e: unknown): { incorrect: boolean } | null {
  if (typeof e === "object" && e !== null && (e as { name?: string }).name === "PasswordException") {
    return { incorrect: (e as { code?: number }).code === 2 };
  }
  return null;
}
