// Floor plan, shared by the browser (rendering, walking) and the server (seat assignment).
// Coordinates are tile units on a GRID.w x GRID.d floor. Pure data: no DOM access.

export const GRID = { w: 30, d: 21 };
export const CORRIDOR_Y = 11;          // agents walk along this row between rooms
export const ENTRANCE = { x: 0.6, y: 11 };

export const ROOMS = {
  boardroom: { label: 'Pink Boardroom', x0: 1, y0: 1, x1: 9, y1: 10, floor: ['#ecdcff', '#e3d0fb'] },
  bullpen:   { label: 'The Bullpen', x0: 9, y0: 1, x1: 22, y1: 10, floor: ['#fde6ef', '#f9d8e6'] },
  review:    { label: 'Review + Security', x0: 22, y0: 1, x1: 30, y1: 10, floor: ['#d9f3ea', '#c8ebdd'] },
  kitchen:   { label: 'Café Kitchen', x0: 1, y0: 12, x1: 9, y1: 20, floor: ['#fff0d2', '#ffe7bb'] },
  rec:       { label: 'Rec Room', x0: 9, y0: 12, x1: 16, y1: 20, floor: ['#dfeaff', '#cfe0fb'] },
  lounge:    { label: 'The Lounge', x0: 16, y0: 12, x1: 23, y1: 20, floor: ['#ffe3d5', '#ffd5c3'] },
  garden:    { label: 'The Garden', x0: 23, y0: 12, x1: 30, y1: 20, floor: ['#d7f1cc', '#c8e9bc'] },
};
export const CORRIDOR_FLOOR = ['#fff8fb', '#f6ecf4'];

// A seat is where an agent works. `aisle` is the x column they walk along to reach the corridor.
export const SEATS = [];
for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) {
  SEATS.push({ room: 'bullpen', x: 11.5 + c * 3, y: r ? 6.6 : 2.6, aisle: 10 + c * 3, desk: { x: 10.5 + c * 3, y: r ? 7.2 : 3.2 } });
}
for (const [x, y] of [[4, 3.6], [6, 3.6], [4, 7.5], [6, 7.5]]) SEATS.push({ room: 'boardroom', x, y, aisle: 2.2 });
for (const [x, y] of [[23.8, 2.6], [27.2, 2.6], [23.8, 6.6], [27.2, 6.6]]) {
  SEATS.push({ room: 'review', x, y, aisle: 25.5, desk: { x: x - 1, y: y + 0.6 } });
}

// Off-duty hangouts. Purely cosmetic: they never change server state.
export const SPOTS = {
  kitchen: [{ x: 3, y: 14.6, say: 'is pouring tea' }, { x: 6.2, y: 16.8, say: 'is nibbling a croissant' }, { x: 2.8, y: 18, say: 'is raiding the fridge' }],
  rec: [{ x: 10.6, y: 13.6, say: 'is stretching in the rec room' }, { x: 12.5, y: 18.4, say: 'is napping on a bean bag' }],
  lounge: [{ x: 18.2, y: 17.2, say: 'is curled up on the sofa' }, { x: 20.6, y: 17.2, say: 'is scrolling on the sofa' }, { x: 21, y: 14.2, say: 'is reading by the lamp' }],
  garden: [{ x: 25.2, y: 14.8, say: 'is watering the flowers' }, { x: 27.4, y: 17.6, say: 'is petting the office cat' }, { x: 28.2, y: 14.6, say: 'is feeding the koi' }],
};

// Rendering primitives. k: box | flat | tree | bush | flowers | pond | lamp
const F = [];
const box = (x, y, w, d, h, c, z = 0) => F.push({ k: 'box', x, y, w, d, h, c, z });
const flat = (x, y, w, d, c, round) => F.push({ k: 'flat', x, y, w, d, c, round });

// bullpen + review desks
for (const s of SEATS) {
  if (s.desk) {
    box(s.desk.x, s.desk.y, 2, 1, 0.55, '#f2cfae');                     // desk top (wood, blush)
    box(s.desk.x + 0.15, s.desk.y + 0.12, 0.7, 0.5, 0.06, '#e8e4f2', 0.55); // laptop base
    box(s.desk.x + 0.15, s.desk.y + 0.12, 0.7, 0.07, 0.42, '#d9d2ee', 0.6);  // laptop lid
    box(s.desk.x + 1.4, s.desk.y + 0.3, 0.25, 0.25, 0.22, '#ff9ec4', 0.55);  // mug
    F.push({ k: 'bush', x: s.desk.x + 1.7, y: s.desk.y + 0.7, c: '#9bd9a5', s: 0.5 });
  }
  if (s.room !== 'boardroom') {
    box(s.x - 0.4, s.y - 0.42, 0.8, 0.84, 0.32, '#c9b6f2');             // chair seat
    box(s.x - 0.4, s.y - 0.58, 0.8, 0.14, 0.85, '#b9a2ee');             // chair back
  } else {
    box(s.x - 0.4, s.y - 0.42, 0.8, 0.84, 0.32, '#d6c2ff');
  }
}
// boardroom table + decor
box(3.2, 4.6, 4, 2.2, 0.55, '#f7dcc8'); box(3.4, 4.8, 3.6, 1.8, 0.04, '#ffeede', 0.55);
box(1.3, 1.2, 0.3, 3, 1.2, '#f9d6ea'); box(1.8, 1.3, 2.4, 0.3, 1.0, '#fff', 0);      // bookshelf + whiteboard
F.push({ k: 'flowers', x: 5.2, y: 5.7, n: 3, z: 0.6 });
F.push({ k: 'bush', x: 8.2, y: 9.2, c: '#b8e0b0', s: 0.9 });
// review + security: shield-ish cabinet, plant
box(28.6, 8.4, 1, 1, 1.0, '#bfe5d6'); box(28.75, 8.5, 0.7, 0.2, 0.5, '#7fd6b6', 1.0);
F.push({ k: 'bush', x: 22.6, y: 9.1, c: '#9fd8b0', s: 0.9 });
// kitchen: counter, fridge, tea table
box(1.2, 13, 1.1, 3.6, 0.7, '#ffd9a8'); box(1.2, 13.2, 1.1, 0.9, 0.12, '#ff9ec4', 0.7);
box(1.2, 17.4, 1.2, 1.3, 1.5, '#ffc2d9');
box(5.2, 15.8, 1.8, 1.8, 0.5, '#fff', 0); box(5.7, 16.3, 0.35, 0.35, 0.18, '#ff9ec4', 0.5);
F.push({ k: 'lamp', x: 8.2, y: 13.3 });
// rec room: ping-pong, bean bags
F.push({ k: 'bush', x: 11.6, y: 18.8, c: '#ffb3d1', s: 1.1 }); F.push({ k: 'bush', x: 14.4, y: 18.4, c: '#b9c8ff', s: 1.0 });
// lounge: rug, sofas, lamp, plants
flat(17.2, 14.3, 4.8, 3.6, '#ffc6dc', true);
box(17.2, 17.6, 3.4, 1.1, 0.5, '#ff9ec4'); box(17.2, 18.4, 3.4, 0.3, 1.0, '#ff86b6');
box(21.6, 13.4, 1.1, 2.6, 0.5, '#c9b6f2'); box(22.4, 13.4, 0.3, 2.6, 1.0, '#b9a2ee');
F.push({ k: 'lamp', x: 17, y: 13.3 }); F.push({ k: 'bush', x: 17.4, y: 13.9, c: '#a7e0b4', s: 1.0 });
// garden
F.push({ k: 'pond', x: 27.1, y: 13.4, w: 2.4, d: 1.8 });
box(24.3, 16.6, 2.2, 0.6, 0.45, '#f2cfae'); box(24.3, 17.1, 2.2, 0.15, 0.9, '#f2cfae');
for (const [x, y, s] of [[24.2, 19.1, 1.2], [28.8, 19, 1.3], [24, 13, 1]]) F.push({ k: 'tree', x, y, s });
for (const [x, y] of [[25.2, 13.4], [26.2, 19.4], [28.2, 16.4], [29, 12.8]]) F.push({ k: 'flowers', x, y, n: 4, z: 0 });
// entrance mat
flat(0.1, 10.5, 1.3, 1, '#ffb3d1', true);

export const FURNITURE = F;

// What a fresh office starts with: just the ping-pong table. Everything else comes from Edit Office.
export const DEFAULT_PLACED = [{ uid: 'p-default', id: 'pingpong', x: 11.6, y: 15, rot: 0 }];
