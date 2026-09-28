import type { StageId } from '../model/forwardPass';
import type { HardwareLink } from './forward/stages';
import type { PictureLayer } from './picture/model';

/** A modeled move the reader can switch on in its panel. */
export type MoveEffect = 'kv8' | 'prefixReuse' | 'speculate' | 'fp8';

export interface StoryMove {
  title: string;
  explanation: string;
  modeled: boolean;
  /** Present when the panel offers a toggle that applies this move. */
  effect?: MoveEffect;
  /** The move is what the panel's own knob does. */
  viaKnob?: boolean;
}

export type PanelPlate = 'die-pair' | 'package' | 'die' | 'server';

export interface StoryPanelSpec {
  id: string;
  number: string;
  title: string;
  claim: string;
  knobLabel: string;
  /** Which cutaway plate tells this concept. */
  plate: PanelPlate;
  /** Flat number strips shown beside the plate, where exact figures matter. */
  numbers: PictureLayer[];
  /** What this concept looks like in a profiler timeline. Qualitative, not measured. */
  trace: string;
  /** Act 2 stages this lever changes. */
  changes: StageId[];
  /** The Act 1 part whose limit this lever runs into. */
  limitedBy: HardwareLink[];
  moves: StoryMove[];
}

export const STORY_PANELS: StoryPanelSpec[] = [
  {
    id: 'two-jobs', number: '00', title: 'Two different jobs',
    claim: 'Reading the prompt and writing the answer are different jobs, limited by different things.',
    knobLabel: 'Prompt length', plate: 'die-pair', numbers: [],
    changes: ['attention', 'mlp', 'unembed'], limitedBy: [{ scene: 'unit', part: 'matrix', label: 'Matrix units (prompt work)' }, { scene: 'package', part: 'hbm', label: 'Memory stacks (token work)' }],
    trace: 'Prompt processing appears as a few long matrix-multiply kernels running close to the math peak. Token generation appears as many short kernels per step: memory bandwidth is high while math units sit mostly idle.',
    moves: [
      { title: 'Reuse a shared prompt', explanation: 'Assume 75% of the prompt is a prefix already processed for an earlier request, and skip that work.', modeled: true, effect: 'prefixReuse' },
      { title: 'Run the math in 8 bits', explanation: 'Store weights in 8 bits and multiply in FP8, using the published FP8 ceiling. Accuracy is a tradeoff; scaling overheads are not modeled.', modeled: true, effect: 'fp8' },
      { title: 'Split a long prompt', explanation: 'Let other users’ tokens run between prompt pieces. The benefit depends on arrival timing, which this model does not simulate.', modeled: false },
      { title: 'Separate the jobs', explanation: 'Run prompt work and token generation on different machines.', modeled: false },
    ],
  },
  {
    id: 'read-model', number: '01', title: 'Every token re-reads the model',
    claim: 'To produce each token, the GPU reads every weight in the model from memory.',
    knobLabel: 'Model precision', plate: 'package', numbers: [],
    changes: ['attention', 'mlp', 'unembed'], limitedBy: [{ scene: 'package', part: 'hbm', label: 'Memory stacks (HBM): bandwidth' }],
    trace: 'In one decode step, bytes read from GPU memory come out close to the model’s size, and achieved bandwidth sits near the memory peak. Halving the weight bytes should roughly halve those kernels’ time.',
    moves: [
      { title: 'Store weights in fewer bits', explanation: 'Move fewer bytes per token; accuracy and kernel support remain tradeoffs.', modeled: true, viaKnob: true },
      { title: 'Use a smaller model', explanation: 'Remove weights and math together.', modeled: false },
      { title: 'Exploit model sparsity', explanation: 'Skip structured work when the model and hardware support it.', modeled: false },
    ],
  },
  {
    id: 'share-read', number: '02', title: 'Share the read',
    claim: 'If many users take a step together, one read of the model serves all of them.',
    knobLabel: 'Concurrent users', plate: 'die', numbers: ['throughput'],
    changes: ['attention', 'mlp'], limitedBy: [{ scene: 'package', part: 'hbm', label: 'Memory stacks (HBM): bandwidth' }, { scene: 'die', part: 'unit', label: 'Compute units, once math catches up' }],
    trace: 'Add users and the same kernels take nearly the same time while each processes more rows, until math utilization starts to climb and step time grows with the batch.',
    moves: [
      { title: 'Take steps together', explanation: 'One model read serves many independent token rows.', modeled: true, viaKnob: true },
      { title: 'Keep the group full', explanation: 'Replace finished requests with ready ones; arrivals and queueing are not modeled.', modeled: false },
    ],
  },
  {
    id: 'memory-wall', number: '03', title: 'Memory fills up',
    claim: 'Every conversation keeps a memory of its context, and that KV cache takes space and must be read every step.',
    knobLabel: 'Context length', plate: 'package', numbers: [],
    changes: ['attention'], limitedBy: [{ scene: 'package', part: 'hbm', label: 'Memory stacks (HBM): capacity' }],
    trace: 'Attention kernels lengthen as context grows. Once KV spills past GPU memory, host-to-device copies appear every step and compute kernels wait on them, leaving gaps in the timeline.',
    moves: [
      { title: 'Store KV in 8 bits', explanation: 'Halve both its footprint in memory and the bytes read every step.', modeled: true, effect: 'kv8' },
      { title: 'Reuse a shared prompt', explanation: 'Skip rebuilding a 75% shared prefix. Keeping one shared copy of that KV for all users is not modeled, so memory does not shrink here.', modeled: true, effect: 'prefixReuse' },
      { title: 'Pack fixed-size blocks', explanation: 'Reduce allocation waste and fragmentation.', modeled: false },
      { title: 'Keep fewer KV heads', explanation: 'A model design choice; this model already shares eight KV heads across 32 query heads.', modeled: false },
    ],
  },
  {
    id: 'distance', number: '04', title: 'Distance is speed',
    claim: 'Where data lives decides how fast you can read it. Each step away from the math is a cliff, not a slope.',
    knobLabel: 'Where active KV lives', plate: 'server', numbers: [],
    changes: ['attention'], limitedBy: [{ scene: 'server', part: 'pcie', label: 'PCIe host link' }, { scene: 'server', part: 'peers', label: 'GPU-to-GPU links' }, { scene: 'server', part: 'net', label: 'Network and object storage' }],
    trace: 'KV kept farther away shows up as transfers (peer, host, or network reads) and waits between kernels on every step. Restoring a parked conversation appears as one burst of transfers where prompt processing would otherwise run.',
    moves: [
      { title: 'Keep active state near the math', explanation: 'Token generation rereads it on every step.', modeled: true, viaKnob: true },
      { title: 'Park idle state farther away', explanation: 'Restore it when a session resumes if that beats rebuilding the prompt.', modeled: true },
      { title: 'Prefetch before use', explanation: 'Hide some transfer time when the next request is predictable.', modeled: false },
    ],
  },
  {
    id: 'heavier-tokens', number: '05', title: 'Change what one read buys',
    claim: 'A mixture-of-experts model reads only the experts each token needs, and speculative decoding turns one read into several tokens. Both change how much useful work comes back from one trip through memory.',
    knobLabel: 'Concurrent users', plate: 'package', numbers: ['throughput'],
    changes: ['mlp', 'attention'], limitedBy: [{ scene: 'package', part: 'hbm', label: 'Memory stacks (HBM): bandwidth' }],
    trace: 'Expert kernels grow in count and duration with the experts touched each step. A speculative verify step processes several rows per sequence in one pass, so its kernels look like a small batch even for one user.',
    moves: [
      { title: 'Speculate 4 tokens ahead', explanation: 'Guess 4 tokens from the prompt text and check them in one step. Assumes 70% of guesses are accepted; the cost of guessing is not modeled.', modeled: true, effect: 'speculate' },
      { title: 'Take steps together', explanation: 'More users touch more experts, so each step reads more of the model.', modeled: true, viaKnob: true },
      { title: 'Spread experts across GPUs', explanation: 'Put different experts on different GPUs, trading memory for all-to-all traffic between them.', modeled: false },
    ],
  },
];
