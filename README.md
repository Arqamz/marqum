# Budget

Local-first personal budgeting for **SadaPay** and **NayaPay** wallets. You use it as a sideloaded Android app or a
website, backed by a free Cloudflare Worker.

- Statements are picked up from the phone automatically and treated as the source of truth.
- Bank notifications become provisional transactions until a statement verifies them.
- Each category shows this month against your average, and outlier months are flagged.
- Each person or merchant you pay has their own spending chart and patterns.
- Loans (debt mode), savings goals, and a "can I afford this?" what-if calculator.
- Month-end close: a checklist, immutable snapshots, and fingerprint-gated edits after close.

> **Status:** foundation only (tooling and hooks). See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design, [docs/DESIGN.md](docs/DESIGN.md) for UI rules,
> and the roadmap below.

## Roadmap

1. Repo foundation: hooks, CI, config ✅
2. `schema`, `core`, `parsers` packages (test-first)
3. API: auth, sync, ingest, backups
4. Web UI: home, activity, tagging, upload
5. Android: Capacitor shell, statement inbox, notification capture, release APKs
6. Analytics: category and counterparty charts, outliers, recurring detection
7. Planning: loans, goals, what-if, month-end close

## Develop

```sh
corepack enable          # provides the pinned pnpm
pnpm install             # also installs git hooks (lefthook)
pnpm verify              # everything CI runs
```

Your own statements go in `statements/`, which is gitignored and never committed.

## License

[MIT](LICENSE)
