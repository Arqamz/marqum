import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";

export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const fail = (status: ContentfulStatusCode, code: string, message: string): never => {
  throw new ApiError(status, code, message);
};

/** Parse and validate a JSON body with a zod schema → 400 `{error:"invalid", message}` on failure. */
export async function body<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return fail(400, "invalid", "Body must be JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(
      400,
      "invalid",
      issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : "Invalid body.",
    );
  }
  return parsed.data;
}

/** UTC ISO timestamp (server bookkeeping: devices, command log, expiries). */
export const isoNow = (): string => new Date().toISOString();

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
