-- Marqūm storage: one generic, versioned row store for every synced table, plus auth and the command log.

-- Synced entities (accounts, transactions, statements, …). `data` is the row JSON without version/deleted.
CREATE TABLE rows (
  tbl TEXT NOT NULL,
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL,
  PRIMARY KEY (tbl, id)
);
CREATE INDEX rows_version ON rows (version);

-- Global version counter ("version"), passcode hash ("passcode_hash"), WebAuthn challenges, seed marker.
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO meta (key, value) VALUES ('version', '0');

-- Append-only command log (a failed attempt is overwritten by its successful retry; successes are final).
CREATE TABLE commands (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  device_id TEXT,
  at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  ok INTEGER NOT NULL,
  error TEXT,
  result TEXT,
  args TEXT NOT NULL
);
CREATE INDEX commands_received ON commands (received_at);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen TEXT,
  revoked_at TEXT,
  biometric_secret_hash TEXT
);

CREATE TABLE passkeys (
  id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE step_up (
  token_hash TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Failed passcode attempts per client IP, per 15-minute window.
CREATE TABLE throttle (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at TEXT NOT NULL
);
