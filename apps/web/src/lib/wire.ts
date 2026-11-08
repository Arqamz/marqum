import type {
  CommandResult,
  LoginResponse,
  PullResponse,
  PushResponse,
  StepUpResponse,
} from "@marqum/schema";

/** Output type of a schema (zod) without depending on zod directly. */
type Out<T extends { _output: unknown }> = T["_output"];

export type LoginResponseT = Out<typeof LoginResponse>;
export type StepUpResponseT = Out<typeof StepUpResponse>;
export type PushResponseT = Out<typeof PushResponse>;
export type PullResponseT = Out<typeof PullResponse>;
export type CommandResultT = Out<typeof CommandResult>;
