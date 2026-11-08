import { dayLabel, formatRs } from "@marqum/core";
import { useLiveQuery } from "dexie-react-hooks";
import { FileUp, LockKeyhole, TriangleAlert } from "lucide-react";
import { useRef, useState } from "react";
import { useDataset } from "../components/dataset-provider.tsx";
import { Headline, Screen, Section } from "../components/shell.tsx";
import { Button } from "../components/ui/button.tsx";
import { cn } from "../lib/cn.ts";
import { db } from "../lib/db.ts";
import { discardIntake, importAnyway, ingestFile, statementLabel, unlockIntake } from "../lib/intake.ts";
import { isNative } from "../lib/platform.ts";

export function ImportScreen() {
  const ds = useDataset();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const waiting = useLiveQuery(
    () => db.intake.where("status").anyOf("needs_look", "needs_password").toArray(),
    [],
    [],
  );
  const statements = [...(ds?.statements ?? [])]
    .sort((a, b) => b.period_to.localeCompare(a.period_to))
    .slice(0, 12);

  async function take(files: FileList | File[]) {
    setBusy(true);
    try {
      for (const f of Array.from(files)) {
        await ingestFile({ name: f.name, mime: f.type, bytes: new Uint8Array(await f.arrayBuffer()) });
      }
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <Screen back title="Statements">
      <Headline
        sub={
          isNative()
            ? "New statements in Downloads import themselves. For SadaPay, generate one and Share it to Marqūm."
            : "Drop NayaPay (PDF or CSV) or SadaPay (PDF) statements. They're read on this device; checks run before anything is imported."
        }
      >
        Import statements
      </Headline>

      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void take(e.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col items-center gap-3 rounded-card border-2 border-dashed px-6 py-10 text-center transition-colors",
          drag ? "border-accent bg-accent-soft" : "border-border-strong bg-surface",
        )}
        data-testid="drop-zone"
      >
        <FileUp className="text-fg-muted" aria-hidden />
        <span className="text-fg-muted">Drop statement files here</span>
        <span className="inline-flex h-10 items-center rounded-control bg-accent px-4 text-sm font-medium text-accent-fg">
          {busy ? "Reading…" : "Choose files"}
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept=".pdf,.csv,application/pdf,text/csv"
        multiple
        hidden
        data-testid="file-input"
        onChange={(e) => e.target.files && void take(e.target.files)}
      />

      {waiting.length > 0 ? (
        <Section title="Needs a look">
          <ul className="flex flex-col gap-3">
            {waiting.map((w) => (
              <li
                key={w.sha256}
                className="flex flex-col gap-3 rounded-card bg-warn-soft p-4"
                data-testid="needs-look"
              >
                <div className="flex items-start gap-3">
                  {w.status === "needs_password" ? (
                    <LockKeyhole className="shrink-0 text-warn" aria-hidden />
                  ) : (
                    <TriangleAlert className="shrink-0 text-warn" aria-hidden />
                  )}
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="font-medium">{w.statement ? statementLabel(w.statement) : w.name}</span>
                    {w.status === "needs_password" ? (
                      <span className="text-sm text-fg-muted">Password-protected — unlock it to import.</span>
                    ) : (
                      <>
                        {w.failed.map((f) => (
                          <span key={f.label} className="text-sm">
                            {f.label}
                          </span>
                        ))}
                        {w.statement ? (
                          <span className="num text-sm text-fg-muted">
                            {w.statement.rows.length} rows · in {formatRs(w.statement.totalIn)} · out{" "}
                            {formatRs(Math.abs(w.statement.totalOut))}
                          </span>
                        ) : null}
                      </>
                    )}
                  </div>
                </div>
                {w.statement && w.statement.rows.length > 0 ? (
                  <ul className="flex flex-col gap-1 rounded-inner bg-surface p-3">
                    {w.statement.rows.slice(0, 4).map((r) => (
                      <li key={r.external_id} className="flex justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate font-mono text-fg-muted">{r.description}</span>
                        <span className="num shrink-0">{formatRs(r.amount, { sign: r.amount > 0 })}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="flex gap-2">
                  {w.status === "needs_password" ? (
                    <Button variant="secondary" size="sm" onClick={() => void unlockIntake(w.sha256)}>
                      Unlock
                    </Button>
                  ) : (
                    <Button variant="secondary" size="sm" onClick={() => void importAnyway(w.sha256)}>
                      Import anyway
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => void discardIntake(w.sha256)}>
                    Discard
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Imported">
        {statements.length === 0 ? (
          <p className="text-sm text-fg-muted">
            Nothing yet. Generate a NayaPay or SadaPay statement — it'll appear here once imported.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {statements.map((s) => (
              <li key={s.id} className="flex items-baseline justify-between gap-4">
                <span className="flex flex-col">
                  <span>{statementLabel({ bank: s.account_id, from: s.period_from, to: s.period_to })}</span>
                  <span className="text-sm text-fg-muted">
                    {s.row_count} rows · imported {dayLabel(s.imported_at.slice(0, 10))}
                    {s.checks.some((c) => !c.ok) ? " · checks failed" : ""}
                  </span>
                </span>
                {s.closing !== null ? <span className="num text-sm">{formatRs(s.closing)}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </Screen>
  );
}
