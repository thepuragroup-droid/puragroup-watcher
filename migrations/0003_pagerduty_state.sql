-- PagerDuty is tracked separately from email/webhook so a missed page is
-- retried on the next run until PagerDuty confirms it, without re-sending
-- email. pd_open_key = dedup key of the incident PagerDuty has accepted for
-- the current outage (NULL = nothing open); pd_error = last PagerDuty failure.
ALTER TABLE site_state ADD COLUMN pd_open_key TEXT;
ALTER TABLE site_state ADD COLUMN pd_error TEXT;
