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
import { dayLabel, formatRs } from "@marqum/core";
import { useLiveQuery } from "dexie-react-hooks";
import { FileText, LockKeyhole } from "lucide-react";
import { useState } from "react";
import { useDataset } from "../components/dataset-provider.tsx";
import { Headline, Screen } from "../components/shell.tsx";
import { Button } from "../components/ui/button.tsx";
import { db } from "../lib/db.ts";
import { discardIntake, importAnyway, ingestFile, statementLabel, unlockIntake } from "../lib/intake.ts";
import { opt } from "../lib/opt.ts";
import { isNative } from "../lib/platform.ts";

export function ImportScreen() {
  const ds = useDataset();
  const [busy, setBusy] = useState(false);
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
                      <Button variant="ghost" size="sm" onClick={() => void discardIntake(w.sha256)}>
                        Discard
                      </Button>
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
    </Screen>
  );
}
