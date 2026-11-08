// Usage: pnpm --filter @marqum/parsers parse <statement.pdf|csv> [password]
// Prints the parsed statement as JSON (stdout only; nothing is written).
import { readFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { pdfToLines } from "../src/pdf-lines.ts";
import { readCsvStatement, readPdfStatement } from "../src/statements.ts";

const [path, password] = process.argv.slice(2);
if (!path) {
  console.error("usage: parse.ts <statement.pdf|csv> [password]");
  process.exit(2);
}
const data = readFileSync(path);
const isPdf = data.subarray(0, 5).toString("latin1") === "%PDF-";
const st = isPdf
  ? await readPdfStatement(
      await pdfToLines(pdfjs as unknown as Parameters<typeof pdfToLines>[0], new Uint8Array(data), password),
    )
  : await readCsvStatement(data.toString("utf8"));
process.stdout.write(`${JSON.stringify(st, null, 2)}\n`);
