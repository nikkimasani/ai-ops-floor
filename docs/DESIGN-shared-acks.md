# Design note: shared acknowledgements (issue #9)

**Status: proposal, no code yet.** Decide the open questions at the bottom, then implement behind a flag.

## Problem
"Acknowledge" is stored in the viewer's browser, so teammates can't see who is on an outage and two people may both chase it.

## Constraints
- The dashboard is **static files** (GitHub Pages). It has no server and must not hold any token or write credential.
- Whatever records an ack has to know **who** did it, from a source the browser can't forge.
- Acks must not leak anything new: the published ack is just `{ serviceId, incidentId, by, at }`.

## Options considered
| Option | Who is it? | Browser holds a secret? | Verdict |
|---|---|---|---|
| A. Browser calls the GitHub API with a token | token owner | **Yes** | Rejected: a token in a static page is a leak. |
| B. Small serverless endpoint (Azure Function) | Entra ID login | no | Good, but adds a service to run, secure and monitor. Overkill for v1. |
| **C. Ack by GitHub comment, applied by a workflow** | **GitHub login of the commenter** | **No** | **Recommended.** |
| D. Shared secret in the URL | nobody | yes | Rejected. |

## Recommended: C, "comment `/ack`"
1. Each open incident has a tracking **GitHub issue** (a workflow step opens it when the incident opens and closes it on recovery; title `Incident: <service>`; body has the incident id).
2. The dashboard's **Acknowledge** button opens that issue's "new comment" page (a plain link; no API call). The team member comments `/ack` (optionally `/ack investigating, ticket INC-123`).
3. A workflow on `issue_comment` verifies the commenter has **write or triage permission** on the repo, then writes `{ incidentId, by: <github login>, at, note }` into `acks.json` on the `data` branch (same mechanism as the other data files) and re-deploys Pages.
4. The dashboard reads `acks.json` and shows **"Acknowledged by @login, 12m ago"** on the card, Board and floor bubble; the 🙋 needs-me list drops it.
5. Acks end automatically when the incident closes. Local browser acks stay as the fallback when the feature is off.

**Why this is safe:** identity comes from GitHub's own authentication; the workflow trusts only `github.event.comment.user.login` plus a permission check; the browser needs no secret; the issue is an audit trail for free; and there's nothing new to host.

## What it needs
- `incidents` workflow step that opens/closes tracking issues (needs `issues: write`).
- `ack.yml` workflow on `issue_comment` (needs `contents: write`, `pages: write`).
- `acks.json` whitelisted fields; `PUBLIC_FIELDS` unchanged for services.
- Dashboard: read `acks.json`, render "acknowledged by", `needs()` honours shared acks.
- Feature flag: `site.sharedAcks: true` in config, **off by default**.
- Tests: comment parsing (`/ack` only at line start, ignores quoted text), permission check, ack expiry on recovery, no extra fields published.

## Risks and mitigations
- **Public repo = public issues.** Incident issues would show service names and tier. Only enable this in the private company-org repo, never in the public demo.
- **Comment injection:** only the first token `/ack` is parsed; the note is length-capped and rendered as text, never HTML.
- **Workflow races** (two acks at once): `concurrency` group on the ack workflow, first ack wins, later ones append to `note`.
- **Delay:** an ack appears after the workflow finishes (about 1-2 minutes). The button should say "ack requested" immediately (local) until the shared ack shows up.

## Open questions (need a decision before building)
1. Is a **private company-org repo with issues enabled** acceptable to your team for incident tracking?
2. Should **Teams/Slack alerts** (already built) link to the tracking issue so people can `/ack` from the alert?
3. Who may ack: anyone with triage, or only an `ops` team? (Default: write or triage.)
4. Do you want the tracking issue to double as the incident record (comments, resolution notes)? (Default: yes.)
