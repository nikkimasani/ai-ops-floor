// Colour themes. render.js reads `theme.t` every frame, so switching is instant.

import { store } from './store.js';

const rooms = (b, bu, r, k, rc, l, g) => ({ boardroom: b, bullpen: bu, review: r, kitchen: k, rec: rc, lounge: l, garden: g });

export const THEMES = {
  blossom: { label: 'Blossom', emoji: '🌸', floors: rooms(['#ecdcff', '#e3d0fb'], ['#fde6ef', '#f9d8e6'], ['#d9f3ea', '#c8ebdd'], ['#fff0d2', '#ffe7bb'], ['#dfeaff', '#cfe0fb'], ['#ffe3d5', '#ffd5c3'], ['#d7f1cc', '#c8e9bc']),
    corridor: ['#fff8fb', '#f6ecf4'], wall: ['#fff1f6', '#fbe6ef'], trim: ['#f7b8d0', '#f4aac8'], plate: '#e8c7d8', divider: '#fbd3e3', bg: ['#ffe9f3', '#ece2ff'], dark: false },
  mint: { label: 'Mint Garden', emoji: '🌿', floors: rooms(['#d9f3ea', '#c9ebdc'], ['#e4f7ee', '#d2efe1'], ['#dff1f7', '#cde8f1'], ['#fff6d8', '#fdedbd'], ['#e3f0ff', '#d3e5fb'], ['#e9f5df', '#dcedd0'], ['#cdeec2', '#bde5b0']),
    corridor: ['#fbfffd', '#eef8f3'], wall: ['#f4fffa', '#e5f6ee'], trim: ['#9bd9bf', '#86cfb0'], plate: '#bfe0d2', divider: '#cdeee0', bg: ['#e3fbf1', '#e2ecff'], dark: false },
  lavender: { label: 'Lavender Dream', emoji: '💜', floors: rooms(['#e6dcff', '#d9ccfb'], ['#efe6ff', '#e3d6fb'], ['#e0e6ff', '#d0d9fb'], ['#ffeef7', '#ffe0ef'], ['#dbe6ff', '#cad9fb'], ['#f6e0ff', '#ebcbfb'], ['#dcefd9', '#cce6c8']),
    corridor: ['#fbf8ff', '#f1eaf9'], wall: ['#f6f1ff', '#ebe2fa'], trim: ['#c6b1f2', '#b79ceb'], plate: '#d3c5ea', divider: '#e1d4fa', bg: ['#f3ecff', '#e3e8ff'], dark: false },
  peach: { label: 'Peach Café', emoji: '🍑', floors: rooms(['#ffe2d3', '#ffd4c0'], ['#fff0e2', '#ffe3cc'], ['#ffe9d6', '#ffdcc0'], ['#fff3cf', '#ffe9b3'], ['#ffe0e0', '#ffd0d0'], ['#ffdcd0', '#ffcdbd'], ['#e4f0c8', '#d6e7b6']),
    corridor: ['#fffaf5', '#fbeee3'], wall: ['#fff6ee', '#fdeadb'], trim: ['#ffb996', '#ffa77c'], plate: '#f0cdb6', divider: '#ffdcc7', bg: ['#fff0e3', '#ffe3ee'], dark: false },
  midnight: { label: 'Midnight Candy', emoji: '🌙', floors: rooms(['#3b2f66', '#352a5e'], ['#46305f', '#3e2956'], ['#2c4660', '#273f58'], ['#5a3f55', '#51374c'], ['#2f3d73', '#29366a'], ['#5b3350', '#512d49'], ['#2d5a4a', '#285141']),
    corridor: ['#3a2f55', '#33284c'], wall: ['#4a3a72', '#42326a'], trim: ['#ff7ac3', '#f25fb2'], plate: '#2b2145', divider: '#5a4a8a', bg: ['#2a2048', '#1b1633'], dark: true },
};

export const theme = { id: 'blossom', t: THEMES.blossom };

export function setTheme(id, persist = true) {
  if (!THEMES[id]) id = 'blossom';
  theme.id = id; theme.t = THEMES[id];
  const root = document.documentElement.style;
  root.setProperty('--bg1', theme.t.bg[0]); root.setProperty('--bg2', theme.t.bg[1]);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', theme.t.bg[0]);
  if (persist) store.set('theme', id);
}
