import { dayLabel, formatRs, monthOf } from "@marqum/core";
import { pdfToLines, readCsvStatement, readPdfStatement, sha256Hex } from "@marqum/parsers";
import type { ParsedStatement } from "@marqum/schema";
import { MarqumNative, type SharedFile } from "../native/marqum-native.ts";
import { base64ToBytes, bytesToBase64 } from "./bytes.ts";
import { enqueue } from "./commands.ts";
import { loadDataset } from "./dataset.ts";
import { db, getMeta, type IntakeEntry, setMeta } from "./db.ts";
import { isPasswordError, loadPdfjs } from "./pdf.ts";
import { isNative } from "./platform.ts";
import { askSecret } from "./prompts.ts";
import { toast } from "./toast.ts";

export interface IncomingFile {
  name: string;
  bytes: Uint8Array;
  mime?: string;
}

export type IntakeOutcome =
  | { kind: "imported"; statement: ParsedStatement; added: number }
  | { kind: "duplicate" }
  | { kind: "needs_look"; statement: ParsedStatement; failed: string[] }
  | { kind: "needs_password" }
  | { kind: "unreadable"; message: string };

const BANK_NAME = { sadapay: "SadaPay", nayapay: "NayaPay" } as const;

/** "NayaPay 1–7 Nov" */
export function statementLabel(s: Pick<ParsedStatement, "bank" | "from" | "to">): string {
  const same = monthOf(s.from) === monthOf(s.to);
  const period = same
    ? `${Number(s.from.slice(8, 10))}–${dayLabel(s.to)}`
    : `${dayLabel(s.from)} – ${dayLabel(s.to)}`;
  return `${BANK_NAME[s.bank]} ${period}`;
}

function isPdf(f: IncomingFile): boolean {
  if (f.mime === "application/pdf" || /\.pdf$/i.test(f.name)) return true;
  // %PDF magic
  return f.bytes[0] === 0x25 && f.bytes[1] === 0x50 && f.bytes[2] === 0x44 && f.bytes[3] === 0x46;
}

async function parse(f: IncomingFile, password?: string): Promise<ParsedStatement> {
  if (isPdf(f)) {
    const pdfjs = await loadPdfjs();
    // pdf.js transfers (detaches) the buffer it gets, so hand it a copy
    return readPdfStatement(await pdfToLines(pdfjs, f.bytes.slice(), password));
  }
  return readCsvStatement(new TextDecoder().decode(f.bytes));
}

async function parseWithPassword(
  f: IncomingFile,
  interactive: boolean,
): Promise<ParsedStatement | "needs_password" | "cancelled"> {
  try {
    return await parse(f);
  } catch (e) {
    if (!isPasswordError(e)) throw e;
  }
  if (!interactive) return "needs_password";
  let error: string | undefined;
  for (;;) {
    const password = await askSecret({
      kind: "password",
      title: `${f.name} is locked`,
      detail: "Enter the statement password your bank set (often your CNIC or date of birth).",
      confirm: "Unlock",
      ...(error ? { error } : {}),
    });
    if (!password) return "cancelled";
    try {
      return await parse(f, password);
    } catch (e) {
      const pw = isPasswordError(e);
      if (!pw) throw e;
      error = "That password didn't open it.";
    }
  }
}

/**
 * The one intake pipeline (inbox scan, share sheet, web upload): hash → skip if seen → parse in the
 * browser → import automatically when every check passes, otherwise park it under "Needs a look".
 */
export async function ingestFile(
  f: IncomingFile,
  opts: { interactive?: boolean } = {},
): Promise<IntakeOutcome> {
  const sha256 = await sha256Hex(f.bytes);
  const seen = await db.intake.get(sha256);
  const { dataset } = await loadDataset();
  if (seen?.status === "imported" || seen?.status === "discarded") return { kind: "duplicate" };
  if (dataset.statements.some((s) => s.file_sha256 === sha256)) {
    await record({
      sha256,
      name: f.name,
      status: "imported",
      statement: null,
      failed: [],
      error: null,
      base64: null,
    });
    return { kind: "duplicate" };
  }

  let parsed: Awaited<ReturnType<typeof parseWithPassword>>;
  try {
    parsed = await parseWithPassword(f, opts.interactive ?? true);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await record({
      sha256,
      name: f.name,
      status: "unreadable",
      statement: null,
      failed: [],
      error: message,
      base64: null,
    });
    toast({ tone: "error", title: `Couldn't read ${f.name}`, detail: message });
    return { kind: "unreadable", message };
  }
  if (parsed === "needs_password" || parsed === "cancelled") {
    await record({
      sha256,
      name: f.name,
      status: "needs_password",
      statement: null,
      failed: [],
      error: null,
      base64: bytesToBase64(f.bytes),
    });
    return { kind: "needs_password" };
  }

  const failed = parsed.checks.filter((c) => !c.ok).map((c) => c.label);
  if (failed.length > 0) {
    await record({
      sha256,
      name: f.name,
      status: "needs_look",
      statement: parsed,
      failed: failed.map((label) => ({ label })),
      error: null,
      base64: null,
    });
    toast({
      tone: "warn",
      title: `${statementLabel(parsed)} needs a look`,
      detail: failed.length === 1 ? (failed[0] ?? "") : `${failed.length} checks didn't pass`,
    });
    return { kind: "needs_look", statement: parsed, failed };
  }

  const known = new Set(dataset.transactions.map((t) => t.external_id).filter(Boolean));
  const added = parsed.rows.filter((r) => !known.has(r.external_id)).length;
  await importParsed(sha256, f.name, parsed);
  toast({ tone: "success", title: `Imported ${statementLabel(parsed)} · ${added} new` });
  return { kind: "imported", statement: parsed, added };
}

async function record(e: Omit<IntakeEntry, "seen_at">): Promise<void> {
  await db.intake.put({ ...e, seen_at: Date.now() });
}

async function importParsed(sha256: string, name: string, statement: ParsedStatement): Promise<void> {
  await enqueue("importStatement", { statement, file_name: name, file_sha256: sha256 });
  await record({ sha256, name, status: "imported", statement: null, failed: [], error: null, base64: null });
}

/** "Import anyway" from the Needs-a-look list. */
export async function importAnyway(sha256: string): Promise<void> {
  const e = await db.intake.get(sha256);
  if (!e?.statement) return;
  await importParsed(sha256, e.name, e.statement);
  toast({ tone: "success", title: `Imported ${statementLabel(e.statement)}` });
}

export async function discardIntake(sha256: string): Promise<void> {
  await db.intake.update(sha256, { status: "discarded", statement: null, base64: null });
}

/** Retry a locked file (asks for the password). */
export async function unlockIntake(sha256: string): Promise<void> {
  const e = await db.intake.get(sha256);
  if (!e?.base64) return;
  await db.intake.delete(sha256);
  await ingestFile({ name: e.name, bytes: base64ToBytes(e.base64) }, { interactive: true });
}

// ── Android: statement inbox + share sheet ─────────────────────────────────────────────

let scanning = false;
export async function scanInbox(): Promise<void> {
  if (!isNative() || scanning) return;
  scanning = true;
  try {
    const { granted } = await MarqumNative.checkFileAccess();
    if (!granted) return;
    const since = await getMeta<number>("lastScan", 0);
    const started = Date.now();
    const { files } = await MarqumNative.scanStatements({ since });
    for (const file of files.sort((a, b) => a.modified - b.modified)) {
      const { base64 } = await MarqumNative.readFile({ path: file.path });
      await ingestFile({ name: file.name, bytes: base64ToBytes(base64) }, { interactive: false });
    }
    await setMeta("lastScan", started);
  } catch (e) {
    // NO_FILE_ACCESS means the permission was revoked since the check — not an error worth surfacing.
    if ((e as { code?: string }).code !== "NO_FILE_ACCESS") console.warn("statement scan failed", e);
  } finally {
    scanning = false;
  }
}

export async function ingestShared(files: SharedFile[]): Promise<void> {
  for (const f of files) {
    await ingestFile({ name: f.name, mime: f.mime, bytes: base64ToBytes(f.base64) }, { interactive: true });
  }
}

export async function drainShares(): Promise<void> {
  if (!isNative()) return;
  try {
    const { files } = await MarqumNative.getPendingShares();
    await ingestShared(files);
  } catch (e) {
    console.warn("share intake failed", e);
  }
}

export function formatStatementTotals(s: ParsedStatement): string {
  return `${s.rows.length} rows · in ${formatRs(s.totalIn)} · out ${formatRs(Math.abs(s.totalOut))}`;
}
