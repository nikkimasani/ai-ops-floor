// Adapter registry. An adapter is `{ check(cfg, ctx) -> { ok, ms, error? } }` — see docs/ADAPTERS.md.
// To add one (Azure Monitor, Application Insights, …): create a file here, register it below, add tests.
import * as http from './http.js';
import * as fixture from './fixture.js';
import * as servicenow from './servicenow.js';
import * as copilotSeats from './copilot-seats.js';

export const adapters = { http, fixture, servicenow, 'copilot-seats': copilotSeats };
export const adapterNames = () => Object.keys(adapters);
