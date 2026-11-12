# Alerts to Teams/Slack on down/recovered

When an incident opens or closes, post to a webhook (`env:ALERT_WEBHOOK`). Dedupe so one incident = one open message and one recovery message. Message contains service name and tier only.

**Acceptance:** tests with mock webhook; works from `probe.yml`; no webhook URL ever logged.
