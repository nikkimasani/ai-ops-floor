// The toolbox: one place for everything you can do to the office. Cards, not menus.

import { CATALOG, CATALOG_ORDER } from './shared/catalog.js';
import { EVENTS, scheduleText } from './shared/life.js';
import { THEMES, theme, setTheme } from './theme.js';
import { startEditing } from './edit.js';
import { openManager } from './looks.js';
import * as fun from './fun.js';
import { store } from './store.js';

let C;
const $ = (id) => document.getElementById(id);

export function initToolbox(c) {
  C = c;
  $('toolboxModal').addEventListener('click', (e) => {
    if (e.target === $('toolboxModal')) return close();
    const b = e.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-close')) return close();
    if (b.dataset.theme) { setTheme(b.dataset.theme); render(); return; }
    if (b.dataset.place) { close(); startEditing(b.dataset.place); return; }
    switch (b.dataset.tb) {
      case 'edit': close(); startEditing(); break;
      case 'agents': close(); openManager(C.S.selected); break;
      case 'party': close(); openParty(); break;
      case 'visitor': fun.inviteVisitor(); close(); break;
      case 'bubbles-toggle': { store.set('bubbles', store.get('bubbles', 'calm') === 'calm' ? 'all' : 'calm'); render(); break; }
      case 'fun-toggle': { const on = !store.get('fun', false); store.set('fun', on); fun.setVisitors(on); render(); break; }
      case 'ufo': close(); fun.startEvent('ufo'); break;
      default:
    }
  });
  $('partyModal').addEventListener('click', (e) => {
    if (e.target === $('partyModal')) return ($('partyModal').hidden = true);
    const b = e.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-close')) $('partyModal').hidden = true;
    else if (b.dataset.start && fun.startEvent(b.dataset.start)) $('partyModal').hidden = true;
  });
}

export function open() { render(); $('toolboxModal').hidden = false; }
const close = () => { $('toolboxModal').hidden = true; };

function render() {
  const card = (tb, emoji, title, sub, extra = '') => `<button class="tcard ${extra}" data-tb="${tb}"><span class="te">${emoji}</span><b>${title}</b><small>${sub}</small></button>`;
  $('toolboxBody').innerHTML = `
    <h5>Make it yours</h5>
    <div class="tcards">
      ${card('edit', '🛋️', 'Edit Office', 'Place furniture & games')}
      ${card('agents', '✨', 'Agent Manager', 'Looks, life & hang-outs')}
      ${card('party', '🎉', 'Party planner', 'Cake, boba, dancing')}
      ${card('visitor', '🎀', 'Invite a visitor', 'Santa, fairies & friends')}
      ${card('bubbles-toggle', '💬', 'Bubbles: ' + (store.get('bubbles', 'calm') === 'calm' ? 'calm' : 'all'), store.get('bubbles', 'calm') === 'calm' ? 'Only the most urgent problem' : 'Every problem, timings, chatter', store.get('bubbles', 'calm') === 'all' ? 'on' : '')}
      ${card('fun-toggle', '🎈', 'Fun mode: ' + (store.get('fun', false) ? 'on' : 'off'), 'Visitors & scheduled parties', store.get('fun', false) ? 'on' : '')}
      ${card('ufo', '🛸', 'Call the UFO', 'Borrows a bench agent')}
    </div>
    <h5>Themes</h5>
    <div class="chips">${Object.entries(THEMES).map(([id, t]) => `<button class="chip2 ${theme.id === id ? 'on' : ''}" data-theme="${id}">${t.emoji} ${t.label}</button>`).join('')}</div>
    <h5>Furniture &amp; games <small>tap one to place it</small></h5>
    <div class="tcards small">${CATALOG_ORDER.map((id) => `<button class="tcard" data-place="${id}"><span class="te">${CATALOG[id].emoji}</span><b>${CATALOG[id].name}</b><small>${CATALOG[id].blurb}</small></button>`).join('')}</div>
    <p class="fine">Layout, looks, theme and friendships are saved in this browser only.</p>`;
}

function openParty() {
  const cur = fun.currentEvent();
  $('partyBody').innerHTML = `${cur ? `<p class="fine">Happening now: <b>${cur.id}</b></p>` : ''}
    <div class="tcards">${EVENTS.map((e) => `<button class="tcard" data-start="${e.id}"><span class="te">${e.emoji}</span><b>${e.name}</b><small>${e.desc}</small><em>${scheduleText(e)} · tap to start now</em></button>`).join('')}</div>
    <p class="fine">Events start by themselves on their schedule while this page is open. Only off-duty agents join — real work always comes first.</p>`;
  $('partyModal').hidden = false;
}
