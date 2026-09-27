import { formatBytes, formatDuration, formatNumber } from '../../model/calculate';
import type { PictureLayer, PictureModel } from './model';

function pct(value: number): string {
  return `${Math.max(0, Math.min(100, value * 100))}%`;
}

function costRow(step: PictureModel['steps'][number]): string {
  const max = Math.max(step.readMs, step.mathMs, Number.EPSILON);
  return `<article class="picture-cost" data-step="${step.id}">
    <header><span>${step.label}</span><strong>${formatDuration(step.totalMs)}</strong><small>${step.unit}</small></header>
    <div><label>reading <i style="--bar:${pct(step.readMs / max)}"></i><b>${formatDuration(step.readMs)}</b></label><label>math <i style="--bar:${pct(step.mathMs / max)}"></i><b>${formatDuration(step.mathMs)}</b></label></div>
    <p>Limited by <strong>${step.limit}</strong></p>
  </article>`;
}

export function renderPictureMarkup(picture: PictureModel, layers: ReadonlySet<PictureLayer>, options: { footer?: boolean } = {}): string {
  const memoryLayers = layers.has('modelBlock') || layers.has('kvBlock');
  return `<div class="concept-picture" aria-label="Computed inference cost picture">
    ${layers.has('stepCost') ? `<section class="picture-layer picture-costs" data-picture-layer="stepCost"><h3>One request, two different jobs</h3><div>${picture.steps.map(costRow).join('')}</div></section>` : ''}
    ${memoryLayers ? `<section class="picture-layer picture-memory" data-picture-layer="memory"><header><span>${picture.hardwareName} serving memory</span><strong>${formatBytes(picture.capacityBytes)}</strong></header><div class="memory-vessel" data-overflow="${picture.overflowBytes > 0}">
      ${layers.has('modelBlock') ? `<i class="memory-model" style="--share:${pct(picture.modelFraction)}"><b>${picture.modelLabel}</b></i>` : ''}
      ${layers.has('kvBlock') ? `<i class="memory-kv" style="--share:${pct(picture.kvFraction)}"><b>${picture.kvLabel}</b></i>` : ''}
      <i class="memory-free" style="--share:${pct(picture.freeBytes / picture.capacityBytes)}"><b>${picture.overflowBytes > 0 ? `${formatBytes(picture.overflowBytes)} over the wall` : `${formatBytes(picture.freeBytes)} free`}</b></i>
    </div></section>` : ''}
    ${layers.has('throughput') ? `<section class="picture-layer picture-throughput" data-picture-layer="throughput"><p><span>Each user</span><strong>${formatNumber(picture.perUserTokensPerSecond)} tok/s</strong></p><i>× ${picture.concurrentUsers.toLocaleString()} concurrent</i><p><span>Whole GPU</span><strong>${formatNumber(picture.totalTokensPerSecond)} tok/s</strong></p></section>` : ''}
    ${layers.has('distanceLadder') ? `<section class="picture-layer picture-distance" data-picture-layer="distanceLadder"><header><span>Active KV needs ${formatNumber(picture.bandwidthNeeded / 1e12)} TB/s</span><strong>Distance ladder</strong></header><ol>${picture.ladder.filter((tier) => ['hbm', 'peer', 'peers', 'host', 'ssd', 'object'].includes(tier.id)).map((tier) => `<li data-tier="${tier.id}" data-active="${tier.id === picture.placement}"><span>${tier.label}${tier.term ? ` · ${tier.term}` : ''}</span><strong>${tier.bandwidthBytesPerSecond ? `${formatNumber(tier.bandwidthBytesPerSecond / 1e9)} GB/s` : 'qualitative'}</strong><small>${tier.basis}</small></li>`).join('')}</ol><p>Restore this session: <b>${formatDuration(picture.restoreMs)}</b> · rebuild with prompt processing: <b>${formatDuration(picture.recomputeMs)}</b></p></section>` : ''}
    ${options.footer === false ? '' : `<footer><span>${picture.bottleneckTag}</span><p>${picture.bottleneckSentence}</p></footer>`}
  </div>`;
}

export function renderPicture(root: HTMLElement, picture: PictureModel, layers: ReadonlySet<PictureLayer>, options: { footer?: boolean } = {}): void {
  root.innerHTML = renderPictureMarkup(picture, layers, options);
}
