// Agent Manager: change how an agent looks (saved in this browser), see her mood and friendship,
// and do something nice for her. Looks never leave this device and never change real agent state.

import { HAIR_STYLES, ACCESSORIES, drawAgent, View } from './render.js';
import { moodOf, energyOf, levelOf, favoriteOf, INTERACTIONS } from './shared/life.js';
import { ROOMS } from './shared/layout.js';
import { store } from './store.js';

const HAIR_COLORS = ['#2f2230', '#4a2e22', '#6b3f2a', '#a8553a', '#e0b36a', '#f3dc9c', '#ffffff', '#ff9ec4', '#c995e8', '#8ec9f0', '#7ad6c8', '#e63950'];
const DRESSES = ['#ffb3d1', '#ffc2c2', '#ffd1c4', '#ffd9a0', '#fff0a8', '#c9efb5', '#b8e6c9', '#bfeee0', '#c5dcff', '#d6c2ff', '#e1c9ff', '#ffffff'];
const ACCENTS = ['#ff6fa8', '#f0647a', '#f08a6a', '#f4a636', '#f4c10f', '#6cc24a', '#35b995', '#4cb5e6', '#6a9ff5', '#9b7bea', '#a56bf0', '#4a2c4a'];
const ACC_LABEL = { bow: '🎀 Bow', flower: '🌸 Flower', crown: '👑 Crown', glasses: '👓 Glasses', catears: '🐱 Cat ears', none: '— None' };

let C, looks = store.get('looks', {}), mgrId = null, tab = 'looks', previewUntil = 0, raf = 0;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const lookOf = (a) => (looks[a.id] ? { ...a, ...looks[a.id] } : a);
export const nm = (a) => looks[a.id]?.name || a.name;

function save() { store.set('looks', looks); C.h.refresh(); }

export function initLooks(c) {
  C = c;
  const m = $('mgrModal');
  m.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.mgr) { mgrId = b.dataset.mgr; render(); }
    else if (b.dataset.mgrtab) { tab = b.dataset.mgrtab; render(); }
    else if (b.dataset.look) { const [k, ...rest] = b.dataset.look.split(':'); (looks[mgrId] ||= {})[k] = rest.join(':'); save(); render(); }
    else if (b.dataset.lookreset !== undefined) { delete looks[mgrId]; save(); render(); }
    else if (b.dataset.fun) { if (C.fun.interact(mgrId, b.dataset.fun)) { previewUntil = performance.now() + 2500; render(); } }
    else if (b.hasAttribute('data-close')) close();
  });
  m.addEventListener('input', (e) => {
    if (e.target.id !== 'mgrName') return;
    const v = e.target.value.trim().slice(0, 14);
    if (v) (looks[mgrId] ||= {}).name = v; else if (looks[mgrId]) delete looks[mgrId].name;
    store.set('looks', looks); C.h.refreshPanels();       // not render(): that would rebuild (and defocus) this very input
    const a = C.S.agents[mgrId];
    if (a) { const h = m.querySelector('.mname h3'); if (h) h.textContent = nm(a); const chip = m.querySelector('.achip.on'); if (chip) chip.lastChild.textContent = nm(a); }
  });
  m.addEventListener('click', (e) => { if (e.target === m) close(); });
}

export function openManager(id) {
  const ids = C.S.order; if (!ids.length) return C.h.toast('No agents on the floor yet');
  mgrId = id && C.S.agents[id] ? id : ids[0];
  $('mgrModal').hidden = false; render(); loop();
}
function close() { $('mgrModal').hidden = true; cancelAnimationFrame(raf); }

function swatches(field, colors, current) {
  return `<div class="sw">${colors.map((c) => `<button class="swatch ${current?.toLowerCase() === c ? 'on' : ''}" style="background:${c}" data-look="${field}:${c}" aria-label="${c}"></button>`).join('')}</div>`;
}

function render() {
  const a = C.S.agents[mgrId]; if (!a) return close();
  const L = lookOf(a), soc = C.fun.socialOf(a.id), lv = levelOf(soc.affection), mood = moodOf(a), energy = energyOf(a);
  const chips = C.S.order.map((id) => { const x = C.S.agents[id], l = lookOf(x); return `<button class="achip ${id === mgrId ? 'on' : ''}" data-mgr="${id}"><i style="background:${l.color}"></i>${esc(nm(x))}</button>`; }).join('');
  let body = '';
  if (tab === 'looks') {
    body = `<label class="fld">Name<input id="mgrName" value="${esc(looks[a.id]?.name || '')}" placeholder="${esc(a.name)}" maxlength="14" autocomplete="off"></label>
      <h5>Hair</h5><div class="chips">${HAIR_STYLES.map((h) => `<button class="chip2 ${L.hair === h ? 'on' : ''}" data-look="hair:${h}">${h}</button>`).join('')}</div>
      <h5>Hair colour</h5>${swatches('hairColor', HAIR_COLORS, L.hairColor)}
      <h5>Dress</h5>${swatches('color', DRESSES, L.color)}
      <h5>Shoes & trim</h5>${swatches('accent', ACCENTS, L.accent)}
      <h5>Accessory</h5><div class="chips">${ACCESSORIES.map((x) => `<button class="chip2 ${(L.acc || 'bow') === x ? 'on' : ''}" data-look="acc:${x}">${ACC_LABEL[x]}</button>`).join('')}</div>
      <div class="row"><button class="abtn ghost" data-lookreset>Reset look</button></div>`;
  } else if (tab === 'life') {
    body = `<div class="stats">
      <div><small>Mood</small><b>${mood.emoji} ${mood.label}</b></div>
      <div><small>Friendship</small><b>${lv.emoji} ${lv.label}</b></div>
      <div><small>Favourite snack</small><b>🍡 ${favoriteOf(a.id)}</b></div>
      <div><small>Room</small><b>${esc(ROOMS[a.room]?.label || a.room)}</b></div></div>
      <h5>Energy</h5><div class="bar"><i style="width:${energy}%"></i></div>
      <h5>Friendship ${lv.next ? `· ${soc.affection}/${lv.next.min} to ${lv.next.label}` : '· maxed out ✨'}</h5><div class="bar pink"><i style="width:${Math.round(lv.progress * 100)}%"></i></div>
      <p class="fine">Mood and energy come from what ${esc(nm(a))} is really doing. Friendship is just between you two, and lives in this browser.</p>`;
  } else {
    body = `<div class="funbtns">${INTERACTIONS.map((i) => `<button class="fbtn" data-fun="${i.id}"><span>${i.emoji}</span><b>${i.label}</b><small>+${i.gain} 💖</small></button>`).join('')}</div>
      <p class="fine">Just for fun — nothing here changes what ${esc(nm(a))} is really working on.</p>`;
  }
  $('mgrBody').innerHTML = `<div class="achips">${chips}</div>
    <div class="mrow"><canvas id="mgrPreview" width="170" height="190"></canvas><div class="mname"><h3>${esc(nm(a))}</h3><div class="role">${esc(a.role)}</div><span class="stat">${esc(a.status)}</span></div></div>
    <div class="tabs2">${[['looks', '🎀 Looks'], ['life', '💖 Life'], ['fun', '🎉 Hang out']].map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-mgrtab="${k}">${l}</button>`).join('')}</div>
    <div class="mbody">${body}</div>`;
}

function loop() {
  cancelAnimationFrame(raf);
  const draw = (t) => {
    const cv = $('mgrPreview'), a = C.S.agents[mgrId];
    if ($('mgrModal').hidden) return;
    if (cv && a) {
      const c = cv.getContext('2d'), v = new View(); v.s = 2.2; v.ox = 85; v.oy = 168; c.clearRect(0, 0, 170, 190);
      drawAgent(c, v, { ...lookOf(a), status: 'idle' }, { x: 0, y: 0, phase: t / 1000, seed: 1, walking: false, seated: false, pose: t < previewUntil ? 'cheer' : null }, t, false);
    }
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
}
export const refreshManager = () => { if (!$('mgrModal').hidden) render(); };
