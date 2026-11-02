-- One row per site per check run (every 5 minutes). Pruned to 90 days.
CREATE TABLE IF NOT EXISTS checks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id      TEXT    NOT NULL,
  ts           INTEGER NOT NULL,          -- unix ms
  ok           INTEGER NOT NULL,          -- 1 = every target passed
  slow         INTEGER NOT NULL DEFAULT 0,-- 1 = passed but slower than the site's slowMs
  retried      INTEGER NOT NULL DEFAULT 0,-- 1 = a target failed once and was retried
  health_code  INTEGER,                   -- HTTP status of /api/health (NULL = no response)
  health_ms    INTEGER,
  home_code    INTEGER,                   -- HTTP status of the homepage
  home_ms      INTEGER,
  error        TEXT                       -- what failed, NULL when ok
);
CREATE INDEX IF NOT EXISTS idx_checks_site_ts ON checks (site_id, ts DESC);

-- Hourly rollup per site, rewritten each run for the current hour. Feeds the
-- 7/30/90-day views so they read hundreds of rows, not tens of thousands.
CREATE TABLE IF NOT EXISTS hourly (
  site_id     TEXT    NOT NULL,
  hour_ts     INTEGER NOT NULL,           -- unix ms at the top of the hour (UTC)
  checks      INTEGER NOT NULL,
  ok_checks   INTEGER NOT NULL,
  slow_checks INTEGER NOT NULL,
  p50_ms      INTEGER,
  p95_ms      INTEGER,
  max_ms      INTEGER,
  PRIMARY KEY (site_id, hour_ts)
);

-- One row per outage.
CREATE TABLE IF NOT EXISTS incidents (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id      TEXT    NOT NULL,
  started_at   INTEGER NOT NULL,          -- first failed check
  detected_at  INTEGER NOT NULL,          -- outage declared
  resolved_at  INTEGER,                   -- NULL while ongoing
  cause        TEXT,                      -- first failure
  last_error   TEXT,
  alerts_sent  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_incidents_site ON incidents (site_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_started ON incidents (started_at DESC);

-- Current state per site (the alerting state machine).
CREATE TABLE IF NOT EXISTS site_state (
  site_id               TEXT PRIMARY KEY,
  status                TEXT    NOT NULL DEFAULT 'unknown', -- up | down | unknown
  consecutive_failures  INTEGER NOT NULL DEFAULT 0,
  failing_since         INTEGER,
  down_since            INTEGER,
  last_alert_at         INTEGER,
  last_alert_error      TEXT,
  last_checked_at       INTEGER,
  incident_id           INTEGER
);
