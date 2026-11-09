import { NotificationIngest } from "@marqum/schema";
import { Hono } from "hono";
import type { AppEnv } from "../env.ts";
import { body } from "../lib/http.ts";
import { ingestNotification } from "../lib/ingest.ts";

export const ingest = new Hono<AppEnv>();

ingest.post("/notification", async (c) =>
  c.json(await ingestNotification(c.env, c.get("device").id, await body(c, NotificationIngest))),
);
