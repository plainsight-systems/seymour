// Declarative cutaway scenes. Pure data: plate builders produce these, the
// renderer draws them. Coordinates are in plate grid units; z is up.

export type Vec3 = [number, number, number];
export type Basis = 'published' | 'representative' | 'schematic';
export type Fill = 'paper' | 'paperBright' | 'paperDeep' | 'green' | 'leaf' | 'red' | 'mustard' | 'slate';
export type LabelSide = 'left' | 'right';

export interface SceneBox {
  id: string;
  /** Clicking any box with this part selects every box and label sharing it. */
  part?: string;
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  h: number;
  fill: Fill;
  /** Painter's order: lower layers are drawn first. */
  layer: number;
  ghost?: boolean;
}

export interface SceneLink {
  from: string;
  to: string;
  bytesPerSecond: number;
  basis: Basis;
  dashed?: boolean;
  /** Placement ids whose data path uses this link. */
  paths: string[];
}

export interface SceneLabel {
  part: string;
  /** Box the leader line points at. */
  anchor: string;
  side: LabelSide;
  title: string;
  detail: string;
  basis: Basis;
}

export interface Scene {
  boxes: SceneBox[];
  links: SceneLink[];
  /** Dashed construction lines, e.g. exploded-view risers. */
  guides: Vec3[][];
  /** Thin wires drawn on top of layer 1 (interposer) and under everything above. */
  wires: Vec3[][];
  labels: SceneLabel[];
}

export type BoxInput = Omit<SceneBox, 'layer' | 'z' | 'fill'> & Partial<Pick<SceneBox, 'layer' | 'z' | 'fill'>>;

export class SceneBuilder {
  private readonly scene: Scene = { boxes: [], links: [], guides: [], wires: [], labels: [] };

  box(input: BoxInput): SceneBox {
    const box: SceneBox = { layer: 0, z: 0, fill: 'paperDeep', ...input };
    this.scene.boxes.push(box);
    return box;
  }

  label(part: string, anchor: string, side: LabelSide, title: string, detail: string, basis: Basis): void {
    this.scene.labels.push({ part, anchor, side, title, detail, basis });
  }

  link(link: SceneLink): void {
    this.scene.links.push(link);
  }

  wire(from: Vec3, to: Vec3): void {
    this.scene.wires.push([from, to]);
  }

  /** Two dashed risers on the visible corners of an exploded layer. */
  risers(box: SceneBox, fromZ: number): void {
    this.scene.guides.push([[box.x, box.y + box.d, fromZ], [box.x, box.y + box.d, box.z]]);
    this.scene.guides.push([[box.x + box.w, box.y, fromZ], [box.x + box.w, box.y, box.z]]);
  }

  guide(points: Vec3[]): void {
    this.scene.guides.push(points);
  }

  find(predicate: (box: SceneBox) => boolean): SceneBox | undefined {
    return this.scene.boxes.find(predicate);
  }

  build(): Scene {
    return this.scene;
  }
}

/**
 * A fixed, seeded choice of which units are drawn as disabled. Vendors do not
 * publish which units are fused off (it varies per chip), so positions are
 * illustrative; only the count is a fact.
 */
export function illustrativeDisabledUnits(total: number, count: number, seed: number): Set<number> {
  const out = new Set<number>();
  let state = seed;
  while (out.size < Math.min(count, total)) {
    state = (state * 1103515245 + 12345) % 2147483648;
    out.add(state % total);
  }
  return out;
}
