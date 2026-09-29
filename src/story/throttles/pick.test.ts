import { describe, expect, it } from 'vitest';
import { HARDWARE_PROFILES, getHardware } from '../../data/profiles';
import { calculateSimulation } from '../../model/calculate';
import { modelFor } from '../../model/strategy';
import { PICK_SCENARIOS, WHY, applyMove, rankMoves, scenarioSettings } from './pick';

const byId = (id: string) => PICK_SCENARIOS.find((scenario) => scenario.id === id)!;

describe('pick-the-throttle challenge', () => {
  it('ranks every move by the speedup the model gives it', () => {
    for (const hardware of HARDWARE_PROFILES) {
      for (const scenario of PICK_SCENARIOS) {
        const answer = rankMoves(scenario, hardware.id);
        expect(answer.ranked).toHaveLength(5);
        for (let i = 1; i < answer.ranked.length; i++) expect(answer.ranked[i - 1]!.speedup).toBeGreaterThanOrEqual(answer.ranked[i]!.speedup);
        expect(answer.best).toBe(answer.ranked[0]!.move);
      }
    }
  });

  it('has a clear best move that really helps, so no answer is a coin flip', () => {
    for (const hardware of HARDWARE_PROFILES) {
      for (const scenario of PICK_SCENARIOS) {
        const [first, second] = rankMoves(scenario, hardware.id).ranked;
        expect(first!.speedup, `${scenario.id} on ${hardware.id}`).toBeGreaterThan(1.2);
        expect(first!.speedup / second!.speedup, `${scenario.id} on ${hardware.id}`).toBeGreaterThanOrEqual(1.25);
      }
    }
  });

  it('gives each scenario its intended lesson on every chip', () => {
    for (const hardware of HARDWARE_PROFILES) {
      expect(rankMoves(byId('code-edit'), hardware.id).best).toBe('speculate');
      expect(rankMoves(byId('team-chat'), hardware.id).best).toBe('kv8');
      expect(rankMoves(byId('solo-chat'), hardware.id).best).toBe('fp8');
      expect(rankMoves(byId('support-bot'), hardware.id).best).toBe('reuse');
      expect(rankMoves(byId('unique-docs'), hardware.id).best).toBe('fp8');
    }
  });

  it('explains every best move the scenarios produce', () => {
    for (const hardware of HARDWARE_PROFILES) {
      for (const scenario of PICK_SCENARIOS) {
        const answer = rankMoves(scenario, hardware.id);
        expect(WHY[`${answer.best}/${scenario.goal}`], `${scenario.id} on ${hardware.id}`).toBeDefined();
      }
    }
  });

  it('flags a move that overflows GPU memory', () => {
    // 48 users × 16,384 tokens of KV does not fit beside the weights on an 80 GB H100.
    const doubled = rankMoves(byId('team-chat'), 'h100-sxm').ranked.find((result) => result.move === 'users2')!;
    expect(doubled.spills).toBe(true);
    expect(doubled.speedup).toBeLessThan(0.5);
    expect(rankMoves(byId('team-chat'), 'h100-sxm').ranked.find((result) => result.move === 'kv8')!.spills).toBe(false);
  });

  it('only lets reuse help when something is shared, and keeps every scenario inside GPU memory', () => {
    const docs = byId('unique-docs');
    expect(rankMoves(docs, 'h100-sxm').ranked.find((result) => result.move === 'reuse')!.speedup).toBeCloseTo(1, 10);
    const base = scenarioSettings(docs, 'h100-sxm');
    expect(applyMove(base, 'reuse', docs).reusePromptPrefixes).toBe(false);
    for (const hardware of HARDWARE_PROFILES) {
      for (const scenario of PICK_SCENARIOS) {
        // A baseline that spills past GPU memory would make every answer about the spill.
        const settings = scenarioSettings(scenario, hardware.id);
        const result = calculateSimulation(settings, getHardware(hardware.id), modelFor(settings));
        expect(result.hbmUsedFraction, `${scenario.id} on ${hardware.id}`).toBeLessThanOrEqual(1);
      }
    }
  });
});
