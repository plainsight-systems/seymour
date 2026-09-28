import { DEFAULT_SETTINGS, getHardware } from '../../data/profiles';
import { formatBytes, formatDuration, formatFlops } from '../../model/calculate';
import { buildForwardPass, embeddingTableBytes, type ForwardStage, type StageId } from '../../model/forwardPass';
import { modelFor } from '../../model/strategy';
import type { SimulationSettings } from '../../types';
import { STAGE_COPY, type HardwareLink, type StageFacts } from './stages';

// Act 2: one forward pass, stage by stage. Renders the seven stage scenes
// and owns the act's workload controls (users, context). A request runs the
// stages once for the whole prompt (the first pass), then once per new token;
// the loop strip above the tabs shows that, and every stage shows the first
// pass beside a later pass.

export const STAGE_ORDER: StageId[] = ['tokenize', 'embed', 'attention', 'mlp', 'unembed', 'sample', 'detokenize'];

export const STAGE_TAB_LABEL: Record<StageId, string> = {
  tokenize: 'Text → tokens', embed: 'Embed', attention: 'Attention', mlp: 'MLP',
  unembed: 'Un-embed', sample: 'Softmax + sample', detokenize: 'Token → text',
};

const USERS = [1, 8, 32, 64, 128];
const CONTEXTS = [512, 2048, 4096, 16384, 32768];

/** The loop strip under the act header; filled in by render(). */
export const PASS_LOOP = '<div class="pass-loop" data-pass-loop aria-label="How a request runs the stages"></div>';

export const FORWARD_TOOLS = `<span class="forward-tools">
  <label class="forward-select"><span>Users</span><select data-forward="batch">${USERS.map((n) => `<option value="${n}">${n}</option>`).join('')}</select></label>
  <label class="forward-select"><span>Context</span><select data-forward="sequenceLength">${CONTEXTS.map((n) => `<option value="${n}" ${n === 4096 ? 'selected' : ''}>${n.toLocaleString()} tokens</option>`).join('')}</select></label>
</span>`;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function bytesMoved(stage: ForwardStage): number {
  return stage.weightBytes + stage.kvBytes + stage.activationBytes;
}

function ratio(a: number, b: number): string {
  const r = a / Math.max(b, Number.EPSILON);
  return `${r >= 10 ? Math.round(r).toLocaleString() : r.toFixed(1)}×`;
}

function stageTime(stage: ForwardStage): number {
  return Math.max(stage.computeMs, stage.memoryMs);
}

export interface ForwardScenesView {
  render(hardwareId: string): void;
  /** The workload chosen in Act 2, for later acts to adopt. */
  settings(): SimulationSettings;
}

export function mountForwardScenes(
  hostFor: (stage: StageId) => HTMLElement,
  toolsRoot: HTMLElement,
  openPart: (link: HardwareLink) => void,
  onWorkloadChange: (settings: SimulationSettings) => void = () => {},
): ForwardScenesView {
  let hardwareId = DEFAULT_SETTINGS.hardwareId as string;
  const workload: SimulationSettings = { ...DEFAULT_SETTINGS, phase: 'prefill', batch: 1, sequenceLength: 4096, reusePromptPrefixes: false, prefixCachePercent: 0 };

  function render(): void {
    const hardware = getHardware(hardwareId);
    const settings = { ...workload, hardwareId };
    const model = modelFor(settings);
    const jobs = {
      prefill: buildForwardPass({ ...settings, phase: 'prefill' }, model, hardware),
      decode: buildForwardPass({ ...settings, phase: 'decode' }, model, hardware),
    };
    const attention = jobs.decode.find((stage) => stage.id === 'attention')!;
    const mlp = jobs.decode.find((stage) => stage.id === 'mlp')!;
    const facts: StageFacts = {
      model,
      kvPerToken: formatBytes(model.layers * 2 * model.kvHeads * model.headDim * (model.kvBits / 8)),
      tableSize: formatBytes(embeddingTableBytes(model)),
      mlpShareOfLayer: mlp.weightBytes / (mlp.weightBytes + attention.weightBytes),
      unembedShareOfModel: embeddingTableBytes(model) / (model.parametersB * 1e9 * (model.weightBits / 8)),
    };
    const totals = {
      prefill: jobs.prefill.reduce((sum, stage) => sum + stageTime(stage), 0),
      decode: jobs.decode.reduce((sum, stage) => sum + stageTime(stage), 0),
    };
    const context = workload.sequenceLength.toLocaleString();
    const who = workload.batch === 1 ? 'one user' : `${workload.batch} users`;
    const perUser = workload.batch === 1 ? '' : ' each';
    const perUserOf = workload.batch === 1 ? '' : ' per user';
    const loop = toolsRoot.closest('.act')?.querySelector<HTMLElement>('[data-pass-loop]');
    if (loop) {
      const later = (n: string) => `<li class="pass-thin"><b>Pass ${n} · ${formatDuration(totals.decode)}</b><span>1 token${perUserOf} in → token ${n}</span></li>`;
      loop.innerHTML = `<ol>
        <li class="pass-wide"><b>Pass 1 · the whole prompt · ${formatDuration(totals.prefill)}</b><span>${context} tokens${perUser} in → token 1 out</span></li>
        ${later('2')}${later('3')}<li class="pass-more" aria-label="and so on">…</li>${later('<i>n</i>')}
      </ol>
      <p>Every pass runs all seven stages below, with the same weights. Pass 1 also saves the prompt’s keys and values (the KV cache); later passes send only the newest token through and read that cache back. Floors for ${escapeHtml(who)} on ${escapeHtml(hardware.name)}.</p>`;
    }

    STAGE_ORDER.forEach((id, index) => {
      const copy = STAGE_COPY[id];
      const both = { prefill: jobs.prefill[index]!, decode: jobs.decode[index]! };
      const cpu = both.decode.runsOn === 'cpu';
      const rows: [string, (stage: ForwardStage) => string][] = cpu
        ? [['Crosses PCIe', (stage) => formatBytes(stage.hostLinkBytes)], ['GPU math', () => 'none']]
        : [
          ['Math', (stage) => (stage.flops ? formatFlops(stage.flops) : 'none')],
          ['Weights read', (stage) => (stage.weightBytes ? formatBytes(stage.weightBytes) : 'none')],
          ['KV cache read and written', (stage) => (stage.kvBytes ? formatBytes(stage.kvBytes) : 'none')],
          ['Other values moved', (stage) => formatBytes(stage.activationBytes)],
        ];
      const limitName = (stage: ForwardStage) => (stage.limit === 'math' ? 'Math' : stage.limit === 'memory' ? 'Memory' : 'Host link');
      const floors = (stage: ForwardStage) => {
        if (cpu) return `<span class="job-floor-one">${formatDuration(stage.memoryMs)} over PCIe</span>`;
        const max = Math.max(stage.computeMs, stage.memoryMs, Number.EPSILON);
        return `<span class="job-floor" title="math ${formatDuration(stage.computeMs)}"><i class="is-math" style="--bar:${(stage.computeMs / max) * 100}%"></i><small>math ${formatDuration(stage.computeMs)}</small></span>
          <span class="job-floor" title="memory ${formatDuration(stage.memoryMs)}"><i class="is-memory" style="--bar:${(stage.memoryMs / max) * 100}%"></i><small>memory ${formatDuration(stage.memoryMs)}</small></span>`;
      };
      const share = (job: 'prefill' | 'decode') => {
        const stage = both[job];
        const percent = Math.round((stageTime(stage) / totals[job]) * 100);
        return `<div class="stage-share-bar">${jobs[job].map((other) => `<i class="${other.id === id ? 'is-current' : ''}" style="flex-grow:${Math.max(stageTime(other) / totals[job], 0.004)}" title="${escapeHtml(STAGE_TAB_LABEL[other.id])}: ${formatDuration(stageTime(other))}"></i>`).join('')}</div><small>${percent || '<1'}% · ${formatDuration(stageTime(stage))} of ${formatDuration(totals[job])}</small>`;
      };
      const verdict = cpu
        ? 'Every pass: a few bytes over PCIe.'
        : both.prefill.limit === both.decode.limit
          ? `Same limit in every pass: ${limitName(both.decode).toLowerCase()}.`
          : `Same stage, different limit. The first pass does ${ratio(both.prefill.flops, both.decode.flops)} the math of a later pass, but moves only ${ratio(bytesMoved(both.prefill), bytesMoved(both.decode))} the bytes.`;
      hostFor(id).innerHTML = `<div class="stage-scene">
        <div class="stage-narrative">
          <p class="stage-kicker">Stage ${index + 1} of ${STAGE_ORDER.length} · <span class="runs-on runs-${both.decode.runsOn}">${cpu ? 'CPU' : 'GPU'}</span>${both.decode.repeats > 1 ? ` <span class="runs-repeat">× ${both.decode.repeats} layers</span>` : ''}</p>
          <h3>${escapeHtml(copy.title)}</h3>
          <p class="stage-lead">${escapeHtml(copy.lead(model))}</p>
          ${both.decode.operations.length ? `<details class="stage-ops-wrap"><summary>The ${both.decode.operations.length === 1 ? 'operation' : `${both.decode.operations.length} operations`} inside</summary><ol class="stage-ops">${both.decode.operations.map((op) => `<li><b>${escapeHtml(op.name)}</b><code>${escapeHtml(op.equation)}</code></li>`).join('')}</ol></details>` : ''}
          <div class="stage-callouts">
            <div><span>Grows with</span><ul>${copy.growsWith.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>
            <div class="stage-overflow"><span>Where it overflows</span><p>${escapeHtml(copy.overflow(facts))}</p></div>
          </div>
          ${copy.note ? `<p class="stage-note">${escapeHtml(copy.note)}</p>` : ''}
          <div class="stage-hw"><span>Does the work · see it in Act 1</span><div>${copy.doesTheWork.map((link, i) => `<button type="button" data-open-link="${i}">${escapeHtml(link.label)} ↑</button>`).join('')}</div></div>
        </div>
        <aside class="stage-numbers" aria-label="Stage numbers for the first pass and a later pass">
          <p class="stage-context">${escapeHtml(model.name.split(' · ')[0]!)} on ${escapeHtml(hardware.name)}, ${escapeHtml(who)}, a ${context}-token prompt. This stage runs once in the first pass, then again in every pass after:</p>
          <table class="stage-jobs">
            <thead><tr><td></td>
              <th scope="col">First pass: the whole prompt<small>all ${context} tokens at once${perUser}</small></th>
              <th scope="col">Every pass after: one new token<small>1 token${perUser}, looking back at ${context}</small></th></tr></thead>
            <tbody>
              ${rows.map(([label, value]) => `<tr><th scope="row">${label}</th><td>${value(both.prefill)}</td><td>${value(both.decode)}</td></tr>`).join('')}
              <tr class="stage-jobs-floors"><th scope="row">Time floors</th><td>${floors(both.prefill)}</td><td>${floors(both.decode)}</td></tr>
              <tr class="stage-jobs-limit"><th scope="row">Limited by</th><td class="limit-${both.prefill.limit}">${limitName(both.prefill)}</td><td class="limit-${both.decode.limit}">${limitName(both.decode)}</td></tr>
              <tr class="stage-jobs-share"><th scope="row">Share of the pass</th><td>${share('prefill')}</td><td>${share('decode')}</td></tr>
            </tbody>
          </table>
          <p class="stage-verdict">${escapeHtml(verdict)}</p>
          <p class="stage-footnote">Per-stage floors from peak math and memory speed, not a stopwatch: a real step overlaps some of this work.</p>
        </aside>
      </div>`;
      hostFor(id).querySelector('.stage-hw')!.addEventListener('click', (event) => {
        const button = (event.target as Element).closest<HTMLButtonElement>('[data-open-link]');
        if (button) openPart(copy.doesTheWork[Number(button.dataset.openLink)]!);
      });
    });
  }

  toolsRoot.addEventListener('change', (event) => {
    const select = (event.target as Element).closest<HTMLSelectElement>('[data-forward]');
    if (!select) return;
    if (select.dataset.forward === 'batch') workload.batch = Number(select.value);
    if (select.dataset.forward === 'sequenceLength') workload.sequenceLength = Number(select.value);
    render();
    onWorkloadChange({ ...workload, hardwareId });
  });

  return {
    render(nextHardwareId: string): void {
      hardwareId = nextHardwareId;
      render();
    },
    settings: () => ({ ...workload, hardwareId }),
  };
}
