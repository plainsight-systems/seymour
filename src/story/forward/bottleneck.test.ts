import { describe, expect, it } from 'vitest';
import { HARDWARE_PROFILES } from '../../data/profiles';
import { SCENARIOS, WHY, judge, solve, stageTimeMs, tally } from './bottleneck';

const byId = (id: string) => SCENARIOS.find((scenario) => scenario.id === id)!;

describe('find-the-bottleneck challenge', () => {
  it('picks the stage with the longest time floor, and its limit', () => {
    for (const hardware of HARDWARE_PROFILES) {
      for (const scenario of SCENARIOS) {
        const answer = solve(scenario, hardware.id);
        const slowest = answer.stages.find((stage) => stage.id === answer.stage)!;
        for (const stage of answer.stages) expect(stageTimeMs(stage)).toBeLessThanOrEqual(stageTimeMs(slowest));
        expect(answer.limit).toBe(slowest.limit);
      }
    }
  });

  it('gives the textbook answers where they do not hinge on modeling details', () => {
    // Robust on every chip: decode at low batch reads weights; long-context decode reads KV; batched prompts do math.
    for (const hardware of HARDWARE_PROFILES) {
      expect(solve(byId('chat-reply'), hardware.id)).toMatchObject({ stage: 'mlp', limit: 'memory' });
      // 16 × 8,192 = 131K tokens of KV (about 17 GB) outweighs the MLP's 11 GB of weights.
      expect(solve(byId('team-chats'), hardware.id)).toMatchObject({ stage: 'attention', limit: 'memory' });
      expect(solve(byId('busy-long'), hardware.id)).toMatchObject({ stage: 'attention', limit: 'memory' });
      expect(solve(byId('short-prompts'), hardware.id)).toMatchObject({ stage: 'mlp', limit: 'math' });
    }
  });

  it('has a clear winner in every scenario, so no answer is a coin flip', () => {
    for (const hardware of HARDWARE_PROFILES) {
      for (const scenario of SCENARIOS) {
        const times = solve(scenario, hardware.id).stages.map(stageTimeMs).sort((a, b) => b - a);
        expect(times[0]! / times[1]!, `${scenario.id} on ${hardware.id}`).toBeGreaterThanOrEqual(1.25);
      }
    }
  });

  it('does not have one answer for every scenario', () => {
    const answers = new Set(SCENARIOS.map((scenario) => { const a = solve(scenario, 'h100-sxm'); return `${a.stage}/${a.limit}`; }));
    expect(answers.size).toBeGreaterThanOrEqual(3);
  });

  it('explains every answer the scenarios can produce', () => {
    for (const hardware of HARDWARE_PROFILES) {
      for (const scenario of SCENARIOS) {
        const answer = solve(scenario, hardware.id);
        expect(WHY[answer.stage]?.[answer.limit], `${scenario.id} on ${hardware.id}`).toBeDefined();
      }
    }
  });

  it('judges the stage and the limit separately', () => {
    const answer = solve(byId('chat-reply'), 'h100-sxm');
    expect(judge(answer, { stage: 'mlp', limit: 'memory' })).toEqual({ stageRight: true, limitRight: true });
    expect(judge(answer, { stage: 'attention', limit: 'memory' })).toEqual({ stageRight: false, limitRight: true });
    expect(judge(answer, { stage: 'mlp', limit: 'math' })).toEqual({ stageRight: true, limitRight: false });
  });

  it('keeps a running score and knows when every scenario is answered', () => {
    expect(tally(new Map())).toEqual({ answered: 0, right: 0, total: SCENARIOS.length, complete: false });
    const some = new Map([[SCENARIOS[0]!.id, true], [SCENARIOS[2]!.id, false], ['not-a-scenario', true]]);
    expect(tally(some)).toEqual({ answered: 2, right: 1, total: SCENARIOS.length, complete: false });
    const all = new Map(SCENARIOS.map((scenario, i) => [scenario.id, i % 2 === 0]));
    expect(tally(all)).toMatchObject({ answered: SCENARIOS.length, right: Math.ceil(SCENARIOS.length / 2), complete: true });
  });
});
