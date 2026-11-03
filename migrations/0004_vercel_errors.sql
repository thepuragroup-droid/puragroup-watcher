-- Server errors from Vercel, for every site (README → "Server errors").
--
-- A Vercel Log Drain POSTs log batches to /ingest/vercel. Error and 5xx lines
-- become rows in error_events; the trigger below rolls each into
-- error_groups, one row per distinct error (by fingerprint). Claude's
-- triage skill writes its analysis onto the group through /api/errors.
--
-- Times are unix ms, like the rest of the schema.

CREATE TABLE IF NOT EXISTS error_groups (
  fingerprint        TEXT PRIMARY KEY,           -- 16 hex; includes the site, so unique across sites
  site_id            TEXT    NOT NULL,           -- src/config.ts id, or 'unmatched'
  title              TEXT    NOT NULL,
  source             TEXT,                       -- lambda | edge | build | static | external | firewall
  route              TEXT,                       -- request path with ids collapsed (/api/orders/:id)
  level              TEXT,
  -- open → analyzed → fix_pending → fixed (→ regressed if it recurs); ignored = known noise
  status             TEXT    NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','analyzed','fix_pending','fixed','ignored','regressed')),
  event_count        INTEGER NOT NULL DEFAULT 0, -- all-time; survives event pruning
  first_seen_at      INTEGER NOT NULL,
  last_seen_at       INTEGER NOT NULL,
  last_status_code   INTEGER,
  last_environment   TEXT,
  last_deployment_id TEXT,
  sample_message     TEXT,                       -- newest full message

  -- Analysis (vercel-errors-triage skill)
  score              INTEGER CHECK (score BETWEEN 0 AND 100),
  severity           TEXT CHECK (severity IN ('critical','high','medium','low')),
  category           TEXT,
  root_cause         TEXT,
  solution           TEXT,
  confidence         TEXT CHECK (confidence IN ('high','medium','low')),
  affected_files     TEXT NOT NULL DEFAULT '[]', -- JSON array of repo paths
  analyzed_at        INTEGER,

  -- Fix tracking (vercel-errors-fix skill, or the dashboard)
  fix_ref            TEXT,                       -- PR or commit URL
  fixed_at           INTEGER,
  status_note        TEXT,
  updated_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_error_groups_site_seen ON error_groups (site_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_groups_seen ON error_groups (last_seen_at DESC);

-- One row per error occurrence. Pruned to 30 days by the cron.
CREATE TABLE IF NOT EXISTS error_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  vercel_log_id  TEXT UNIQUE,                    -- dedupes batches Vercel retries
  fingerprint    TEXT    NOT NULL,
  site_id        TEXT    NOT NULL,
  title          TEXT    NOT NULL,
  ts             INTEGER NOT NULL,
  received_at    INTEGER NOT NULL,
  project_id     TEXT,                           -- Vercel project id
  source         TEXT,
  level          TEXT,
  environment    TEXT,
  deployment_id  TEXT,
  branch         TEXT,
  host           TEXT,
  method         TEXT,
  path           TEXT,
  route          TEXT,
  status_code    INTEGER,
  request_id     TEXT,
  region         TEXT,
  entrypoint     TEXT,
  message        TEXT
);
CREATE INDEX IF NOT EXISTS idx_error_events_fp_ts ON error_events (fingerprint, ts DESC);
CREATE INDEX IF NOT EXISTS idx_error_events_ts ON error_events (ts DESC);
CREATE INDEX IF NOT EXISTS idx_error_events_site_ts ON error_events (site_id, ts DESC);

-- Roll each new occurrence into its group. AFTER INSERT, so a duplicate
-- dropped by INSERT OR IGNORE is never counted.
CREATE TRIGGER IF NOT EXISTS trg_error_events_rollup
AFTER INSERT ON error_events
BEGIN
  INSERT INTO error_groups (
    fingerprint, site_id, title, source, route, level,
    event_count, first_seen_at, last_seen_at,
    last_status_code, last_environment, last_deployment_id, sample_message, updated_at
  ) VALUES (
    NEW.fingerprint, NEW.site_id, NEW.title, NEW.source, NEW.route, NEW.level,
    1, NEW.ts, NEW.ts,
    NEW.status_code, NEW.environment, NEW.deployment_id, NEW.message, NEW.received_at
  )
  ON CONFLICT (fingerprint) DO UPDATE SET
    event_count        = event_count + 1,
    first_seen_at      = MIN(first_seen_at, excluded.first_seen_at),
    last_status_code   = CASE WHEN excluded.last_seen_at >= last_seen_at THEN excluded.last_status_code   ELSE last_status_code END,
    last_environment   = CASE WHEN excluded.last_seen_at >= last_seen_at THEN excluded.last_environment   ELSE last_environment END,
    last_deployment_id = CASE WHEN excluded.last_seen_at >= last_seen_at THEN excluded.last_deployment_id ELSE last_deployment_id END,
    sample_message     = CASE WHEN excluded.last_seen_at >= last_seen_at THEN excluded.sample_message     ELSE sample_message END,
    -- A fixed error that occurs again after the fix is a regression.
    status             = CASE WHEN status = 'fixed' AND fixed_at IS NOT NULL AND excluded.last_seen_at > fixed_at
                              THEN 'regressed' ELSE status END,
    last_seen_at       = MAX(last_seen_at, excluded.last_seen_at),
    updated_at         = excluded.updated_at;
END;

-- Is the drain delivering? Updated at most once a minute (and on rejects), so
-- the dashboard can tell "no errors" apart from "drain not connected".
CREATE TABLE IF NOT EXISTS drain_state (
  id                   INTEGER PRIMARY KEY CHECK (id = 1),
  last_received_at     INTEGER,               -- last accepted batch
  last_rejected_at     INTEGER,               -- last batch refused (bad signature, no secret)
  last_rejected_reason TEXT
);
INSERT OR IGNORE INTO drain_state (id) VALUES (1);
