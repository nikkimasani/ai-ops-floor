// Things you can put on the floor. Pure data (no DOM) so the browser, the tests and the server agree.
//   w,d      footprint in tiles at rotation 0 (rotation 1/3 swaps them)
//   kind     'pair' = two agents play together · 'solo' = one at a time · 'deco' = just pretty
//   spots    where agents stand, as offsets from the item's top-left corner at rotation 0
//   cap      how many agents can use it at once (defaults to spots.length)

export const CATALOG = {
  pingpong: { name: 'Ping-pong table', emoji: '🏓', w: 2.6, d: 1.4, kind: 'pair', blurb: 'Two idle agents rally until real work calls.',
    spots: [{ dx: -0.75, dy: 0.7, say: 'is rallying at ping-pong' }, { dx: 3.35, dy: 0.7, say: 'is winning at ping-pong' }] },
  pool: { name: 'Pool table', emoji: '🎱', w: 2.6, d: 1.4, kind: 'pair', blurb: 'Pink felt, tiny cues, big rivalries.',
    spots: [{ dx: 0.9, dy: -0.75, say: 'is lining up a shot' }, { dx: 1.7, dy: 2.15, say: 'just sank the eight ball' }] },
  foosball: { name: 'Foosball', emoji: '⚽', w: 1.8, d: 1.0, kind: 'pair', blurb: 'Perfect for waiting on CI.',
    spots: [{ dx: -0.75, dy: 0.5, say: 'is spinning the foosball rods' }, { dx: 2.55, dy: 0.5, say: 'scored a goal!' }] },
  arcade: { name: 'Arcade cabinet', emoji: '🕹️', w: 1.0, d: 1.0, kind: 'solo', blurb: 'Glowing screen, high-score dreams.',
    spots: [{ dx: 0.5, dy: 1.75, say: 'is on a winning streak' }] },
  pinball: { name: 'Pinball', emoji: '🎰', w: 1.0, d: 1.5, kind: 'solo', blurb: 'Flippers, lights and squeals.',
    spots: [{ dx: 0.5, dy: 2.2, say: 'is chasing a pinball high score' }] },
  jukebox: { name: 'Jukebox', emoji: '🎵', w: 1.0, d: 0.9, kind: 'solo', blurb: 'Picks a song, starts a dance.',
    spots: [{ dx: 0.5, dy: 1.6, say: 'is dancing to the jukebox', pose: 'dance' }] },
  dancepad: { name: 'Dance floor', emoji: '💃', w: 2.0, d: 2.0, kind: 'solo', blurb: 'Glittery tiles that light up.',
    spots: [{ dx: 0.7, dy: 1.0, say: 'is busting a move', pose: 'dance' }, { dx: 1.4, dy: 1.0, say: 'is doing the twirl', pose: 'dance' }] },
  console: { name: 'Cozy console', emoji: '🎮', w: 1.6, d: 0.8, kind: 'solo', blurb: 'A little TV and a very soft game.',
    spots: [{ dx: 0.8, dy: 1.7, say: 'is playing a cozy game' }] },
  beanbag: { name: 'Bean bag', emoji: '🫧', w: 1.0, d: 1.0, kind: 'solo', blurb: 'For a quick power nap.',
    spots: [{ dx: 0.5, dy: 0.5, say: 'is napping on a bean bag', pose: 'nap' }] },
  sofa: { name: 'Pink sofa', emoji: '🛋️', w: 2.4, d: 1.0, kind: 'solo', blurb: 'Room for two best friends.',
    spots: [{ dx: 0.7, dy: 0.5, say: 'is chilling on the sofa', pose: 'nap' }, { dx: 1.7, dy: 0.5, say: 'is gossiping on the sofa' }] },
  bubbletea: { name: 'Boba cart', emoji: '🧋', w: 1.3, d: 0.8, kind: 'solo', blurb: 'Tapioca on demand.',
    spots: [{ dx: 0.65, dy: 1.5, say: 'is sipping boba', pose: 'sip' }] },
  photobooth: { name: 'Photo booth', emoji: '📸', w: 1.4, d: 1.2, kind: 'solo', blurb: 'Strike a pose, get a sticker strip.',
    spots: [{ dx: 0.7, dy: 1.8, say: 'is striking a pose', pose: 'cheer' }] },
  rug: { name: 'Fluffy rug', emoji: '🧶', w: 3.0, d: 2.0, kind: 'deco', flat: true, blurb: 'Makes any corner cozy.', spots: [] },
  plant: { name: 'Potted plant', emoji: '🪴', w: 0.8, d: 0.8, kind: 'deco', blurb: 'Leafy and low-maintenance.', spots: [] },
  lamp: { name: 'Fairy lamp', emoji: '🪔', w: 0.6, d: 0.6, kind: 'deco', blurb: 'A warm little glow.', spots: [] },
  flowers: { name: 'Flower arch', emoji: '💐', w: 2.0, d: 0.5, kind: 'deco', blurb: 'Blooms for every entrance.', spots: [] },
  balloons: { name: 'Balloons', emoji: '🎈', w: 0.8, d: 0.8, kind: 'deco', blurb: 'Because every day is a party.', spots: [] },
  cattower: { name: 'Cat tower', emoji: '🐈', w: 1.0, d: 1.0, kind: 'deco', blurb: 'The office cat approves.', spots: [] },
};
export const CATALOG_ORDER = Object.keys(CATALOG);

/** Footprint width/depth after rotation (rot = 0..3 quarter turns). */
export function dims(item) {
  const c = CATALOG[item.id];
  return (item.rot || 0) % 2 ? [c.d, c.w] : [c.w, c.d];
}

// Turn a point in an item's own frame into the rotated frame (quarter turns clockwise).
function turn(dx, dy, w, d, rot) {
  switch (((rot || 0) % 4 + 4) % 4) {
    case 1: return [d - dy, dx];
    case 2: return [w - dx, d - dy];
    case 3: return [dy, w - dx];
    default: return [dx, dy];
  }
}

/** Where agents stand to use this item, in floor coordinates. */
export function spotsOf(item) {
  const c = CATALOG[item.id];
  return c.spots.map((s, i) => {
    const [dx, dy] = turn(s.dx, s.dy, c.w, c.d, item.rot);
    return { x: item.x + dx, y: item.y + dy, say: s.say, pose: s.pose || null, idx: i };
  });
}
