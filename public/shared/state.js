// Authoritative office state. Every change is an event; events are applied here and broadcast to
// browsers over SSE. Anything that can POST an event (demo director, pipeline, real-agent runner,
// Claude Code hooks) drives the office.

import { AGENTS, HAIR, HAIR_COLORS, DRESS, ACCENT } from './agents.js';
import { SEATS } from './layout.js';

export const STATUSES = new Set(['idle', 'thinking', 'working', 'blocked', 'asking', 'ready', 'dark', 'bench', 'done']);
const LOG_LIMIT = 40;
const GIT_KEYS = ['branch', 'ahead', 'dirty'];

export class Office {
  // empty: start with no agents; they join dynamically (live Claude Code hooks).
  constructor({ empty = false } = {}) {
    this.listeners = new Set();
    this.seq = 0;
    this.joined = 0;
    this.tasks = [];
    this.walkins = new Map();
    this.busy = new Set();      // agents currently owned by a dispatched pipeline task
    this.agents = {};
    if (!empty) for (const a of AGENTS) this.#add({ ...a });
  }

  snapshot() {
    return {
      agents: Object.values(this.agents).map((a) => this.pub(a)),
      tasks: this.tasks.slice(-8),
      walkins: [...this.walkins.values()],
      seq: this.seq,
    };
  }

  // The fields a browser needs (everything but the log).
  pub(a) { const { log, ...rest } = a; return rest; }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  // Own room first, then the bullpen, then anywhere with a free desk. -1 when the office is full.
  freeSeat(room) {
    const taken = new Set(Object.values(this.agents).map((x) => x.seat));
    const find = (pred) => SEATS.findIndex((s, i) => !taken.has(i) && pred(s));
    for (const i of [find((s) => s.room === room), find((s) => s.room === 'bullpen'), find(() => true)]) if (i >= 0) return i;
    return -1;
  }

  #add(info) {
    const n = this.joined++;
    const agent = {
      id: info.id, name: String(info.name || info.id).slice(0, 24), role: String(info.role || 'Agent').slice(0, 28),
      room: info.room || 'bullpen',
      color: info.color || DRESS[n % DRESS.length], accent: info.accent || ACCENT[n % ACCENT.length],
      hair: info.hair || HAIR[n % HAIR.length], hairColor: info.hairColor || HAIR_COLORS[(n * 3) % HAIR_COLORS.length],
      seat: info.seatless ? -1 : this.freeSeat(info.room || 'bullpen'),   // seatless agents (My Queue triage) never take a desk from a monitored service
      status: 'idle', task: null, tool: null, note: null, decision: null, blocker: null,
      branch: null, ahead: 0, dirty: 0, since: info.since || Date.now(), toolCalls: 0, tasksDone: 0, log: [], meta: info.meta || null,
    };
    this.agents[agent.id] = agent;
    return agent;
  }

  // Validates + applies an event. Returns the stored event or throws.
  emit(input) {
    const ev = { ...input, ts: Date.now(), seq: ++this.seq };
    const a = this.agents[ev.agent];
    const need = (cond, msg) => { if (!cond) { this.seq--; throw new Error(msg); } };

    switch (ev.type) {
      case 'status': {
        need(a, `unknown agent "${ev.agent}"`);
        need(STATUSES.has(ev.status), `bad status "${ev.status}"`);
        if (a.status !== ev.status) a.since = ev.ts;
        if (ev.since) a.since = ev.since;                 // ops: the real time the health last changed
        if (ev.meta) a.meta = ev.meta;
        a.status = ev.status;
        if (ev.task !== undefined) a.task = ev.task;
        a.note = ev.note ?? null;
        a.decision = ev.status === 'asking' ? (ev.decision || { id: 'ASK', q: ev.note || 'Needs your call', options: [] }) : null;
        a.blocker = ev.status === 'blocked' ? (ev.blocker || ev.task || 'blocked') : null;
        for (const k of GIT_KEYS) if (ev[k] !== undefined) a[k] = ev[k];
        if (['idle', 'done', 'bench'].includes(ev.status)) a.tool = null;
        if (ev.status === 'done') a.tasksDone++;
        this.#log(a, ev.status, ev.note || ev.blocker || ev.task || '');
        break;
      }
      case 'tool':
        need(a, `unknown agent "${ev.agent}"`);
        need(typeof ev.tool === 'string' && ev.tool, 'tool name required');
        if (a.status !== 'working') a.since = ev.ts;
        a.status = 'working'; a.tool = ev.tool; a.note = null; a.decision = null; a.blocker = null;
        a.toolCalls++;
        this.#log(a, 'tool', `${ev.tool}${ev.detail ? ' — ' + ev.detail : ''}`);
        break;
      case 'git':
        need(a, `unknown agent "${ev.agent}"`);
        for (const k of GIT_KEYS) if (ev[k] !== undefined) a[k] = ev[k];
        break;
      case 'say':
        need(a, `unknown agent "${ev.agent}"`);
        need(typeof ev.text === 'string', 'text required');
        this.#log(a, 'say', ev.text);
        break;
      case 'handoff':
        need(this.agents[ev.from] && this.agents[ev.to], 'handoff needs valid from/to');
        this.#log(this.agents[ev.from], 'handoff', `→ ${this.agents[ev.to].name}${ev.note ? ': ' + ev.note : ''}`);
        break;
      case 'agent_join': {
        const i = ev.info;
        need(i && typeof i.id === 'string' && i.id && !this.agents[i.id], 'agent_join needs a new id');
        need(i.seatless || this.freeSeat(i.room || 'bullpen') >= 0, 'office is full');   // seatless (My Queue triage agents) may wait off duty when every desk is taken
        ev.info = this.pub(this.#add(i));
        break;
      }
      case 'agent_leave':
        need(this.agents[ev.id], `unknown agent "${ev.id}"`);
        delete this.agents[ev.id];
        break;
      case 'walkin':
        need(ev.id && ev.name, 'walkin needs id and name');
        this.walkins.set(ev.id, {
          id: ev.id, name: String(ev.name).slice(0, 16), role: String(ev.role || 'Agent').slice(0, 28), room: ev.room || 'bullpen',
          color: ev.color, accent: ev.accent, hair: ev.hair, hairColor: ev.hairColor,
        });
        break;
      case 'walkin_resolved':
        need(this.walkins.has(ev.id), 'unknown walk-in');
        this.walkins.delete(ev.id);
        break;
      case 'task':
        need(typeof ev.title === 'string' && ev.title, 'title required');
        this.tasks.push({ id: ev.id, title: ev.title, state: ev.state || 'running' });
        if (this.tasks.length > 20) this.tasks.shift();
        break;
      case 'task_update': {
        const t = this.tasks.find((x) => x.id === ev.id);
        if (t) t.state = ev.state;
        break;
      }
      default:
        this.seq--;
        throw new Error(`unknown event type "${ev.type}"`);
    }
    if (a && ev.type !== 'say' && ev.type !== 'handoff') ev.state = this.pub(a);
    for (const fn of this.listeners) fn(ev);
    return ev;
  }

  // Accept or turn away a walk-in. Accepting makes them an agent.
  resolveWalkin(id, accepted) {
    const w = this.walkins.get(id);
    if (!w) throw new Error('unknown walk-in');
    this.emit({ type: 'walkin_resolved', id, accepted: Boolean(accepted) });
    if (accepted) this.emit({ type: 'agent_join', info: { ...w, id: `w-${id}` } });
  }

  // Human actions from the "needs me" inbox. Only meaningful when the office owns the agents (demo).
  act(agent, action, choice) {
    const a = this.agents[agent];
    if (!a) throw new Error(`unknown agent "${agent}"`);
    const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
    switch (action) {
      case 'answer':
        ok(a.status === 'asking', `${a.name} isn't asking anything`);
        this.emit({ type: 'say', agent, text: `Got it — going with “${String(choice || 'your call').slice(0, 60)}”` });
        this.emit({ type: 'status', agent, status: 'working', note: null });
        break;
      case 'collect':
        ok(a.status === 'ready', `${a.name} has nothing ready`);
        this.emit({ type: 'status', agent, status: 'done', task: a.task });
        this.emit({ type: 'status', agent, status: 'idle', task: null, ahead: 0 });
        break;
      case 'nudge':
        ok(a.status === 'dark', `${a.name} isn't dark`);
        this.emit({ type: 'status', agent, status: 'working', note: 'Back at the desk' });
        break;
      case 'unblock':
        ok(a.status === 'blocked', `${a.name} isn't blocked`);
        this.emit({ type: 'status', agent, status: 'working' });
        break;
      default:
        throw new Error(`unknown action "${action}"`);
    }
  }

  #log(agent, kind, text) {
    agent.log.push({ ts: Date.now(), kind, text: String(text).slice(0, 400) });
    if (agent.log.length > LOG_LIMIT) agent.log.shift();
  }
}
