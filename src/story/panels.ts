import type { PictureLayer } from './picture/model';

export interface StoryMove {
  title: string;
  explanation: string;
  modeled: boolean;
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
  moves: StoryMove[];
}

export const STORY_PANELS: StoryPanelSpec[] = [
  {
    id: 'two-jobs', number: '00', title: 'Two different jobs',
    claim: 'Reading the prompt and writing the answer are different jobs, limited by different things.',
    knobLabel: 'Prompt length', plate: 'die-pair', numbers: [],
    moves: [
      { title: 'Reuse a shared prompt', explanation: 'Skip work already completed for the same prefix.', modeled: true },
      { title: 'Split a long prompt', explanation: 'Let other ready work run between prompt pieces. Queueing interference is not modeled.', modeled: true },
      { title: 'Separate the jobs', explanation: 'Run prompt work and token generation on different machines.', modeled: false },
    ],
  },
  {
    id: 'read-model', number: '01', title: 'Every token re-reads the model',
    claim: 'To produce each token, the GPU reads every weight in the model from memory.',
    knobLabel: 'Model precision', plate: 'package', numbers: [],
    moves: [
      { title: 'Store weights in fewer bits', explanation: 'Move fewer bytes per token; accuracy and kernel support remain tradeoffs.', modeled: true },
      { title: 'Use a smaller model', explanation: 'Remove weights and math together.', modeled: false },
      { title: 'Exploit model sparsity', explanation: 'Skip structured work when the model and hardware support it.', modeled: false },
    ],
  },
  {
    id: 'share-read', number: '02', title: 'Share the read',
    claim: 'If many users take a step together, one read of the model serves all of them.',
    knobLabel: 'Concurrent users', plate: 'die', numbers: ['throughput'],
    moves: [
      { title: 'Take steps together', explanation: 'One model read serves many independent token rows.', modeled: true },
      { title: 'Keep the group full', explanation: 'Replace finished requests with ready ones; arrivals and queueing are not modeled.', modeled: false },
    ],
  },
  {
    id: 'memory-wall', number: '03', title: 'Memory fills up',
    claim: 'Every conversation keeps a memory of its context, and that KV cache takes space and must be read every step.',
    knobLabel: 'Context length', plate: 'package', numbers: [],
    moves: [
      { title: 'Store KV in fewer bits', explanation: 'Shrink both its capacity footprint and the bytes read each step.', modeled: true },
      { title: 'Reuse shared prompt KV', explanation: 'Avoid rebuilding common prompt state.', modeled: true },
      { title: 'Pack fixed-size blocks', explanation: 'Reduce allocation waste and fragmentation.', modeled: false },
      { title: 'Keep fewer KV heads', explanation: 'A model design choice; this model already shares eight KV heads across 32 query heads.', modeled: false },
    ],
  },
  {
    id: 'distance', number: '04', title: 'Distance is speed',
    claim: 'Where data lives decides how fast you can read it. Each step away from the math is a cliff, not a slope.',
    knobLabel: 'Where active KV lives', plate: 'server', numbers: [],
    moves: [
      { title: 'Keep active state near the math', explanation: 'Token generation rereads it on every step.', modeled: true },
      { title: 'Park idle state farther away', explanation: 'Restore it when a session resumes if that beats rebuilding the prompt.', modeled: true },
      { title: 'Prefetch before use', explanation: 'Hide some transfer time when the next request is predictable.', modeled: false },
    ],
  },
];
