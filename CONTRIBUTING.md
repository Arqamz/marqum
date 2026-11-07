# Contributing

## Setup

Requires Node 22+ (`.nvmrc`). Then:

```sh
corepack enable
pnpm install      # installs git hooks via lefthook
```

## Git hooks

| Hook       | Runs                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| pre-commit | personal-data guard, secretlint, Biome format and lint on staged files (fixes are re-staged automatically) |
| commit-msg | commitlint (Conventional Commits)                                                                          |
| pre-push   | guard on the whole repo, `biome ci`, then `turbo run typecheck test build`                                 |

CI runs the same checks plus gitleaks, so skipping hooks with `--no-verify` only moves the failure to CI.

## Commits

Use `type(scope): summary`, for example `feat(parsers): read SadaPay card payments`.
The allowed scopes are `core parsers schema api web android config repo ci deps docs`.

## Personal data, the one hard rule

**Never commit real statements, IBANs, account numbers, phone numbers, CNICs or names from real transactions.**

- Real files go in `statements/` (gitignored).
- Test fixtures must be **synthetic**:
  - copy the layout of a real statement, but use invented names and amounts;
  - IBANs must be all zeros (`PK00 SADA 0000 0000 0000 0000`);
  - phone numbers must be all zeros (`0300-0000000`).
- `scripts/guard-personal-data.mjs` enforces this in hooks and in CI.

## Adding a bank or statement format

See `docs/ADDING_A_BANK.md` once the parsers package lands. In short: add a reader to the `packages/parsers`
registry and a synthetic fixture, then add a test asserting that the statement's checks pass.

## Code conventions

- Money is integer paisa. Never use floats for money.
- Times are Asia/Karachi local strings.
- Domain logic goes in `packages/core` as pure functions with tests. The UI and the Worker stay thin.
