// Validation for the My Queue config. Reports every problem at once, in plain words.
import { basename } from 'node:path';

const SECRET_FIELDS = { servicenow: ['instance', 'user', 'password'], ado: ['org', 'pat'] };
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'fish', 'cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe']);

export function validateQueueConfig(cfg) {
  const errors = [];
  if (!cfg || typeof cfg !== 'object') return ['config must be a JSON object'];
  if (!Array.isArray(cfg.sources) || !cfg.sources.length) errors.push('sources must be a non-empty array');
  for (const [i, s] of (cfg.sources || []).entries()) {
    const who = `sources[${i}]`;
    if (s.type === 'fixture') continue;
    if (!SECRET_FIELDS[s.type]) { errors.push(`${who}: type must be servicenow, ado or fixture`); continue; }
    for (const f of SECRET_FIELDS[s.type]) {
      if (typeof s[f] !== 'string' || !s[f].startsWith('env:')) errors.push(`${who}: "${f}" must be an "env:NAME" reference (never write a real URL, user, password or token in this file)`);
    }
  }
  const t = cfg.triage;
  if (t) {
    if (!Array.isArray(t.command) || !t.command.length || t.command.some((p) => typeof p !== 'string')) errors.push('triage.command must be an array of strings, e.g. ["gh", "copilot", "--", ...]');
    else {
      if (t.command.some((p) => /REPLACE/i.test(p))) errors.push('triage.command still has a REPLACE-WITH placeholder: fill it in from `gh copilot --help` on your machine');
      if (SHELLS.has(basename(t.command[0]).toLowerCase())) errors.push('triage.command must not start a shell (sh, bash, cmd, powershell): ticket text would become shell input. Call the tool directly');
    }
    if (t.passEnv && (!Array.isArray(t.passEnv) || t.passEnv.some((n) => /(^|_)(PASSWORD|PAT|SECRET)($|_)|^SN_|^ADO_/i.test(String(n))))) errors.push('triage.passEnv must be a list of variable names, and must not include the ServiceNow or Azure DevOps credentials');
    if (t.auto !== undefined && typeof t.auto !== 'boolean') errors.push('triage.auto must be true or false');
  }
  return errors;
}
