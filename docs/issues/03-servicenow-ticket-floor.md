# ServiceNow ticket floor (slice 2)

Show open ops tickets (Copilot licenses, AI tools) as characters or a Board tab: queue size, oldest age, SLA risk.
Adapter reads a ServiceNow table API with a read-only account (`env:` secrets). Publish **counts and ages only**: no ticket text, names or numbers.

**Acceptance:** adapter + tests with mock; whitelist updated in `PUBLIC_FIELDS`; no-leak test; docs.
