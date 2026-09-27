import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, DEFAULT_SETTINGS, getHardware } from '../../data/profiles';
import { calculateSimulation } from '../../model/calculate';
import { buildPictureModel, type PictureLayer } from './model';
import { renderPictureMarkup } from './render';

describe('renderPictureMarkup', () => {
  const hardware = getHardware(DEFAULT_SETTINGS.hardwareId);
  const result = calculateSimulation({ ...DEFAULT_SETTINGS }, hardware, DEFAULT_MODEL);
  const picture = buildPictureModel(result, { ...DEFAULT_SETTINGS }, hardware, DEFAULT_MODEL);

  it('renders each progressive layer in isolation', () => {
    const layers: PictureLayer[] = ['stepCost', 'modelBlock', 'throughput', 'kvBlock', 'distanceLadder'];
    for (const layer of layers) {
      const markup = renderPictureMarkup(picture, new Set([layer]));
      if (layer === 'modelBlock' || layer === 'kvBlock') expect(markup).toContain(`memory-${layer === 'modelBlock' ? 'model' : 'kv'}`);
      else expect(markup).toContain(`data-picture-layer="${layer}"`);
    }
  });

  it('does not reveal distance before that layer is requested', () => {
    expect(renderPictureMarkup(picture, new Set(['stepCost']))).not.toContain('Distance ladder');
  });
});
