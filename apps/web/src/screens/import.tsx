import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Card } from "@astryxdesign/core/Card";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { FileInput } from "@astryxdesign/core/FileInput";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { List, ListItem } from "@astryxdesign/core/List";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { type Dataset, dayLabel, formatRs } from "@marqum/core";
import type { Statement, Transaction } from "@marqum/schema";
import { useLiveQuery } from "dexie-react-hooks";
import { FileText, LockKeyhole } from "lucide-react";
import { useState } from "react";
import { useDataset } from "../components/dataset-provider.tsx";
import { DeletedList } from "../components/deleted-list.tsx";
import { Money } from "../components/money.tsx";
import { Headline, Screen } from "../components/shell.tsx";
import { TagSheet } from "../components/tag-sheet.tsx";
import { Button } from "../components/ui/button.tsx";
import { ConfirmButton } from "../components/ui/confirm-button.tsx";
import { Sheet } from "../components/ui/sheet.tsx";
import { db } from "../lib/db.ts";
import { discardIntake, importAnyway, ingestFile, statementLabel, unlockIntake } from "../lib/intake.ts";
import { opt } from "../lib/opt.ts";
import { isNative } from "../lib/platform.ts";
import { type DeletedRow, useDeleted } from "../lib/restore.ts";
import { lookup, timeOf, txnTitle } from "../lib/view.ts";

export function ImportScreen() {
  const ds = useDataset();
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const deleted = useDeleted(ds);
  const waiting = useLiveQuery(
    () => db.intake.where("status").anyOf("needs_look", "needs_password").toArray(),
    [],
    [],
  );
  const statements = [...(ds?.statements ?? [])]
    .sort((a, b) => b.period_to.localeCompare(a.period_to))
    .slice(0, 12);

  async function take(files: File[]) {
    setBusy(true);
    try {
      for (const f of files) {
        await ingestFile({ name: f.name, mime: f.type, bytes: new Uint8Array(await f.arrayBuffer()) });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen back title="Statements">
      <Headline
        {...opt({ sub: isNative() ? "Downloads import themselves. SadaPay: Share to Marqūm." : undefined })}
      >
        Import statements
      </Headline>

      <VStack data-testid="drop-zone">
        <FileInput
          label="Statement files"
          isLabelHidden
          description="NayaPay PDF/CSV · SadaPay PDF"
          mode="dropzone"
          accept=".pdf,.csv,application/pdf,text/csv"
          isMultiple
          isLoading={busy}
          placeholder={busy ? "Reading…" : "Drop or choose files"}
          value={[]}
          onChange={(f) => {
            if (f) void take(Array.isArray(f) ? f : [f]);
          }}
          statusVariant="detached"
          width="100%"
          data-testid="file-input"
        />
      </VStack>

      {waiting.length > 0 ? (
        <VStack as="section" gap={3}>
          <Heading level={2}>Needs a look</Heading>
          <VStack as="ul" gap={3}>
            {waiting.map((w) => (
              <VStack as="li" key={w.sha256} data-testid="needs-look">
                <Banner
                  status="warning"
                  {...(w.status === "needs_password" ? { icon: <LockKeyhole aria-hidden /> } : {})}
                  title={w.statement ? statementLabel(w.statement) : w.name}
                  description={
                    w.status === "needs_password" ? (
                      "Password-protected"
                    ) : (
                      <VStack gap={1}>
                        {w.failed.map((f) => (
                          <Text key={f.label}>{f.label}</Text>
                        ))}
                        {w.statement ? (
                          <Text type="supporting" hasTabularNumbers>
                            {w.statement.rows.length} rows · in {formatRs(w.statement.totalIn)} · out{" "}
                            {formatRs(Math.abs(w.statement.totalOut))}
                          </Text>
                        ) : null}
                      </VStack>
                    )
                  }
                  collapsible={false}
                >
                  <VStack gap={3}>
                    {w.statement && w.statement.rows.length > 0 ? (
                      <List density="compact">
                        {w.statement.rows.slice(0, 4).map((r) => (
                          <ListItem
                            key={r.external_id}
                            label={
                              <Text type="code" color="secondary" maxLines={1}>
                                {r.description}
                              </Text>
                            }
                            endContent={
                              <Text hasTabularNumbers>{formatRs(r.amount, { sign: r.amount > 0 })}</Text>
                            }
                          />
                        ))}
                      </List>
                    ) : null}
                    <HStack gap={2}>
                      {w.status === "needs_password" ? (
                        <Button variant="secondary" size="sm" onClick={() => void unlockIntake(w.sha256)}>
                          Unlock
                        </Button>
                      ) : (
                        <Button variant="secondary" size="sm" onClick={() => void importAnyway(w.sha256)}>
                          Import anyway
                        </Button>
                      )}
                      <ConfirmButton
                        size="sm"
                        width={null}
                        label="Discard"
                        confirm="Tap again: skip this file"
                        onConfirm={() => void discardIntake(w.sha256)}
                      />
                    </HStack>
                  </VStack>
                </Banner>
              </VStack>
            ))}
          </VStack>
        </VStack>
      ) : null}

      <VStack as="section" gap={3}>
        <Heading level={2}>Imported</Heading>
        {statements.length === 0 ? (
          <EmptyState title="Nothing yet" icon={<FileText aria-hidden />} isCompact />
        ) : (
          <Card padding={0}>
            <List hasDividers>
              {statements.map((s) => (
                <ListItem
                  key={s.id}
                  onClick={() => setOpenId(s.id)}
                  label={statementLabel({ bank: s.account_id, from: s.period_from, to: s.period_to })}
                  description={`${s.row_count} rows · ${dayLabel(s.imported_at.slice(0, 10))}`}
                  endContent={
                    <HStack gap={2} vAlign="center">
                      {s.checks.some((c) => !c.ok) ? <Badge label="Checks failed" variant="warning" /> : null}
                      {s.closing !== null ? <Text hasTabularNumbers>{formatRs(s.closing)}</Text> : null}
                    </HStack>
                  }
                />
              ))}
            </List>
          </Card>
        )}
      </VStack>
      {ds ? (
        <StatementSheet
          ds={ds}
          statement={ds.statements.find((x) => x.id === openId) ?? null}
          deleted={deleted}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </Screen>
  );
}

/**
 * One statement reconciled against the ledger: the rows it verified, unverified rows from its period that it
 * doesn't have (still posting, or disputed), and rows you deleted from its period (with Restore).
 */
function StatementSheet({
  ds,
  statement: s,
  deleted,
  onClose,
}: {
  ds: Dataset;
  statement: Statement | null;
  deleted: DeletedRow[];
  onClose: () => void;
}) {
  const [txnId, setTxnId] = useState<string | null>(null);
  const l = lookup(ds);
  const inPeriod = (t: Transaction) =>
    s !== null &&
    t.account_id === s.account_id &&
    t.occurred_at.slice(0, 10) >= s.period_from &&
    t.occurred_at.slice(0, 10) <= s.period_to;
  const byTime = (a: Transaction, b: Transaction) => b.occurred_at.localeCompare(a.occurred_at);
  const onIt = s
    ? ds.transactions.filter((t) => t.statement_id === s.id && t.source !== "system").sort(byTime)
    : [];
  const missing = ds.transactions.filter((t) => t.status !== "verified" && inPeriod(t)).sort(byTime);
  const gone = deleted.filter((d) => inPeriod(d.txn));
  const row = (t: Transaction) => (
    <ListItem
      key={t.id}
      label={txnTitle(t, l)}
      description={`${dayLabel(t.occurred_at.slice(0, 10))}, ${timeOf(t.occurred_at)}${t.status === "disputed" ? " · not on the statement" : t.status === "provisional" ? " · not posted yet" : ""}`}
      endContent={<Money value={Math.abs(t.amount)} {...(t.amount > 0 ? { tone: "pos" as const } : {})} />}
      onClick={() => setTxnId(t.id)}
    />
  );
  return (
    <>
      <Sheet
        open={s !== null && txnId === null}
        onOpenChange={(o) => !o && onClose()}
        title={s ? statementLabel({ bank: s.account_id, from: s.period_from, to: s.period_to }) : ""}
        description={
          s
            ? `${s.row_count} rows${s.opening !== null && s.closing !== null ? ` · ${formatRs(s.opening)} → ${formatRs(s.closing)}` : ""} · imported ${dayLabel(s.imported_at.slice(0, 10))}`
            : undefined
        }
      >
        <VStack gap={5} data-testid="statement-detail">
          {missing.length > 0 ? (
            <VStack gap={2}>
              <Text type="label">{`Unverified · ${missing.length}`}</Text>
              <Text type="supporting">
                From this period but not on this statement. Card payments post a few days late, so the next
                statement usually has them.
              </Text>
              <Card variant="muted" padding={0}>
                <List hasDividers density="compact">
                  {missing.map(row)}
                </List>
              </Card>
            </VStack>
          ) : null}
          {gone.length > 0 ? (
            <VStack gap={2}>
              <Text type="label">{`Deleted · ${gone.length}`}</Text>
              <Card variant="muted" padding={0}>
                <DeletedList ds={ds} rows={gone} inset />
              </Card>
            </VStack>
          ) : null}
          <VStack gap={2}>
            <Text type="label">{`On the statement · ${onIt.length}`}</Text>
            {onIt.length > 0 ? (
              <Card variant="muted" padding={0}>
                <List hasDividers density="compact">
                  {onIt.map(row)}
                </List>
              </Card>
            ) : (
              <Text type="supporting">No rows from tracked months.</Text>
            )}
          </VStack>
        </VStack>
      </Sheet>
      <TagSheet txn={ds.transactions.find((t) => t.id === txnId) ?? null} onClose={() => setTxnId(null)} />
    </>
  );
}
