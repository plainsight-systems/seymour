import type { Plate } from '../cutaway/plates';
import type { SceneLabel } from '../cutaway/scene';

// The Act 1 challenge: place parts back onto a plate. Pure: it turns a plate
// and the set of placed parts into the plate the reader sees, and judges
// placements. The page handles dragging and clicking.

export type RoundId = 'package' | 'die';

/** Parts to place in each round, in tray order. Only those drawn on the plate are used. */
const ROUND_PARTS: Record<RoundId, string[]> = {
  package: ['die', 'compute-die', 'io', 'hbm', 'interposer', 'substrate'],
  die: ['unit', 'cluster', 'l2', 'mc', 'io'],
};

export interface AssemblyRound {
  id: RoundId;
  parts: string[];
}

export function assemblyRound(id: RoundId, plate: Plate): AssemblyRound {
  const drawn = new Set(plate.scene.labels.map((label) => label.part));
  return { id, parts: ROUND_PARTS[id].filter((part) => drawn.has(part)) };
}

/** Zone numbers stay stable for a round: the order parts appear in the tray. */
export function zoneNumber(round: AssemblyRound, part: string): number {
  return round.parts.indexOf(part) + 1;
}

/**
 * The plate as the reader sees it mid-challenge: unplaced parts are drawn as
 * empty outlines with a numbered zone marker and no name; placed parts and
 * everything outside the round look as usual (without other labels, so the
 * plate never gives away an answer).
 */
export function assemblyPlate(plate: Plate, round: AssemblyRound, placed: ReadonlySet<string>): Plate {
  const inRound = new Set(round.parts);
  const boxes = plate.scene.boxes.map((box) => (box.part && inRound.has(box.part) && !placed.has(box.part) ? { ...box, ghost: true, fill: 'paperBright' as const } : box));
  const labels: SceneLabel[] = [];
  for (const part of round.parts) {
    const original = plate.scene.labels.find((label) => label.part === part);
    if (!original) continue;
    labels.push(placed.has(part)
      ? original
      : { ...original, title: `Zone ${zoneNumber(round, part)}`, detail: 'drop the matching part here', basis: 'schematic' });
  }
  return { ...plate, scene: { ...plate.scene, boxes, labels }, defaultSelection: [], litPath: null };
}

export type PlacementResult = 'correct' | 'wrong' | 'already-placed';

export function place(round: AssemblyRound, placed: ReadonlySet<string>, card: string, zone: string): PlacementResult {
  if (placed.has(zone)) return 'already-placed';
  return round.parts.includes(zone) && card === zone ? 'correct' : 'wrong';
}

/** A zone that still accepts a part: in this round and not yet filled. */
export function isOpenZone(round: AssemblyRound, placed: ReadonlySet<string>, part: string): boolean {
  return round.parts.includes(part) && !placed.has(part);
}

export function isComplete(round: AssemblyRound, placed: ReadonlySet<string>): boolean {
  return round.parts.every((part) => placed.has(part));
}
