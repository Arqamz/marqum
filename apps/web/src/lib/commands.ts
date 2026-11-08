import { karachiNow } from "@marqum/core";
import type { Command, CommandArgs, CommandName } from "@marqum/schema";
import { ulid } from "ulidx";
import { db } from "./db.ts";
import { scheduleSync } from "./sync.ts";

/**
 * Queue a command. The UI reflects it immediately (useDataset previews the outbox through core.execute)
 * and the sync engine pushes it in the background.
 */
export async function enqueue<N extends CommandName>(name: N, args: CommandArgs<N>): Promise<Command> {
  const command = { id: ulid(), name, at: karachiNow(), args } as Command;
  await db.outbox.add({ id: command.id, command, queued_at: Date.now() });
  scheduleSync();
  return command;
}

export const newId = (): string => ulid();
