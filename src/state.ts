import { DEFAULT_SETTINGS } from './data/profiles';
import type { AttentionKernel, KvBits, Phase, SimulationSettings, ViewMode, WeightBits } from './types';

const BATCHES = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];
const SEQUENCES = [128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768];

export function readSettings(): SimulationSettings {
  const params = new URLSearchParams(window.location.search);
  const phase: Phase = params.get('phase') === 'prefill' ? 'prefill' : 'decode';
  const hardwareId = params.get('gpu') || DEFAULT_SETTINGS.hardwareId;
  const batch = nearest(Number(params.get('batch')) || DEFAULT_SETTINGS.batch, BATCHES);
  const sequenceLength = nearest(
    Number(params.get('tokens')) || DEFAULT_SETTINGS.sequenceLength,
    SEQUENCES,
  );
  const weightBits = ([4, 8, 16] as const).includes(Number(params.get('weights')) as WeightBits)
    ? Number(params.get('weights')) as WeightBits
    : DEFAULT_SETTINGS.weightBits;
  const kvBits = ([8, 16] as const).includes(Number(params.get('kv')) as KvBits)
    ? Number(params.get('kv')) as KvBits
    : DEFAULT_SETTINGS.kvBits;
  const attentionKernel: AttentionKernel = params.get('attention') === 'separate' ? 'separate' : 'fused';
  const overlap = params.get('overlap') !== 'off';
  const view: ViewMode = params.get('view') === 'story' ? 'story' : DEFAULT_SETTINGS.view;
  return { phase, hardwareId, batch, sequenceLength, weightBits, kvBits, attentionKernel, overlap, view };
}

export function writeSettings(settings: SimulationSettings, operationId?: string): void {
  const params = new URLSearchParams({
    phase: settings.phase,
    gpu: settings.hardwareId,
    batch: String(settings.batch),
    tokens: String(settings.sequenceLength),
    weights: String(settings.weightBits),
    kv: String(settings.kvBits),
    attention: settings.attentionKernel,
    view: settings.view,
  });
  if (!settings.overlap) params.set('overlap', 'off');
  if (operationId) params.set('op', operationId);
  history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
}

export function batchFromSlider(value: number): number {
  return BATCHES[Math.max(0, Math.min(BATCHES.length - 1, value))]!;
}

export function batchToSlider(batch: number): number {
  return BATCHES.indexOf(nearest(batch, BATCHES));
}

export function sequenceFromSlider(value: number): number {
  return SEQUENCES[Math.max(0, Math.min(SEQUENCES.length - 1, value))]!;
}

export function sequenceToSlider(sequence: number): number {
  return SEQUENCES.indexOf(nearest(sequence, SEQUENCES));
}

function nearest(value: number, choices: number[]): number {
  return choices.reduce((best, choice) =>
    Math.abs(choice - value) < Math.abs(best - value) ? choice : best,
  );
}
