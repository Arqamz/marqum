#!/usr/bin/env node
// Blocks personal financial data from entering the repo.
//
//   node scripts/guard-personal-data.mjs <files...>   check specific files (pre-commit)
//   node scripts/guard-personal-data.mjs --all        check every tracked file (pre-push, CI)
//
// Rules:
//   1. Statement-like files (.pdf .csv .xlsx .xls) only inside a `fixtures/` directory,
//      and fixtures must be synthetic (see CONTRIBUTING.md).
//   2. Text files must not contain a real-looking IBAN, Pakistani mobile number or CNIC.
//      Placeholders made only of zeros (PK00 SADA 0000 …, 0300-0000000) are allowed.
//   3. A line containing `guard:allow` is skipped (use sparingly, explain why in review).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname } from "node:path";

const STATEMENT_EXT = new Set([".pdf", ".csv", ".xlsx", ".xls"]);
const BINARY_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".ico",
  ".woff",
  ".woff2",
  ".jar",
  ".keystore",
  ".jks",
]);
const SKIP_FILES = new Set(["pnpm-lock.yaml", "scripts/guard-personal-data.mjs"]);

const PATTERNS = [
  { name: "IBAN", re: /\bPK\d{2}[ ]?[A-Z]{4}(?:[ ]?\d{4}){4}\b/g, prefix: /^PK/ },
  { name: "mobile number", re: /(?:\+92[ -]?|\b0)3\d{2}[ -]?\d{7}\b/g, prefix: /^(?:\+92[ -]?|0)3/ },
  { name: "CNIC", re: /\b\d{5}-\d{7}-\d\b/g, prefix: /^/ },
];
// placeholders: every digit after the fixed prefix is 0
const isPlaceholder = (match, prefix) => !/[1-9]/.test(match.replace(prefix, ""));

const args = process.argv.slice(2);
const files = args.includes("--all")
  ? execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean)
  : args;

const problems = [];
for (const file of files) {
  if (SKIP_FILES.has(file) || !existsSync(file) || statSync(file).isDirectory()) continue;
  const ext = extname(file).toLowerCase();
  if (STATEMENT_EXT.has(ext)) {
    if (!/(^|\/)fixtures\//.test(file))
      problems.push(`${file}: statement-type file outside a fixtures/ directory`);
    if (ext !== ".csv") continue;
  }
  if (BINARY_EXT.has(ext)) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (line.includes("guard:allow")) return;
    for (const { name, re, prefix } of PATTERNS) {
      for (const m of line.matchAll(re)) {
        if (!isPlaceholder(m[0], prefix))
          problems.push(`${file}:${i + 1}: looks like a real ${name} (${m[0].slice(0, 6)}…)`);
      }
    }
  });
}

if (problems.length) {
  console.error("✖ personal-data guard blocked this change:\n");
  for (const p of problems) console.error(`  ${p}`);
  console.error("\nReal statements belong in statements/ (gitignored). Use synthetic data in fixtures/.");
  process.exit(1);
}
