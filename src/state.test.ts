import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './data/profiles';
import { parseSettings, settingsToSearchParams } from './state';

describe('settings URL compatibility', () => {
  it('parses existing query keys into concept-named settings', () => {
    const parsed = parseSettings(new URLSearchParams(
      'phase=prefill&gpu=mi300x&batch=64&tokens=32768&cache=75&output=128&tokenBudget=2048&memory=0.8&weights=8&kv=8&placement=peer&attention=separate&overlap=off&prefix=off&chunked=off&view=story',
    ));

    expect(parsed).toMatchObject({
      phase: 'prefill',
      hardwareId: 'mi300x',
      batch: 64,
      sequenceLength: 32768,
      promptTokensPerStep: 2048,
      servingMemoryFraction: 0.8,
      reusePromptPrefixes: false,
      splitLongPrompts: false,
      kvPlacement: 'peer',
    });
  });

  it('keeps the existing URL keys when serializing renamed settings', () => {
    const params = settingsToSearchParams({ ...DEFAULT_SETTINGS });
    expect(params.get('tokenBudget')).toBe(String(DEFAULT_SETTINGS.promptTokensPerStep));
    expect(params.get('memory')).toBe(String(DEFAULT_SETTINGS.servingMemoryFraction));
    expect(params.get('placement')).toBe('hbm');
    expect(params.has('maxNumBatchedTokens')).toBe(false);
    expect(params.has('gpuMemoryUtilization')).toBe(false);
  });
});
