# Security

This app handles personal financial data. Each deployment is single-tenant: you run your own Worker, D1 database and R2 bucket.

- **Reporting:** open a private security advisory on GitHub (Security → Report a vulnerability). Don't open a public issue.
- **Data:** statements are parsed on the device. Only parsed transactions are sent to _your own_ Worker. Nothing goes to third parties.
- **Secrets:** Worker secrets (passcode hash, signing keys) are set with `wrangler secret`, and APK signing keys are kept as GitHub Actions secrets. Never commit either.
