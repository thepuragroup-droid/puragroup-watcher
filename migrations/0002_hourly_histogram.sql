-- Latency histogram per hour (JSON array of counts over fixed bucket edges,
-- see src/data/stats.ts HIST_EDGES). Histograms add up exactly, so 6-hour,
-- daily and whole-range percentiles stay honest instead of being estimated
-- from per-hour percentiles.
ALTER TABLE hourly ADD COLUMN hist TEXT;
