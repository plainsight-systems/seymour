import type { ActiveCustomer, GameControlId, GameState, PlantKind } from './types';

const WIDTH = 720;
const HEIGHT = 270;
const COLORS = {
  paper: '#eee2c3', paperDeep: '#d8c59b', ink: '#173f31', inkDark: '#102c25', green: '#1e6043', leaf: '#5f943d', mustard: '#e6b631', red: '#c9452c', cream: '#f8efda', shadow: '#766749',
};

function rect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(width), Math.round(height));
}

function polygon(ctx: CanvasRenderingContext2D, points: ReadonlyArray<readonly [number, number]>, fill: string): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  points.forEach(([x, y], index) => index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
  ctx.closePath();
  ctx.fill();
}

export interface OperatorPose {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  commandedAt: number;
  turningUntil: number;
  control: GameControlId | null;
  walking: boolean;
}

const OPERATOR_STATIONS: Record<GameControlId, readonly [number, number]> = {
  weightBits: [502, 159],
  mathBits: [558, 159],
  kvBits: [614, 159],
  reusePromptPrefixes: [502, 159],
  kvPlacement: [558, 159],
  idleKvPlacement: [614, 159],
};

export function createOperatorPose(): OperatorPose {
  return { x: 558, y: 159, targetX: 558, targetY: 159, commandedAt: 0, turningUntil: 0, control: null, walking: false };
}

export function commandOperator(pose: OperatorPose, control: GameControlId, now: number, reducedMotion: boolean): OperatorPose {
  const [targetX, targetY] = OPERATOR_STATIONS[control];
  return {
    ...pose,
    x: reducedMotion ? targetX : pose.x,
    y: reducedMotion ? targetY : pose.y,
    targetX,
    targetY,
    commandedAt: now,
    turningUntil: now + 850,
    control,
    walking: !reducedMotion && (Math.abs(targetX - pose.x) > 1 || Math.abs(targetY - pose.y) > 1),
  };
}

export function advanceOperator(pose: OperatorPose, deltaMs: number, now: number, reducedMotion: boolean): OperatorPose {
  if (reducedMotion) return { ...pose, x: pose.targetX, y: pose.targetY, walking: false };
  const dx = pose.targetX - pose.x;
  const dy = pose.targetY - pose.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 0.75) return { ...pose, x: pose.targetX, y: pose.targetY, walking: false };
  const step = Math.min(distance, deltaMs * 0.34);
  return { ...pose, x: pose.x + dx / distance * step, y: pose.y + dy / distance * step, walking: now < pose.turningUntil };
}

function pixelText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size = 8, color = COLORS.cream): void {
  ctx.fillStyle = color;
  ctx.font = `800 ${size}px "Public Sans Variable", sans-serif`;
  ctx.textBaseline = 'top';
  ctx.fillText(text, Math.round(x), Math.round(y));
}

function drawBackdrop(ctx: CanvasRenderingContext2D): void {
  rect(ctx, 0, 0, WIDTH, HEIGHT, COLORS.paper);
  for (let y = 4; y < 181; y += 11) {
    for (let x = (y / 11) % 2 ? 7 : 2; x < WIDTH; x += 17) rect(ctx, x, y, 1, 1, 'rgba(23,63,49,.18)');
  }
  rect(ctx, 0, 0, WIDTH, 9, COLORS.inkDark);
  // Window and skyline establish the back wall plane.
  rect(ctx, 330, 17, 126, 70, COLORS.cream);
  rect(ctx, 334, 21, 118, 62, COLORS.paperDeep);
  rect(ctx, 386, 21, 4, 62, COLORS.ink);
  rect(ctx, 334, 50, 118, 4, COLORS.ink);
  ctx.fillStyle = COLORS.mustard;
  ctx.beginPath(); ctx.arc(425, 36, 10, 0, Math.PI * 2); ctx.fill();
  rect(ctx, 340, 65, 18, 18, COLORS.green); rect(ctx, 361, 58, 12, 25, COLORS.ink); rect(ctx, 394, 67, 25, 16, COLORS.green); rect(ctx, 429, 61, 14, 22, COLORS.ink);
  // Lamps and the fixed implementation board backing.
  rect(ctx, 92, 9, 3, 22, COLORS.ink); rect(ctx, 277, 9, 3, 22, COLORS.ink);
  ctx.fillStyle = COLORS.green;
  ctx.beginPath(); ctx.moveTo(76, 34); ctx.lineTo(110, 34); ctx.lineTo(103, 25); ctx.lineTo(83, 25); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(261, 34); ctx.lineTo(295, 34); ctx.lineTo(288, 25); ctx.lineTo(268, 25); ctx.closePath(); ctx.fill();
  rect(ctx, 87, 34, 12, 4, COLORS.mustard); rect(ctx, 272, 34, 12, 4, COLORS.mustard);
  rect(ctx, 468, 14, 238, 147, COLORS.inkDark);
  rect(ctx, 474, 20, 226, 135, COLORS.green);
  pixelText(ctx, 'SEYMOUR IMPLEMENTATION BOARD', 485, 25, 7, COLORS.mustard);
  for (let x = 486; x < 688; x += 18) rect(ctx, x, 42, 10, 3, x % 36 ? COLORS.red : COLORS.mustard);
  // Perspective floor.
  rect(ctx, 0, 181, WIDTH, 89, COLORS.paperDeep);
  rect(ctx, 0, 181, WIDTH, 3, COLORS.ink);
  ctx.strokeStyle = '#b6a47e'; ctx.lineWidth = 1;
  for (let x = -100; x < 820; x += 50) { ctx.beginPath(); ctx.moveTo(360, 181); ctx.lineTo(x, HEIGHT); ctx.stroke(); }
  for (let y = 201; y < HEIGHT; y += 20) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WIDTH, y); ctx.stroke(); }
}

function drawServer(ctx: CanvasRenderingContext2D): void {
  rect(ctx, 13, 44, 78, 135, COLORS.inkDark);
  rect(ctx, 18, 49, 68, 125, COLORS.green);
  for (let row = 0; row < 4; row += 1) {
    rect(ctx, 23, 57 + row * 24, 58, 18, COLORS.inkDark);
    for (let i = 0; i < 5; i += 1) rect(ctx, 28 + i * 10, 62 + row * 24, 6, 8, row === 3 ? COLORS.red : COLORS.mustard);
  }
  rect(ctx, 24, 160, 56, 9, COLORS.ink);
  pixelText(ctx, 'MODEL', 34, 162, 6, COLORS.paper);
}

function drawKitchen(ctx: CanvasRenderingContext2D, state: GameState, now: number): void {
  rect(ctx, 108, 88, 148, 83, COLORS.inkDark);
  polygon(ctx, [[113, 93], [250, 93], [239, 102], [113, 102]], COLORS.green);
  rect(ctx, 113, 102, 137, 63, COLORS.green);
  rect(ctx, 124, 108, 56, 43, COLORS.inkDark);
  rect(ctx, 130, 114, 44, 31, COLORS.mustard);
  rect(ctx, 135, 119, 34, 21, COLORS.ink);
  pixelText(ctx, 'GPU', 142, 125, 8, COLORS.mustard);
  for (let i = 0; i < 4; i += 1) {
    const active = state.feedCooldownMs > 0 && Math.floor(now / 85 + i) % 2 === 0;
    rect(ctx, 190 + i * 12, 108, 8, 37, active ? COLORS.red : COLORS.mustard);
  }
  rect(ctx, 120, 156, 119, 4, COLORS.mustard);
  // Cable to the bar's serving rail.
  ctx.strokeStyle = COLORS.mustard; ctx.lineWidth = 5; ctx.lineCap = 'square';
  ctx.beginPath(); ctx.moveTo(249, 127); ctx.lineTo(277, 127); ctx.lineTo(293, 151); ctx.lineTo(326, 151); ctx.stroke();
  ctx.strokeStyle = COLORS.red; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(249, 137); ctx.lineTo(271, 137); ctx.lineTo(287, 159); ctx.lineTo(326, 159); ctx.stroke();
}

function drawCounter(ctx: CanvasRenderingContext2D): void {
  // A single exaggerated isometric bar keeps customers, operator, and controls
  // in one spatially stable work surface.
  polygon(ctx, [[72, 169], [574, 169], [661, 211], [158, 211]], COLORS.mustard);
  polygon(ctx, [[82, 174], [570, 174], [641, 207], [161, 207]], COLORS.paperDeep);
  polygon(ctx, [[158, 211], [661, 211], [661, 237], [158, 237]], COLORS.green);
  polygon(ctx, [[72, 169], [158, 211], [158, 237], [72, 194]], COLORS.ink);
  rect(ctx, 158, 211, 503, 4, COLORS.inkDark);
  for (let x = 174; x < 650; x += 31) rect(ctx, x, 222, 17, 4, COLORS.mustard);
  // Serving hatch and batch tray.
  polygon(ctx, [[302, 185], [357, 185], [371, 192], [316, 192]], COLORS.red);
  rect(ctx, 316, 192, 55, 8, COLORS.red);
  pixelText(ctx, 'SERVE', 326, 193, 6, COLORS.cream);
  polygon(ctx, [[381, 180], [438, 180], [449, 186], [392, 186]], COLORS.inkDark);
}

function drawServiceLanes(ctx: CanvasRenderingContext2D): void {
  const lanes = [122, 151] as const;
  for (const [index, y] of lanes.entries()) {
    const start = 275 - index * 28;
    const end = 456 + index * 18;
    polygon(ctx, [[start, y], [end, y], [end + 18, y + 8], [start + 18, y + 8]], COLORS.paperDeep);
    polygon(ctx, [[start + 18, y + 8], [end + 18, y + 8], [end + 18, y + 13], [start + 18, y + 13]], COLORS.green);
    rect(ctx, start + 27, y + 10, end - start - 22, 2, COLORS.mustard);
  }
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
  const scales = [0.66, 0.82, 1] as const;
  const lane = customer.order.lane;
  const scale = scales[lane];
  const age = Math.max(0, elapsedMs - customer.arrivedAtMs);
  const entrance = Math.min(1, age / 650);
  const urgency = 1 - Math.max(0, customer.patienceMs / customer.order.patienceMs);
  const queueOffset = index * 38;
  const x = 310 + entrance * 40 + urgency * 120 + queueOffset;
  const y = [103, 132, 154][lane]!;
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

function drawOperator(ctx: CanvasRenderingContext2D, pose: OperatorPose, now: number, reducedMotion: boolean): void {
  const atStation = Math.abs(pose.targetX - pose.x) < 1 && Math.abs(pose.targetY - pose.y) < 1;
  const turning = atStation && pose.control !== null && now < pose.turningUntil;
  const stride = pose.walking && !reducedMotion ? (Math.floor(now / 90) % 2 ? 2 : -2) : 0;
  ctx.save();
  ctx.translate(Math.round(pose.x), Math.round(pose.y));
  // Shadow and legs disappear behind the bar front, matching the classic
  // bartender staging without copying its character design.
  rect(ctx, -11, 17, 23, 4, 'rgba(16,44,37,.28)');
  rect(ctx, -7, 8, 5, 12 + stride, COLORS.inkDark);
  rect(ctx, 3, 8, 5, 12 - stride, COLORS.inkDark);
  // Apron, shirt, face, and red service cap.
  rect(ctx, -10, -15, 20, 25, COLORS.mustard);
  polygon(ctx, [[-8, -12], [8, -12], [6, 9], [-6, 9]], COLORS.green);
  rect(ctx, -7, -29, 14, 14, COLORS.paperDeep);
  rect(ctx, -9, -31, 18, 5, COLORS.red);
  rect(ctx, 3, -25, 3, 3, COLORS.inkDark);
  rect(ctx, -3, -20, 8, 2, COLORS.inkDark);
  if (turning) {
    const turnFrame = reducedMotion ? 0 : (Math.floor(now / 110) % 2 ? 3 : -2);
    rect(ctx, -15, -12, 7, 5, COLORS.mustard);
    rect(ctx, 8, -12, 14, 5, COLORS.mustard);
    ctx.strokeStyle = COLORS.mustard;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(21, -10); ctx.lineTo(25 + turnFrame, -23); ctx.stroke();
    rect(ctx, 22 + turnFrame, -27, 8, 6, COLORS.red);
    rect(ctx, 25 + turnFrame, -30, 2, 3, COLORS.cream);
  } else {
    rect(ctx, -15, -10 + stride, 7, 5, COLORS.mustard);
    rect(ctx, 8, -10 - stride, 7, 5, COLORS.mustard);
  }
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
  operator: OperatorPose;
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
  drawServiceLanes(ctx);
  frame.state.active.forEach((customer, index) => drawCustomer(ctx, customer, index, customer.order.id === frame.state.selectedId, frame.state.elapsedMs));
  drawOperator(ctx, frame.operator, frame.now, frame.reducedMotion);
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
