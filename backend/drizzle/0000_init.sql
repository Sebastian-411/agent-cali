-- Esquema inicial del agente de monitoreo y verificación.

CREATE TABLE monitored_groups (
  id            SERIAL PRIMARY KEY,
  remote_jid    TEXT NOT NULL UNIQUE,
  group_name    TEXT NOT NULL,
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  role          TEXT NOT NULL DEFAULT 'SOURCE',  -- SOURCE | NOTIFICATION
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reports (
  id                   SERIAL PRIMARY KEY,
  title                TEXT NOT NULL,
  claim                TEXT NOT NULL,
  poll_question        TEXT NOT NULL,
  category             TEXT NOT NULL,
  priority             TEXT NOT NULL DEFAULT 'MEDIUM',
  zone                 TEXT,
  lat                  DOUBLE PRECISION,
  lng                  DOUBLE PRECISION,
  status               TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION',
  scam_flag            BOOLEAN NOT NULL DEFAULT FALSE,
  occurred_approx      TEXT,
  cluster_key          TEXT,
  message_count        INTEGER NOT NULL DEFAULT 0,
  duplicate_count      INTEGER NOT NULL DEFAULT 0,
  distinct_senders     INTEGER NOT NULL DEFAULT 0,
  distinct_groups      INTEGER NOT NULL DEFAULT 0,
  independent_sources  INTEGER NOT NULL DEFAULT 0,
  poll_message_id      TEXT,
  poll_sent_at         TIMESTAMPTZ,
  poll_closes_at       TIMESTAMPTZ,
  votes_yes            INTEGER NOT NULL DEFAULT 0,
  votes_no             INTEGER NOT NULL DEFAULT 0,
  votes_unknown        INTEGER NOT NULL DEFAULT 0,
  confidence           DOUBLE PRECISION,
  admin_note           TEXT,
  closed_at            TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX reports_status_idx   ON reports (status);
CREATE INDEX reports_created_idx  ON reports (created_at DESC);
CREATE INDEX reports_poll_msg_idx ON reports (poll_message_id);

CREATE TABLE messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wa_message_id   TEXT NOT NULL,
  remote_jid      TEXT NOT NULL,
  group_id        INTEGER REFERENCES monitored_groups(id) ON DELETE SET NULL,
  sender_hash     TEXT NOT NULL,
  sender_name     TEXT,
  sent_at         TIMESTAMPTZ NOT NULL,
  type            TEXT NOT NULL DEFAULT 'text',
  content         TEXT NOT NULL DEFAULT '',
  media_url       TEXT,
  normalized_hash TEXT,
  raw             JSONB,
  processed_at    TIMESTAMPTZ,
  relevant        BOOLEAN,
  category        TEXT,
  priority        TEXT,
  certainty       TEXT,
  scam_signal     BOOLEAN NOT NULL DEFAULT FALSE,
  zone            TEXT,
  summary         TEXT,
  report_id       INTEGER REFERENCES reports(id) ON DELETE SET NULL,
  is_duplicate    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (wa_message_id, remote_jid)
);

CREATE INDEX messages_pending_idx ON messages (processed_at, sent_at);
CREATE INDEX messages_report_idx  ON messages (report_id);
CREATE INDEX messages_norm_idx    ON messages (normalized_hash);

CREATE TABLE votes (
  id          SERIAL PRIMARY KEY,
  report_id   INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  voter_hash  TEXT NOT NULL,
  choice      TEXT NOT NULL,          -- YES | NO | UNKNOWN
  source      TEXT NOT NULL,          -- POLL | TEXT
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (report_id, voter_hash)
);

CREATE TABLE evidence (
  id           SERIAL PRIMARY KEY,
  report_id    INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  sender_hash  TEXT NOT NULL,
  kind         TEXT NOT NULL,         -- PHOTO | VIDEO | IN_AREA | WITNESS | EXTERNAL | TEXT
  content      TEXT,
  media_url    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id          SERIAL PRIMARY KEY,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  actor       TEXT NOT NULL DEFAULT 'system',
  detail      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_created_idx ON audit_log (created_at DESC);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
