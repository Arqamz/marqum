/**
 * @marqum/parsers — bank statement (PDF/CSV) and notification parsers.
 * Bank formats live here so adding a bank is a contained change (see docs/ADDING_A_BANK.md).
 * PDF text extraction is in "@marqum/parsers/pdf" (needs pdf.js passed in).
 */
export { parseCsv } from "./csv.ts";
export { type DetectedFile, detectStatementFile } from "./detect.ts";
export { type ParsedNotification, parseNotification } from "./notifications.ts";
export { type Cell, type Line, type PdfjsLike, pdfToLines } from "./pdf-lines.ts";
export { extractReason, readCsvStatement, readPdfStatement, StatementError } from "./statements.ts";
export { parseAmount, parseDate, sha256Hex } from "./util.ts";
