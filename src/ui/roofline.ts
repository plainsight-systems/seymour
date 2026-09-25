import type { HardwareProfile, SimulationResult } from '../types';
import { formatNumber } from '../model/calculate';

const WIDTH = 560;
const HEIGHT = 270;
const PAD = { left: 58, right: 24, top: 26, bottom: 46 };
const MIN_AI = 0.5;
const MAX_AI = 8192;
const MIN_PERF = 0.2;

function logPosition(value: number, min: number, max: number): number {
  return (Math.log10(value) - Math.log10(min)) / (Math.log10(max) - Math.log10(min));
}

export function renderRoofline(
  element: HTMLElement,
  result: SimulationResult,
  hardware: HardwareProfile,
): void {
  const maxPerf = hardware.fp16DenseTflops * hardware.computeEfficiency * 1.7;
  const x = (value: number) => PAD.left + logPosition(value, MIN_AI, MAX_AI) * (WIDTH - PAD.left - PAD.right);
  const y = (value: number) =>
    HEIGHT - PAD.bottom - logPosition(value, MIN_PERF, maxPerf) * (HEIGHT - PAD.top - PAD.bottom);
  const effectiveBandwidth = hardware.hbmBandwidthTBs * hardware.memoryEfficiency;
  const effectiveCompute = hardware.fp16DenseTflops * hardware.computeEfficiency;
  const ridge = result.ridgePoint;
  const observedPerf = result.bottleneck === 'host'
    ? result.flops / Math.max(result.memoryMs / 1000, Number.EPSILON) / 1e12
    : Math.min(effectiveCompute, result.arithmeticIntensity * effectiveBandwidth);
  const roofStartY = y(MIN_AI * effectiveBandwidth);
  const ridgeX = x(ridge);
  const roofY = y(effectiveCompute);
  const pointX = x(Math.max(MIN_AI, Math.min(MAX_AI, result.arithmeticIntensity)));
  const pointY = y(Math.max(MIN_PERF, observedPerf));

  const xTicks = [1, 4, 16, 64, 256, 1024, 4096];
  const yTicks = [1, 10, 100, 1000].filter((tick) => tick < maxPerf * 1.1);

  element.innerHTML = `
    <svg class="roofline" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-labelledby="roof-title roof-desc">
      <title id="roof-title">Roofline position for the current inference phase</title>
      <desc id="roof-desc">Arithmetic intensity is ${formatNumber(result.arithmeticIntensity)} FLOPs per byte. The hardware ridge point is ${formatNumber(ridge)} FLOPs per byte. This workload is ${result.bottleneck} bound${result.bottleneck === 'host' ? ' because part of the working set crosses the slower host link' : ''}.</desc>
      <g class="roof-grid">
        ${xTicks.map((tick) => `<line x1="${x(tick)}" y1="${PAD.top}" x2="${x(tick)}" y2="${HEIGHT - PAD.bottom}"/><text x="${x(tick)}" y="${HEIGHT - 21}">${tick}</text>`).join('')}
        ${yTicks.map((tick) => `<line x1="${PAD.left}" y1="${y(tick)}" x2="${WIDTH - PAD.right}" y2="${y(tick)}"/><text x="${PAD.left - 11}" y="${y(tick) + 4}">${tick}</text>`).join('')}
      </g>
      <path class="roof-limit" d="M ${x(MIN_AI)} ${roofStartY} L ${ridgeX} ${roofY} L ${x(MAX_AI)} ${roofY}"/>
      <line class="roof-guide" x1="${pointX}" y1="${pointY}" x2="${pointX}" y2="${HEIGHT - PAD.bottom}"/>
      <circle class="roof-point ${result.bottleneck}" cx="${pointX}" cy="${pointY}" r="8"/>
      <text class="roof-point-label" x="${Math.min(pointX + 13, WIDTH - 150)}" y="${Math.max(pointY - 13, 21)}">${formatNumber(result.arithmeticIntensity)} FLOP/B</text>
      <text class="roof-axis-label" x="${WIDTH / 2}" y="${HEIGHT - 3}">Arithmetic intensity · FLOP/byte</text>
      <text class="roof-axis-label roof-axis-y" transform="translate(14 ${HEIGHT / 2}) rotate(-90)">Attainable FP16 · TFLOP/s</text>
      <text class="roof-caption" x="${ridgeX + 6}" y="${roofY - 9}">ridge ${formatNumber(ridge)}</text>
    </svg>
  `;
}
