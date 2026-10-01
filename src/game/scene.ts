import type { ActiveCustomer, GameState, PlantKind } from './types';

const WIDTH = 720;
const HEIGHT = 270;
const COLORS = {
  paper: '#eee2c3', paperDeep: '#d8c59b', ink: '#173f31', inkDark: '#102c25', green: '#1e6043', leaf: '#5f943d', mustard: '#e6b631', red: '#c9452c', cream: '#f8efda', shadow: '#766749',
};

function rect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(width), Math.round(height));
}

function pixelText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size = 8, color = COLORS.cream): void {
  ctx.fillStyle = color;
  ctx.font = `800 ${size}px "Public Sans Variable", sans-serif`;
  ctx.textBaseline = 'top';
  ctx.fillText(text, Math.round(x), Math.round(y));
}

function drawBackdrop(ctx: CanvasRenderingContext2D): void {
  rect(ctx, 0, 0, WIDTH, HEIGHT, COLORS.paper);
  for (let y = 4; y < 160; y += 11) {
    for (let x = (y / 11) % 2 ? 7 : 2; x < WIDTH; x += 17) rect(ctx, x, y, 1, 1, 'rgba(23,63,49,.18)');
  }
  rect(ctx, 0, 0, WIDTH, 9, COLORS.inkDark);
  // Window and skyline.
  rect(ctx, 355, 20, 108, 75, COLORS.cream);
  rect(ctx, 358, 23, 102, 69, COLORS.paperDeep);
  rect(ctx, 404, 23, 4, 69, COLORS.ink);
  rect(ctx, 358, 54, 102, 4, COLORS.ink);
  ctx.fillStyle = COLORS.mustard;
  ctx.beginPath(); ctx.arc(435, 41, 11, 0, Math.PI * 2); ctx.fill();
  rect(ctx, 366, 70, 18, 22, COLORS.green); rect(ctx, 386, 63, 12, 29, COLORS.ink); rect(ctx, 411, 73, 24, 19, COLORS.green); rect(ctx, 441, 66, 13, 26, COLORS.ink);
  // Lamps.
  rect(ctx, 86, 9, 3, 22, COLORS.ink); rect(ctx, 368, 9, 3, 24, COLORS.ink);
  ctx.fillStyle = COLORS.green;
  ctx.beginPath(); ctx.moveTo(70, 34); ctx.lineTo(104, 34); ctx.lineTo(97, 25); ctx.lineTo(77, 25); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(352, 36); ctx.lineTo(386, 36); ctx.lineTo(379, 27); ctx.lineTo(359, 27); ctx.closePath(); ctx.fill();
  rect(ctx, 81, 34, 12, 4, COLORS.mustard); rect(ctx, 363, 36, 12, 4, COLORS.mustard);
  // Perspective floor.
  rect(ctx, 0, 158, WIDTH, 112, COLORS.paperDeep);
  rect(ctx, 0, 158, WIDTH, 3, COLORS.ink);
  ctx.strokeStyle = '#b6a47e'; ctx.lineWidth = 1;
  for (let x = -80; x < 560; x += 40) { ctx.beginPath(); ctx.moveTo(240, 158); ctx.lineTo(x, HEIGHT); ctx.stroke(); }
  for (let y = 178; y < HEIGHT; y += 22) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WIDTH, y); ctx.stroke(); }
}

function drawServer(ctx: CanvasRenderingContext2D): void {
  rect(ctx, 13, 45, 74, 120, COLORS.inkDark);
  rect(ctx, 18, 50, 64, 110, COLORS.green);
  for (let row = 0; row < 4; row += 1) {
    rect(ctx, 23, 57 + row * 22, 54, 17, COLORS.inkDark);
    for (let i = 0; i < 5; i += 1) rect(ctx, 27 + i * 9, 61 + row * 22, 6, 8, row === 3 ? COLORS.red : COLORS.mustard);
  }
  rect(ctx, 24, 146, 52, 8, COLORS.ink);
  pixelText(ctx, 'MODEL', 31, 148, 6, COLORS.paper);
}

function drawKitchen(ctx: CanvasRenderingContext2D, state: GameState, now: number): void {
  rect(ctx, 102, 82, 143, 76, COLORS.inkDark);
  rect(ctx, 107, 87, 133, 66, COLORS.green);
  rect(ctx, 118, 98, 54, 42, COLORS.inkDark);
  rect(ctx, 124, 104, 42, 30, COLORS.mustard);
  rect(ctx, 129, 109, 32, 20, COLORS.ink);
  pixelText(ctx, 'GPU', 136, 115, 8, COLORS.mustard);
  for (let i = 0; i < 4; i += 1) {
    const active = state.feedCooldownMs > 0 && Math.floor(now / 85 + i) % 2 === 0;
    rect(ctx, 181 + i * 12, 98, 8, 35, active ? COLORS.red : COLORS.mustard);
  }
  rect(ctx, 115, 145, 116, 4, COLORS.mustard);
  // Cable to the serving hatch.
  ctx.strokeStyle = COLORS.mustard; ctx.lineWidth = 5; ctx.lineCap = 'square';
  ctx.beginPath(); ctx.moveTo(238, 122); ctx.lineTo(264, 122); ctx.lineTo(278, 143); ctx.lineTo(303, 143); ctx.stroke();
  ctx.strokeStyle = COLORS.red; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(238, 131); ctx.lineTo(258, 131); ctx.lineTo(274, 151); ctx.lineTo(303, 151); ctx.stroke();
}

function drawCounter(ctx: CanvasRenderingContext2D): void {
  rect(ctx, 0, 164, WIDTH, 12, COLORS.inkDark);
  rect(ctx, 0, 176, WIDTH, 29, COLORS.green);
  for (let x = 7; x < WIDTH; x += 18) rect(ctx, x, 182, 10, 3, COLORS.mustard);
  rect(ctx, 265, 153, 58, 13, COLORS.red);
  rect(ctx, 271, 149, 46, 5, COLORS.mustard);
}

function leaf(ctx: CanvasRenderingContext2D, x: number, y: number, flip = 1, color = COLORS.leaf): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y); ctx.lineTo(x + flip * 11, y - 7); ctx.lineTo(x + flip * 9, y + 3); ctx.lineTo(x, y); ctx.fill();
}

function drawPlantBody(ctx: CanvasRenderingContext2D, kind: PlantKind): void {
  // Pot and stem.
  rect(ctx, -7, 8, 14, 11, COLORS.red); rect(ctx, -9, 6, 18, 4, COLORS.mustard); rect(ctx, -2, -18, 4, 25, COLORS.green);
  leaf(ctx, -1, -5, -1); leaf(ctx, 1, 1, 1);
  if (kind === 'cactus') {
    rect(ctx, -7, -28, 14, 22, COLORS.leaf); rect(ctx, -12, -21, 7, 5, COLORS.leaf); rect(ctx, 5, -17, 8, 5, COLORS.leaf);
    rect(ctx, -3, -25, 2, 2, COLORS.cream); rect(ctx, 3, -25, 2, 2, COLORS.cream);
    rect(ctx, -2, -19, 5, 2, COLORS.inkDark);
    return;
  }
  const big = kind === 'maw' ? 18 : kind === 'orchid' ? 14 : 12;
  ctx.fillStyle = kind === 'fern' ? COLORS.leaf : COLORS.red;
  ctx.beginPath(); ctx.arc(0, -24, big, 0, Math.PI * 2); ctx.fill();
  if (kind === 'orchid') {
    const petals: ReadonlyArray<readonly [number, number]> = [[-13, -33], [13, -33], [-14, -18], [14, -18]];
    for (const [x, y] of petals) { ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill(); }
  }
  if (kind === 'vine') { ctx.strokeStyle = COLORS.leaf; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, -24, 19, 0.3, Math.PI * 1.7); ctx.stroke(); }
  rect(ctx, -6, -29, 3, 3, COLORS.cream); rect(ctx, 4, -29, 3, 3, COLORS.cream);
  rect(ctx, -7, -21, 14, kind === 'maw' ? 7 : 5, COLORS.inkDark);
  if (kind === 'maw') {
    for (let x = -5; x <= 5; x += 5) { ctx.fillStyle = COLORS.cream; ctx.beginPath(); ctx.moveTo(x, -21); ctx.lineTo(x + 2, -17); ctx.lineTo(x + 4, -21); ctx.fill(); }
  }
}

function customerPosition(customer: ActiveCustomer, index: number, elapsedMs: number): { x: number; y: number; scale: number } {
  const scales = [0.72, 0.86, 1] as const;
  const lane = customer.order.lane;
  const scale = scales[lane];
  const age = Math.max(0, elapsedMs - customer.arrivedAtMs);
  const entrance = Math.min(1, age / 900);
  const queueOffset = index * 24;
  const x = 438 - entrance * (118 + queueOffset);
  const y = 99 + lane * 34;
  return { x, y, scale };
}

function drawCustomer(ctx: CanvasRenderingContext2D, customer: ActiveCustomer, index: number, selected: boolean, elapsedMs: number): void {
  const { x, y, scale } = customerPosition(customer, index, elapsedMs);
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.scale(scale, scale);
  if (selected) {
    ctx.fillStyle = COLORS.mustard;
    ctx.beginPath(); ctx.moveTo(-5, -53); ctx.lineTo(5, -53); ctx.lineTo(0, -45); ctx.fill();
  }
  drawPlantBody(ctx, customer.order.plantKind);
  if (customer.onBatchTray) {
    rect(ctx, -12, 22, 24, 5, COLORS.mustard);
    rect(ctx, -8, 23, 16, 2, COLORS.inkDark);
  }
  const patience = Math.max(0, customer.patienceMs / customer.order.patienceMs);
  rect(ctx, -15, -44, 30, 4, COLORS.inkDark);
  rect(ctx, -14, -43, 28 * patience, 2, patience < 0.3 ? COLORS.red : COLORS.mustard);
  ctx.restore();
}

function drawTables(ctx: CanvasRenderingContext2D, state: GameState): void {
  const count = Math.min(6, state.seatedOrderIds.length);
  for (let index = 0; index < count; index += 1) {
    const column = index % 3;
    const row = Math.floor(index / 3);
    const x = 285 + column * 54;
    const y = 70 + row * 34;
    rect(ctx, x - 15, y + 10, 30, 5, COLORS.shadow);
    rect(ctx, x - 1, y + 14, 3, 12, COLORS.ink);
    ctx.save(); ctx.translate(x, y); ctx.scale(0.48, 0.48); drawPlantBody(ctx, ['sprout', 'fern', 'orchid', 'vine', 'cactus', 'maw'][index] as PlantKind); ctx.restore();
  }
}

function drawEventEffect(ctx: CanvasRenderingContext2D, state: GameState, eventAgeMs: number, reducedMotion: boolean): void {
  if (eventAgeMs > 700) return;
  const progress = eventAgeMs / 700;
  if (state.event.type === 'success') {
    const x = 220 + progress * 92;
    for (let i = 0; i < 3; i += 1) rect(ctx, x - i * 10, 139 - i * 3, 8, 5, i === 1 ? COLORS.red : COLORS.mustard);
  }
  if (state.event.type === 'fuse') {
    ctx.fillStyle = reducedMotion ? 'rgba(201,69,44,.18)' : `rgba(201,69,44,${0.28 * (1 - progress)})`;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    for (let i = 0; i < 8; i += 1) rect(ctx, 90 + i * 39, 42 + (i % 3) * 19, 3, 8, COLORS.mustard);
  }
}

export interface SceneFrame {
  state: GameState;
  now: number;
  eventAgeMs: number;
  reducedMotion: boolean;
}

export function renderScene(canvas: HTMLCanvasElement, frame: SceneFrame): void {
  if (canvas.width !== WIDTH || canvas.height !== HEIGHT) { canvas.width = WIDTH; canvas.height = HEIGHT; }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.save();
  if (frame.state.event.type === 'fuse' && frame.eventAgeMs < 360 && !frame.reducedMotion) {
    const shake = Math.sin(frame.now * 0.12) * 3 * (1 - frame.eventAgeMs / 360);
    ctx.translate(Math.round(shake), Math.round(-shake / 2));
  }
  drawBackdrop(ctx);
  drawServer(ctx);
  drawTables(ctx, frame.state);
  drawKitchen(ctx, frame.state, frame.now);
  frame.state.active.forEach((customer, index) => drawCustomer(ctx, customer, index, customer.order.id === frame.state.selectedId, frame.state.elapsedMs));
  drawCounter(ctx);
  drawEventEffect(ctx, frame.state, frame.eventAgeMs, frame.reducedMotion);
  ctx.restore();
}

export function sceneDescription(state: GameState): string {
  const waiting = state.active.length === 0 ? 'No plants are waiting.' : `${state.active.length} ${state.active.length === 1 ? 'plant is' : 'plants are'} waiting at the counter.`;
  return `${state.shift.title}. ${waiting} ${state.seatedOrderIds.length} satisfied ${state.seatedOrderIds.length === 1 ? 'plant is' : 'plants are'} seated. ${state.fuses} power fuses remain.`;
}

/** Hit-tests a pointer expressed in the canvas's 720 × 270 logical coordinates. */
export function customerAtPoint(state: GameState, x: number, y: number): string | null {
  for (let index = state.active.length - 1; index >= 0; index -= 1) {
    const customer = state.active[index]!;
    const position = customerPosition(customer, index, state.elapsedMs);
    const halfWidth = 24 * position.scale;
    const top = position.y - 52 * position.scale;
    const bottom = position.y + 28 * position.scale;
    if (x >= position.x - halfWidth && x <= position.x + halfWidth && y >= top && y <= bottom) return customer.order.id;
  }
  return null;
}
