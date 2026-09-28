import { DEFAULT_SETTINGS, getHardware } from '../../data/profiles';
import { formatBytes, formatDuration, formatFlops } from '../../model/calculate';
import { buildForwardPass, embeddingTableBytes, type ForwardStage, type StageId } from '../../model/forwardPass';
import { modelFor } from '../../model/strategy';
import type { SimulationSettings } from '../../types';
import { STAGE_COPY, type HardwareLink, type StageFacts } from './stages';

// Act 2: one forward pass, stage by stage. Renders the seven stage scenes
// and owns the act's workload controls (job, users, context).

export const STAGE_ORDER: StageId[] = ['tokenize', 'embed', 'attention', 'mlp', 'unembed', 'sample', 'detokenize'];

export const STAGE_TAB_LABEL: Record<StageId, string> = {
  tokenize: 'Text → tokens', embed: 'Embed', attention: 'Attention', mlp: 'MLP',
  unembed: 'Un-embed', sample: 'Softmax + sample', detokenize: 'Token → text',
};

const USERS = [1, 8, 32, 64, 128];
const CONTEXTS = [512, 2048, 4096, 16384, 32768];

export const FORWARD_TOOLS = `<span class="forward-tools">
  <span class="view-toggle" role="group" aria-label="Which job"><button type="button" data-job="prefill" aria-pressed="true">Prompt</button><button type="button" data-job="decode" aria-pressed="false">Next token</button></span>
  <label class="forward-select"><span>Users</span><select data-forward="batch">${USERS.map((n) => `<option value="${n}">${n}</option>`).join('')}</select></label>
  <label class="forward-select"><span>Context</span><select data-forward="sequenceLength">${CONTEXTS.map((n) => `<option value="${n}" ${n === 4096 ? 'selected' : ''}>${n.toLocaleString()} tokens</option>`).join('')}</select></label>
</span>`;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
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
    const stages = buildForwardPass(settings, model, hardware);
    const attention = stages.find((stage) => stage.id === 'attention')!;
    const mlp = stages.find((stage) => stage.id === 'mlp')!;
    const facts: StageFacts = {
      model,
      kvPerToken: formatBytes(model.layers * 2 * model.kvHeads * model.headDim * (model.kvBits / 8)),
      tableSize: formatBytes(embeddingTableBytes(model)),
      mlpShareOfLayer: mlp.weightBytes / (mlp.weightBytes + attention.weightBytes),
      unembedShareOfModel: embeddingTableBytes(model) / (model.parametersB * 1e9 * (model.weightBits / 8)),
    };
    const total = stages.reduce((sum, stage) => sum + stageTime(stage), 0);
    const job = workload.phase === 'prefill'
      ? `processing a ${workload.sequenceLength.toLocaleString()}-token prompt`
      : `writing one token with ${workload.sequenceLength.toLocaleString()} tokens of context`;
    const who = workload.batch === 1 ? 'one user' : `${workload.batch} users`;

    stages.forEach((stage, index) => {
      const copy = STAGE_COPY[stage.id];
      const cpu = stage.runsOn === 'cpu';
      const numbers: [string, string][] = cpu
        ? [['Crosses PCIe', formatBytes(stage.hostLinkBytes)], ['GPU math', 'none']]
        : [
          ['Math', stage.flops ? formatFlops(stage.flops) : 'none'],
          ['Weights read', stage.weightBytes ? formatBytes(stage.weightBytes) : 'none'],
          ['KV cache read and written', stage.kvBytes ? formatBytes(stage.kvBytes) : 'none'],
          ['Other values moved', formatBytes(stage.activationBytes)],
        ];
      const max = Math.max(stage.computeMs, stage.memoryMs, Number.EPSILON);
      const limit = stage.limit === 'math' ? 'Limited by math' : stage.limit === 'memory' ? 'Limited by reading memory' : 'Limited by the host link';
      hostFor(stage.id).innerHTML = `<div class="stage-scene">
        <div class="stage-narrative">
          <p class="stage-kicker">Stage ${index + 1} of ${stages.length} · <span class="runs-on runs-${stage.runsOn}">${cpu ? 'CPU' : 'GPU'}</span>${stage.repeats > 1 ? ` <span class="runs-repeat">× ${stage.repeats} layers</span>` : ''}</p>
          <h3>${escapeHtml(copy.title)}</h3>
          <p class="stage-lead">${escapeHtml(copy.lead(model))}</p>
          ${stage.operations.length ? `<details class="stage-ops-wrap"><summary>The ${stage.operations.length === 1 ? 'operation' : `${stage.operations.length} operations`} inside</summary><ol class="stage-ops">${stage.operations.map((op) => `<li><b>${escapeHtml(op.name)}</b><code>${escapeHtml(op.equation)}</code></li>`).join('')}</ol></details>` : ''}
          <div class="stage-callouts">
            <div><span>Grows with</span><ul>${copy.growsWith.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>
            <div class="stage-overflow"><span>Where it overflows</span><p>${escapeHtml(copy.overflow(facts))}</p></div>
          </div>
          ${copy.note ? `<p class="stage-note">${escapeHtml(copy.note)}</p>` : ''}
          <div class="stage-hw"><span>Does the work · see it in Act 1</span><div>${copy.doesTheWork.map((link, i) => `<button type="button" data-open-link="${i}">${escapeHtml(link.label)} ↑</button>`).join('')}</div></div>
        </div>
        <aside class="stage-numbers" aria-label="Stage numbers">
          <p class="stage-context">${escapeHtml(model.name.split(' · ')[0]!)} on ${escapeHtml(hardware.name)}, ${escapeHtml(job)} for ${escapeHtml(who)}</p>
          <p class="stage-shape"><code>${escapeHtml(stage.inputShape)}</code> → <code>${escapeHtml(stage.outputShape)}</code></p>
          <dl>${numbers.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>
          ${cpu ? `<p class="stage-limit">${limit}: ${formatDuration(stage.memoryMs)} over PCIe</p>` : `<div class="stage-floors">
            <label>math <i style="--bar:${(stage.computeMs / max) * 100}%"></i><b>${formatDuration(stage.computeMs)}</b></label>
            <label>memory <i style="--bar:${(stage.memoryMs / max) * 100}%"></i><b>${formatDuration(stage.memoryMs)}</b></label>
          </div><p class="stage-limit">${limit}</p>`}
          <div class="stage-share"><span>Where one pass’s time goes</span>
            <div class="stage-share-bar">${stages.map((other) => `<i data-stage="${other.id}" class="${other.id === stage.id ? 'is-current' : ''}" style="flex-grow:${Math.max(stageTime(other) / total, 0.004)}" title="${escapeHtml(STAGE_TAB_LABEL[other.id])}: ${formatDuration(stageTime(other))}"></i>`).join('')}</div>
            <p><b>${Math.round((stageTime(stage) / total) * 100) || '<1'}%</b> of the pass is this stage (${formatDuration(stageTime(stage))} of ${formatDuration(total)}). Per-stage floors, not a stopwatch: a real step overlaps some of this work.</p>
          </div>
        </aside>
      </div>`;
      hostFor(stage.id).querySelector('.stage-hw')!.addEventListener('click', (event) => {
        const button = (event.target as Element).closest<HTMLButtonElement>('[data-open-link]');
        if (button) openPart(copy.doesTheWork[Number(button.dataset.openLink)]!);
      });
    });
    for (const button of toolsRoot.querySelectorAll<HTMLButtonElement>('[data-job]')) button.setAttribute('aria-pressed', String(button.dataset.job === workload.phase));
  }

  toolsRoot.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-job]');
    if (!button) return;
    workload.phase = button.dataset.job as SimulationSettings['phase'];
    render();
  });
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
