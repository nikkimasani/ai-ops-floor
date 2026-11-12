// The "fiction" layer: moods, friendship, interactions and the office calendar. None of this ever
// changes real agent state — it is what the office does for fun. Pure, so it is testable.

export const LEVELS = [
  { min: 0, label: 'Stranger', emoji: '🌱' },
  { min: 5, label: 'Friend', emoji: '🌸' },
  { min: 15, label: 'Bestie', emoji: '💖' },
  { min: 30, label: 'Soulmate', emoji: '✨' },
];

export function levelOf(affection = 0) {
  let i = 0;
  while (i + 1 < LEVELS.length && affection >= LEVELS[i + 1].min) i++;
  const cur = LEVELS[i], next = LEVELS[i + 1];
  return { ...cur, next: next || null, progress: next ? (affection - cur.min) / (next.min - cur.min) : 1 };
}

const MOODS = {
  idle: ['happy', '😊'], thinking: ['focused', '🤔'], working: ['focused', '😤'], blocked: ['stressed', '😣'],
  asking: ['curious', '🥺'], ready: ['proud', '😎'], done: ['proud', '🥳'], dark: ['lonely', '🥀'], bench: ['sleepy', '😴'],
};
export function moodOf(agent) {
  const [label, emoji] = MOODS[agent.status] || MOODS.idle;
  return { label, emoji };
}

/** 0–100. Works tire agents out, finishing things perks them up, breaks refill them. */
export function energyOf(agent) {
  const e = 100 - (agent.toolCalls || 0) * 1.5 + (agent.tasksDone || 0) * 4 + (agent.status === 'bench' ? 25 : 0);
  return Math.max(12, Math.min(100, Math.round(e)));
}

const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
export const SNACKS = ['strawberry boba', 'matcha latte', 'mochi', 'butter croissant', 'honey toast', 'lavender tea', 'cinnamon roll', 'pink macarons'];
export const favoriteOf = (id) => SNACKS[hash(id) % SNACKS.length];

// Things you can do with an agent. `pose` is how they react; `fx` are the particles; `gain` is friendship.
export const INTERACTIONS = [
  { id: 'pet', emoji: '🫶', label: 'Head pat', pose: 'cheer', fx: ['💗', '✨'], gain: 1, say: ['Hehe, that tickles! 💕', 'Aww, thank you!', 'I love head pats!'] },
  { id: 'cake', emoji: '🍰', label: 'Slice of cake', pose: 'eat', fx: ['🍰', '✨'], gain: 2, say: ['Cake break! Yum!!', 'Is this strawberry?!', 'You’re the best 🍓'] },
  { id: 'boba', emoji: '🧋', label: 'Boba', pose: 'sip', fx: ['🧋', '💧'], gain: 2, say: ['Slurp… so good.', 'Extra pearls? Yes please!', 'Brain freeze! 🥶'] },
  { id: 'dance', emoji: '💃', label: 'Dance party', pose: 'dance', fx: ['🎵', '🎶', '✨'], gain: 2, say: ['Let’s boogie!', 'Twirl twirl twirl~', 'This is my song!'], seconds: 7 },
  { id: 'highfive', emoji: '🙌', label: 'High five', pose: 'cheer', fx: ['⭐', '✨'], gain: 1, say: ['High five! ✋', 'Yesss!', 'Team pink!'] },
  { id: 'compliment', emoji: '💌', label: 'Compliment', pose: 'cheer', fx: ['💌', '💖'], gain: 1, say: ['You’re doing amazing, sweetie.', 'Your code is so pretty.', 'Proud of you!'] },
  { id: 'snack', emoji: '🍡', label: 'Favourite snack', pose: 'eat', fx: ['🍡', '💖'], gain: 4, say: ['You remembered my favourite!!', 'Best. Day. Ever.'], favourite: true },
];
export const interactionById = Object.fromEntries(INTERACTIONS.map((i) => [i.id, i]));

/** New friendship record after an interaction (or the same one if it's on cooldown). */
export function applyInteraction(rec = { affection: 0, count: 0, last: 0 }, action, now = Date.now(), cooldownMs = 900) {
  const it = interactionById[action];
  if (!it || now - rec.last < cooldownMs) return { rec, changed: false, leveledUp: false };
  const before = levelOf(rec.affection).label;
  const next = { affection: rec.affection + it.gain, count: rec.count + 1, last: now };
  return { rec: next, changed: true, leveledUp: levelOf(next.affection).label !== before };
}

// ---------- office calendar ----------
// weekly: day of week (0 = Sunday) + hour; daily: hour. Events can always be started by hand.
export const EVENTS = [
  { id: 'cake', emoji: '🎂', name: 'Birthday cake', desc: 'Everyone off-duty gathers on the lounge rug for cake.', weekly: { dow: 5, hour: 15 } },
  { id: 'boba', emoji: '🧋', name: 'Boba o’clock', desc: 'Idle agents queue up for bubble tea.', daily: { hour: 14 } },
  { id: 'dance', emoji: '🪩', name: 'Dance party', desc: 'Disco ball, sparkles and wiggling.', weekly: { dow: 5, hour: 17 } },
  { id: 'ufo', emoji: '🛸', name: 'Friendly UFO', desc: 'A pink UFO borrows someone on a break, then brings them back.', random: true },
];
export const eventById = Object.fromEntries(EVENTS.map((e) => [e.id, e]));
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function scheduleText(e) {
  const hh = (h) => `${h > 12 ? h - 12 : h}${h >= 12 ? 'pm' : 'am'}`;
  if (e.weekly) return `${DAYS[e.weekly.dow]} ${hh(e.weekly.hour)}`;
  if (e.daily) return `Every day ${hh(e.daily.hour)}`;
  return 'Now and then';
}

/** Events whose time has come and that haven't fired this hour. `fired` is a Set of "id@day-hour". */
export function dueEvents(date, fired = new Set()) {
  const day = date.toDateString(), hour = date.getHours(), dow = date.getDay(), out = [];
  for (const e of EVENTS) {
    const match = (e.weekly && e.weekly.dow === dow && e.weekly.hour === hour) || (e.daily && e.daily.hour === hour);
    const key = `${e.id}@${day}-${hour}`;
    if (match && !fired.has(key)) out.push({ event: e, key });
  }
  return out;
}

// ---------- costumed visitors ----------
export const VISITORS = [
  { name: 'Santa', acc: 'santa', color: '#ff8a9b', accent: '#e63950', hair: 'long', hairColor: '#f4f4f4', quips: { working: 'Ho ho hold on, so busy!', blocked: 'Coal for that blocker!', ready: 'Ho ho ho — a merge!', dark: 'Santa sees you’re quiet…', idle: 'Have you been good?' } },
  { name: 'Fairy Godmother', acc: 'wings', color: '#e7d6ff', accent: '#b387f5', hair: 'bun', hairColor: '#f0c35a', quips: { working: 'Sprinkling productivity ✨', blocked: 'Bibbidi-bobbidi-unblock!', ready: 'A wish granted: shipped!', dark: 'Yoo-hoo, anyone there?', idle: 'Make a wish!' } },
  { name: 'Witchy Pumpkin', acc: 'witch', color: '#ffb877', accent: '#7a4ad9', hair: 'pony', hairColor: '#3b2a4a', quips: { working: 'Brewing something spooky…', blocked: 'I’ll hex that bug!', ready: 'Boo-tiful branch!', dark: 'Ghosted, are we?', idle: 'Trick or treat?' } },
  { name: 'Tooth Fairy', acc: 'wings', color: '#c9f2ff', accent: '#4cb5e6', hair: 'pigtails', hairColor: '#8ec9f0', quips: { working: 'Sparkly work!', blocked: 'Under your pillow: patience.', ready: 'Shiny commits!', dark: 'Come out, come out!', idle: 'Smile for me!' } },
  { name: 'Bunny Barista', acc: 'catears', color: '#ffe0f0', accent: '#ff6fa8', hair: 'bob', hairColor: '#ffffff', quips: { working: 'Fuel up with a latte?', blocked: 'Cold brew for the blockers.', ready: 'Cheers to shipping!', dark: 'Your latte’s getting cold…', idle: 'One matcha, coming up!' } },
  { name: 'Princess Pea', acc: 'crown', color: '#c5f0d2', accent: '#2fa86e', hair: 'curly', hairColor: '#7a4a2a', quips: { working: 'Royally focused!', blocked: 'By royal decree: unblock!', ready: 'A royal merge!', dark: 'Summon the court!', idle: 'Long live the office!' } },
];
export const visitorQuip = (v, status) => v.quips[['working', 'thinking'].includes(status) ? 'working' : status === 'ready' || status === 'done' ? 'ready' : status === 'blocked' || status === 'asking' ? 'blocked' : status === 'dark' ? 'dark' : 'idle'];
