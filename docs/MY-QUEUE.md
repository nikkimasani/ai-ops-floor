# My Queue: one calm view of what's assigned to you

A **local-only** panel that pulls the ServiceNow incidents/tasks and Azure DevOps work items assigned to *you*, puts them in one
order with a plain-words reason, and shows a **triage agent walking onto the floor** for each new assignment. Your own
Copilot triage skill does the actual work.

```bash
npm run queue:demo                          # fictional tickets + a canned triage: try it first, no credentials
npm run queue -- --config .local/queue.json # your real sources
```
Then open the address it prints (http://localhost:3100 by default).

## What you see
- **Do this next**: one card (the top item you can act on), with why: `priority 1 · not started · open 3d`.
- **Then**: the next three. **Show all (N)** reveals the rest. Items on hold sort last.
- When a ticket is **assigned to you**, a toast appears and a **Triage agent** walks in and takes a desk (thinking 💭, "ready to triage").
- **Triage with Copilot** starts your triage command; the agent works 💻 until it finishes, then goes on a break 💤 and the card shows **View triage**.
- If triage fails, the agent turns red 🚧 and the card says why. Failed triage shows in 🙋 *needs me*.
- A full floor is fine: triage agents wait off duty in the lounge rather than taking a service's desk.

## Where your data goes
| | |
|---|---|
| Ticket titles/numbers | In memory in the local server and in your browser tab. **Never** written to `public/data`, never committed, never on GitHub Pages. |
| Credentials | Only environment variables on your machine, referenced as `env:NAME`. The config validator rejects a literal URL, user, password or token. |
| Triage results | Saved as `.local/triage/*.md` (git-ignored, owner-only permissions). |
| What the triage command receives | Only the fields in your prompt template (`{ref} {title} {source} {kind} {state} {priority} {url}`). **Not the description.** |
| The triage command's environment | Minimal: `PATH`, `HOME` and similar. The ServiceNow password and Azure DevOps token are **not** passed to it. |
| The server | Binds `127.0.0.1` only, rejects other `Host` headers (DNS rebinding), and the Triage button needs a same-origin request with a custom header. |

Ticket text is untrusted: a title can contain instructions aimed at an AI. That is why triage never auto-runs unless you set
`"auto": true`, why only the title and reference go in the prompt, and why results are labelled *AI-generated: check before acting*.
Run the Copilot CLI with the **fewest permissions** that let your skill do read-only triage.

## Set it up
1. `cp config/queue.example.json .local/queue.json` (the `.local/` folder is git-ignored).
2. **ServiceNow:** a read-only account that can read `incident` (and `sc_task` if you want requests). Set `SN_INSTANCE` (`https://yourco.service-now.com`), `SN_USER`, `SN_PASSWORD` in your shell. Items are those where `assigned_to.user_name` is `SN_USER` (set `"assignedTo": "env:SN_ME"` if you sign in with a different account than yours).
3. **Azure DevOps:** a personal access token with **Work Items (Read)** only. Set `ADO_ORG`, `ADO_PAT` (and `ADO_PROJECT` to limit to one project). It lists work items assigned to `@Me` (the token's owner) that aren't Closed/Done/Removed/Resolved.
4. **Triage command:** edit `triage.command` in the config. It is an **array**, one element per argument, run **without a shell**:
   ```json
   "command": ["gh", "copilot", "--", "<non-interactive flags>", "/triage {ref}: {title}"]
   ```
   The exact non-interactive flags depend on your Copilot CLI version. Run `gh copilot --help` (and the Copilot CLI's own help) on your machine and use the
   "run one prompt and exit" option. **I couldn't verify these flags** (GitHub's docs weren't reachable from my environment), so the example ships with a placeholder and the server refuses to start until you replace it.
   Check on a throwaway prompt in your terminal first that `/triage <something>` prints a result and exits.
   On Windows, use the full path to the executable if `gh` or `copilot` isn't found (a `.cmd` shim can't be started without a shell).
5. `npm run queue -- --config .local/queue.json` and open the printed address.

## Settings
| Setting | Default | Meaning |
|---|---|---|
| `pollSec` | 120 | How often to re-read ServiceNow and Azure DevOps |
| `triage.auto` | `false` | `true` starts triage by itself when a **new** ticket is assigned (never for tickets already there at start-up) |
| `triage.timeoutSec` | 300 | Hard kill after this long |
| `triage.concurrency` | 1 | Jobs at a time; others wait their turn |
| `triage.passEnv` | `[]` | Extra variable names the command may see (e.g. `GH_TOKEN`). Credential names are rejected |

## Your own Azure Function apps (including the dashboard)
Monitoring is the existing floor, not My Queue: add each Function app to `config/services.json` with the `http` adapter
(`docs/FUNCTION-APP-HEALTH.md`) or `azure-monitor` (`docs/ADAPTERS.md`). To watch the dashboard itself, add its public `status.json` as an `http` check
with `expectBodyIncludes`, and the floor already goes red if the probe stops (staleness banner).

## Not verified against real systems
The ServiceNow and Azure DevOps calls follow the documented REST APIs and are tested against mocks only. The Copilot CLI hand-off has only been run with a stand-in command.
Try each source on its own first (a one-source config) and tell Copilot or me what you see.

## Troubleshooting
| You see | Likely cause |
|---|---|
| `ServiceNow ✗ HTTP 401/403` | Wrong user/password, or the account can't read that table |
| `Azure DevOps ✗ HTTP 401/203` | Token expired, wrong org, or missing *Work Items (Read)* |
| `connection failed` | The machine can't reach the service (VPN?). The URL is deliberately not shown |
| `triage command not found` | `gh`/`copilot` not on `PATH` for the server's shell, or use a full path |
| `exited with code N` | Run the same command by hand in a terminal to see its own error |
| `produced no output` | The command ran but printed nothing: check you used its non-interactive mode |
| `timed out` | Raise `timeoutSec`, or the skill is waiting for input it will never get |
