import '@fontsource-variable/anybody';
import '@fontsource-variable/public-sans';
import './style.css';
import { DEFAULT_MODEL, HARDWARE_PROFILES, getHardware } from './data/profiles';
import {
  calculateSimulation,
  formatBytes,
  formatDuration,
  formatFlops,
  formatNumber,
} from './model/calculate';
import { buildAlgorithmSteps } from './model/algorithm';
import { buildKernelPlan } from './model/kernels';
import { buildTeachingGuide } from './model/teaching';
import {
  batchFromSlider,
  batchToSlider,
  readSettings,
  sequenceFromSlider,
  sequenceToSlider,
  writeSettings,
} from './state';
import type { AlgorithmStep, HardwareStage, KernelPhase, KernelPlan, SimulationSettings } from './types';
import { renderRoofline } from './ui/roofline';
import { SeymourScene } from './visualization/SeymourScene';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app root');

app.innerHTML = `
  <header class="site-header">
    <a class="brand" href="./" aria-label="Seymour home">
      <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
      <span>Seymour</span>
    </a>
    <p class="tagline">A physical model of LLM inference</p>
    <nav class="header-actions" aria-label="Project links">
      <a href="#method">Method</a>
      <a href="https://github.com/plainsight-systems/seymour">GitHub</a>
    </nav>
  </header>

  <main>
    <section class="intro" aria-labelledby="page-title">
      <div>
        <p class="kicker">A visual introduction to inference hardware</p>
        <h1 id="page-title">The math is hungry. <em>Bring bytes.</em></h1>
      </div>
      <div class="intro-copy">
        <p>Follow one real transformer operation from model code to memory, compute units, and the bottleneck it creates.</p>
        <button class="text-button" id="start-tour" type="button">Start the guided lesson <span aria-hidden="true">→</span></button>
      </div>
    </section>

    <section class="machine" aria-label="Interactive inference execution map">
      <div class="machine-topbar">
        <div class="mode-switches">
          <div class="phase-switch" role="group" aria-label="Inference phase">
            <button type="button" data-phase="decode" aria-pressed="true"><span>01</span> Decode</button>
            <button type="button" data-phase="prefill" aria-pressed="false"><span>02</span> Prefill</button>
          </div>
        </div>
        <div class="machine-tools">
          <button type="button" class="icon-button" id="share-state"><span aria-hidden="true">↗</span> Share</button>
        </div>
      </div>

      <section class="execution-lesson" aria-labelledby="algorithm-title">
        <header class="lesson-heading">
          <div>
            <p class="kicker">Follow one operation</p>
            <h2 id="algorithm-title">How a decode token crosses the machine.</h2>
          </div>
          <p>Choose a transformer operation, then follow its data through the runtime, memory hierarchy, kernel, and execution lanes. Nothing advances unless you ask it to.</p>
          <div class="lesson-navigation" aria-label="Operation navigation">
            <button id="previous-operation" type="button"><span aria-hidden="true">←</span> Previous</button>
            <label class="operation-picker"><span>Operation</span><select id="operation-select" aria-label="Choose transformer operation"></select></label>
            <button id="next-operation" type="button">Next <span aria-hidden="true">→</span></button>
          </div>
        </header>

        <div class="algorithm-steps" id="algorithm-steps" aria-label="Transformer chapter progress"></div>

        <div class="lesson-workspace">
          <section class="canonical-map" aria-labelledby="machine-map-title">
            <header class="canonical-map-heading">
              <div>
                <span id="path-step">02 / 12</span>
                <p class="kicker">One stable machine map</p>
                <h3 id="machine-map-title">What the accelerator contains—and where this operation runs.</h3>
              </div>
              <div>
                <strong id="path-title">QKV projection data path</strong>
                <code class="path-equation" id="path-equation">Q = x̂WQ · K = x̂WK · V = x̂WV</code>
                <p id="path-summary"></p>
              </div>
            </header>

            <div class="data-legend" id="data-legend"></div>

            <aside class="tour-panel" id="tour-panel" hidden aria-live="polite">
              <div class="tour-progress"><span id="tour-number">1 / 4</span><i id="tour-bar"></i></div>
              <div><p class="kicker" id="tour-kicker">The machine</p><h2 id="tour-title">Start with two sides.</h2><p id="tour-copy"></p></div>
              <div class="tour-actions">
                <button class="button-secondary" id="tour-exit" type="button">Explore on my own</button>
                <button class="button-primary" id="tour-next" type="button">Next <span aria-hidden="true">→</span></button>
              </div>
            </aside>

            <div class="machine-map" id="system-path" aria-label="Conceptual map of the host computer and accelerator. Highlighted regions show the selected operation's path.">
              <section class="map-host path-node" data-path-stage="host">
                <span>Outside the accelerator</span>
                <strong>Host computer</strong>
                <p>The CPU starts kernels. System memory holds data only when accelerator memory overflows.</p>
                <small id="host-data-note">Launch commands cross to the accelerator.</small>
              </section>

              <div class="map-link" aria-label="PCIe connects the host computer to the accelerator">
                <span>PCIe connection</span><i aria-hidden="true">→</i><small>commands</small>
              </div>

              <section class="map-package path-node" data-path-stage="package">
                <header>
                  <div><span>Accelerator boundary</span><strong>Accelerator package</strong></div>
                  <p>A conceptual cutaway—not physical scale. Memory and the GPU chip sit inside this boundary.</p>
                </header>
                <div class="map-package-body">
                  <section class="map-hbm path-node" data-path-stage="hbm">
                    <em>1</em>
                    <span>Fast memory beside the GPU chip</span>
                    <strong>High-bandwidth memory (HBM)</strong>
                    <p>Model weights and the key/value cache live here between operations.</p>
                  </section>

                  <section class="map-gpu">
                    <header><span>Central silicon</span><strong>GPU chip (die)</strong><small>Contains cache and many repeated compute units</small></header>
                    <div class="map-gpu-body">
                      <section class="map-l2 path-node" data-path-stage="l2">
                        <em>2</em><span>Shared on-chip cache</span><strong>L2 cache</strong><p>Reuses recently fetched data across compute units.</p>
                      </section>
                      <div class="worker-array" aria-label="Many repeated compute units">
                        <span>Many repeated compute units</span>
                        <div aria-hidden="true">${Array.from({ length: 18 }, () => '<i></i>').join('')}</div>
                      </div>
                      <section class="map-worker">
                        <header><span>One worker, enlarged</span><strong>Compute unit</strong><small>NVIDIA calls it an SM. AMD calls it a CU.</small></header>
                        <div class="worker-pipeline">
                          <section class="path-node" data-path-stage="shared"><em>3</em><span>Nearby scratchpad</span><strong>Local memory</strong><small>Shared memory on NVIDIA · Local Data Share (LDS) on AMD</small></section>
                          <section class="path-node" data-path-stage="registers"><em>4</em><span>Per-lane working values</span><strong>Registers</strong><small>Hold fragments immediately before and after math</small></section>
                          <section class="path-node" data-path-stage="compute"><em>5</em><span>Arithmetic hardware</span><strong>Matrix + vector units</strong><small>Execute multiply-accumulate and vector instructions</small></section>
                        </div>
                      </section>
                    </div>
                  </section>
                </div>
              </section>
            </div>

            <p class="route-disclaimer"><strong>How to read this:</strong> numbered highlights show tensor data moving closer to the math units. The separate PCIe arrow is the CPU command path. These are diagram marks, not literal pipes.</p>
          </section>

          <section class="teaching-rail">
            <article class="algorithm-detail" id="algorithm-detail">
              <div class="algorithm-detail-heading">
                <span id="algorithm-number"></span>
                <div><p id="algorithm-group"></p><h3 id="algorithm-name"></h3></div>
              </div>
              <code class="algorithm-equation" id="algorithm-equation"></code>
              <p class="algorithm-description" id="algorithm-description"></p>
              <dl class="shape-ledger">
                <div><dt>Input</dt><dd id="algorithm-input"></dd></div>
                <div><dt>Output</dt><dd id="algorithm-output"></dd></div>
              </dl>
            </article>

            <section class="performance-lesson">
              <p class="kicker">Why performance cares</p>
              <h3 id="performance-title"></h3>
              <p id="performance-copy"></p>
            </section>

            <details class="lesson-details">
              <summary>Open terminology, measurements, and optimization choices</summary>
              <div class="lesson-details-body">
                <section>
                  <div class="evidence-key" aria-label="Evidence types"><span data-evidence="fact">vendor fact</span><span data-evidence="computed">computed</span><span data-evidence="assumption">assumption</span></div>
                  <div id="term-list" class="term-list"></div>
                  <dl class="operation-ledger">
                    <div><dt>Work</dt><dd id="algorithm-flops"></dd></div>
                    <div><dt>Weights</dt><dd id="algorithm-weights"></dd></div>
                    <div><dt>Logical tensor</dt><dd id="algorithm-activations"></dd></div>
                    <div><dt>HBM crossing</dt><dd id="algorithm-boundary"></dd></div>
                    <div><dt>Runs</dt><dd id="algorithm-repetition"></dd></div>
                    <div><dt>Execution home</dt><dd id="algorithm-location"></dd></div>
                  </dl>
                </section>
                <section class="optimization-lesson">
                  <p class="kicker">Optimize here</p>
                  <h3 id="optimization-title"></h3>
                  <div id="optimization-list" class="optimization-list"></div>
                </section>
              </div>
            </details>
          </section>

          <details class="spatial-inspector">
            <summary><span>Optional spatial view</span><strong>Inspect the accelerator package in 3D</strong><small>The canonical map above carries the lesson. This view adds spatial context.</small></summary>
            <div class="spatial-toolbar">
              <div class="view-switch" role="group" aria-label="3D visualization style">
                <button type="button" data-view="hardware" aria-pressed="true">Hardware cutaway</button>
                <button type="button" data-view="story" aria-pressed="false">Plant analogy</button>
              </div>
              <button type="button" class="icon-button" id="reset-camera">Reset view</button>
              <button type="button" class="icon-button" id="export-image"><span aria-hidden="true">↓</span> Export still</button>
            </div>
            <div class="viewport-wrap">
              <div id="viewport" class="viewport"></div>
              <div class="viewport-key" aria-hidden="true">
                <span><i class="key-control"></i>commands</span>
                <span><i class="key-weight"></i>weights</span>
                <span><i class="key-kv"></i>key/value cache</span>
                <span id="viewport-mode-note">physical cutaway · drag to orbit</span>
              </div>
              <p class="sr-only" id="scene-summary" aria-live="polite"></p>
            </div>
          </details>
        </div>

        <details class="workload-drawer">
          <summary><span>Workload</span><strong id="workload-summary"></strong><small>Change GPU, batch, context, and roofline assumptions</small></summary>
          <form class="controls" id="controls">
            <div class="control-heading">
              <div><p class="kicker">Workload</p><h2>Change the pressure on the system.</h2></div>
              <button type="button" id="reset-controls" class="reset-button">Reset</button>
            </div>
            <label class="field"><span>Accelerator</span><select id="hardware-select">${HARDWARE_PROFILES.map((profile) => `<option value="${profile.id}">${profile.vendor} · ${profile.name}</option>`).join('')}</select></label>
            <div class="model-stamp"><span>Model</span><strong>${DEFAULT_MODEL.name}</strong><small>${DEFAULT_MODEL.parametersB}B parameters · GQA ${DEFAULT_MODEL.attentionHeads}:${DEFAULT_MODEL.kvHeads}</small></div>
            <label class="field range-field"><span>Batch <output id="batch-output">1</output></span><input id="batch-range" type="range" min="0" max="8" step="1" value="0" /><span class="range-ends"><small>1</small><small>256 sequences</small></span></label>
            <label class="field range-field"><span id="tokens-label">Context <output id="tokens-output">4,096</output></span><input id="tokens-range" type="range" min="0" max="8" step="1" value="5" /><span class="range-ends"><small>128</small><small>32K tokens</small></span></label>
            <label class="toggle-field"><span><strong>Overlap compute + memory</strong><small>Optimistic roofline assumption</small></span><input id="overlap-toggle" type="checkbox" checked /><i aria-hidden="true"></i></label>
            <div class="assumptions"><button type="button" id="assumptions-toggle" aria-expanded="false" aria-controls="assumptions-body">Model assumptions <span aria-hidden="true">+</span></button><div id="assumptions-body" class="assumptions-body"><p>Dense FP16 weights and KV. Fused attention avoids materializing the score matrix. Published peak × <strong id="efficiency-summary"></strong>. Host spill uses the published PCIe link ceiling. The kernel microscope separately exposes a 5 µs launch assumption and does not feed it back into the whole-model roofline.</p></div></div>
          </form>
        </details>

        <details class="kernel-deep-dive">
          <summary><span>Kernel microscope</span><strong id="kernel-summary"></strong><small>Open launch geometry, schedule, and cooperative lanes</small></summary>
          <section class="execution-microscope" aria-labelledby="execution-title">
            <header class="execution-heading">
              <div>
                <p class="kicker">Execution microscope</p>
              <h3 id="execution-title">Algorithm → kernel → instruction.</h3>
            </div>
            <p><strong>Reference plan, not a profiler trace.</strong> Every byte, FLOP, grid dimension, and timing below is derived from the current workload plus the assumptions shown.</p>
          </header>
          <div class="handoff-strip" aria-label="CPU to accelerator handoff">
            <span><i>1</i><b>CPU runtime</b><small>submits descriptor</small></span>
            <span aria-hidden="true">→</span>
            <span><i>2</i><b>GPU command processor</b><small>dispatches grid</small></span>
            <span aria-hidden="true">→</span>
            <span><i>3</i><b>SM / CU scheduler</b><small>assigns workgroups</small></span>
            <span aria-hidden="true">→</span>
            <span><i>4</i><b>lanes + matrix unit</b><small>issue cooperatively</small></span>
          </div>
          <div class="execution-grid">
            <article class="kernel-card">
              <div class="kernel-card-topline"><span id="kernel-qualifier"></span><b>modeled</b></div>
              <h4 id="kernel-name"></h4>
              <code id="kernel-id"></code>
              <dl class="kernel-ledger">
                <div><dt>Grid</dt><dd id="kernel-grid"></dd></div>
                <div><dt>Workgroup</dt><dd id="kernel-workgroup"></dd></div>
                <div><dt>First wave</dt><dd id="kernel-occupancy"></dd></div>
                <div><dt>Tile</dt><dd id="kernel-tile"></dd></div>
                <div><dt>HBM traffic</dt><dd id="kernel-hbm"></dd></div>
                <div><dt>Host traffic</dt><dd id="kernel-host"></dd></div>
              </dl>
              <div class="fused-ops"><span>Reference fusion</span><ol id="kernel-fused"></ol></div>
            </article>
            <article class="timeline-card">
              <header><div><span>One representative launch</span><strong id="kernel-duration"></strong></div><em id="trace-now">CPU submit</em></header>
              <div class="timeline-ruler"><span>0</span><span>modeled elapsed time →</span></div>
              <div id="kernel-timeline" class="kernel-timeline"></div>
              <p>Horizontal position is linear modeled time. Zero-time ordering points are drawn as ticks. Selecting a phase triggers one short explanatory lane pulse; it is not wall-clock playback.</p>
            </article>
            <article class="instruction-card">
              <div class="instruction-copy">
                <span>Cooperative instruction</span>
                <h4 id="instruction-name"></h4>
                <code id="instruction-shape"></code>
                <p id="instruction-copy"></p>
                <div class="matrix-equation"><i>A fragment</i><b>×</b><i>B fragment</i><b>+</b><i>C accumulators</i><b>→</b><i>D accumulators</i></div>
              </div>
              <div class="lane-panel">
                <header><span id="lane-title"></span><small id="lane-subtitle"></small></header>
                <div id="lane-grid" class="lane-grid" role="img" aria-label="Cooperating SIMT and SIMD hardware lanes"></div>
                <p>Each square is a hardware lane—not a whole matrix multiply. Lanes contribute fragments; the matrix unit performs the cooperative operation.</p>
              </div>
            </article>
          </div>
          <details class="kernel-assumptions"><summary>Kernel-model assumptions</summary><ul id="kernel-assumption-list"></ul></details>
          </section>
        </details>

        <p class="algorithm-footnote"><strong>Q/K/V are attention projections.</strong> Top-k and top-p are later sampling filters over vocabulary logits; they are not the K and V in attention.</p>
      </section>

      <div class="metric-strip">
        <article class="metric-primary" id="bottleneck-card">
          <span>Limiting resource</span>
          <strong id="bottleneck-value">HBM bandwidth</strong>
          <small id="bottleneck-note"></small>
        </article>
        <article><span>Modeled step</span><strong id="time-value"></strong><small id="rate-value"></small></article>
        <article><span>Traffic</span><strong id="bytes-value"></strong><small id="traffic-note"></small></article>
        <article><span>Work</span><strong id="flops-value"></strong><small id="intensity-value"></small></article>
        <article><span>HBM occupied</span><strong id="hbm-value"></strong><small id="hbm-note"></small></article>
      </div>
    </section>

    <section class="explanation" aria-labelledby="finding-title">
      <div class="finding">
        <p class="kicker">What the model says</p>
        <h2 id="finding-title"></h2>
        <p id="finding-copy"></p>
        <div class="equation" id="equation"></div>
      </div>
      <div class="roofline-panel">
        <div class="panel-heading">
          <div><p class="kicker">Roofline</p><h2>Where the workload lands</h2></div>
          <span class="status-chip" id="roof-status"></span>
        </div>
        <div id="roofline-chart"></div>
        <p class="chart-note" id="chart-note">The point moves right as useful math amortizes each byte. Crossing the ridge changes the limiting resource.</p>
      </div>
    </section>

    <section class="hierarchy" aria-labelledby="hierarchy-title">
      <div class="section-heading">
        <p class="kicker">The feeding line</p>
        <h2 id="hierarchy-title">Nearer is faster. Farther is larger.</h2>
        <p>The first scenario prices the HBM boundary. The inner levels are shown because they explain how kernels stage data, but their bandwidth is deliberately not invented where vendors do not publish it.</p>
      </div>
      <ol class="hierarchy-list">
        <li><span>01</span><strong>Tensor cores / MFMA</strong><small>The mouth · math lands here</small></li>
        <li><span>02</span><strong>Registers</strong><small>Operands · per execution unit</small></li>
        <li><span>03</span><strong>Shared / LDS</strong><small>Tiles · per SM or CU</small></li>
        <li><span>04</span><strong>L2 / Infinity Cache</strong><small>Reuse · shared on chip</small></li>
        <li><span>05</span><strong>HBM</strong><small>Weights + KV · priced in v0.1</small></li>
        <li><span>06</span><strong>Host DRAM</strong><small>Overflow · PCIe 5 ×16 priced when HBM spills</small></li>
      </ol>
    </section>

    <section class="method" id="method" aria-labelledby="method-title">
      <div class="section-heading">
        <p class="kicker">Read the fine print</p>
        <h2 id="method-title">A model, not a benchmark.</h2>
      </div>
      <div class="method-grid">
        <article>
          <span class="method-number">01</span>
          <h3>Compute the work</h3>
          <p>Dense matmuls use 2 × parameters × tokens. Attention adds the QKᵀ and softmax-V terms. These are operation counts, not elapsed time.</p>
        </article>
        <article>
          <span class="method-number">02</span>
          <h3>Count boundary traffic</h3>
          <p>Decode streams active weights once per step and reads prior KV. Prefill reads weights once for the prompt and writes the completed KV cache.</p>
        </article>
        <article>
          <span class="method-number">03</span>
          <h3>Price both ceilings</h3>
          <p>FLOPs ÷ effective throughput and bytes ÷ effective HBM bandwidth produce two lower bounds. With overlap on, the slower bound wins.</p>
        </article>
      </div>

      <details class="source-ledger">
        <summary>Sources, constants, and known omissions</summary>
        <div>
          <p><strong>Hardware.</strong> <a href="https://www.nvidia.com/en-us/data-center/h100/">NVIDIA H100 specifications</a> and <a href="https://www.amd.com/en/products/accelerators/instinct/mi300/mi300x.html">AMD MI300X specifications</a>. Sparse headline throughput is not used. A visible 55% compute / 72% HBM efficiency assumption turns theoretical peaks into analytical ceilings.</p>
          <p><strong>Model.</strong> <a href="https://huggingface.co/meta-llama/Llama-3.1-8B/blob/main/config.json">Meta Llama 3.1 8B configuration</a>: 32 layers, hidden size 4096, 32 query heads, 8 KV heads, head dimension 128.</p>
          <p><strong>Kernel semantics.</strong> <a href="https://docs.nvidia.com/cutlass/4.5.2/media/docs/pythonDSL/mma_docs/wgmma_programming.html">NVIDIA CUTLASS WGMMA guide</a>, <a href="https://docs.nvidia.com/cuda/pdf/Hopper_Tuning_Guide.pdf">Hopper tuning guide</a>, and <a href="https://rocm.docs.amd.com/en/docs-6.0.2/reference/gpu-arch/gpu-arch-spec-overview.html">AMD ROCm architecture specifications</a>. The displayed kernel is a transparent reference plan, not a claim about a library’s emitted code.</p>
          <p><strong>Not yet modeled.</strong> Collectives, quantization kernels, cache-hit rates, exact scheduler residency, power throttling, continuous batching, and network/storage tiers. Host fallback is a first-order PCIe transfer model, not a paging simulator.</p>
        </div>
      </details>
    </section>
  </main>

  <footer>
    <div class="footer-plant" aria-hidden="true"><i></i><i></i><i></i></div>
    <p><strong>SEYMOUR</strong> · Feed the machine. Read the numbers.</p>
    <p>Code Apache-2.0 · words &amp; original art CC BY 4.0</p>
  </footer>

  <div class="toast" id="toast" role="status" aria-live="polite"></div>
`;

let settings: SimulationSettings = readSettings();
if (!HARDWARE_PROFILES.some((hardware) => hardware.id === settings.hardwareId)) {
  settings.hardwareId = HARDWARE_PROFILES[0]!.id;
}
let hardware = getHardware(settings.hardwareId);
let result = calculateSimulation(settings, hardware, DEFAULT_MODEL);

const viewport = required<HTMLElement>('#viewport');
let scene: SeymourScene;
try {
  scene = new SeymourScene(viewport, settings, result, hardware);
} catch (error) {
  viewport.innerHTML = `<div class="webgl-error"><strong>The 3D view could not start.</strong><p>Your browser may have WebGL disabled. The controls and computed model remain available below.</p></div>`;
  console.error(error);
  scene = {
    update: () => undefined,
    focus: () => undefined,
    selectStage: () => undefined,
    setKernelPlan: () => undefined,
    setPaused: () => undefined,
    capture: async () => undefined,
    destroy: () => undefined,
  } as unknown as SeymourScene;
}

const phaseButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-phase]')];
const viewButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-view]')];
const hardwareSelect = required<HTMLSelectElement>('#hardware-select');
const batchRange = required<HTMLInputElement>('#batch-range');
const batchOutput = required<HTMLOutputElement>('#batch-output');
const tokensRange = required<HTMLInputElement>('#tokens-range');
const tokensOutput = required<HTMLOutputElement>('#tokens-output');
const overlapToggle = required<HTMLInputElement>('#overlap-toggle');
const operationSelect = required<HTMLSelectElement>('#operation-select');
const roofline = required<HTMLElement>('#roofline-chart');
let selectedStepId = new URLSearchParams(window.location.search).get('op') ?? 'qkv';
let algorithmSteps: AlgorithmStep[] = [];
let currentKernelPlan: KernelPlan | null = null;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let scenePulseTimer = 0;
scene.setPaused(true);

function update(writeUrl = true): void {
  hardware = getHardware(settings.hardwareId);
  result = calculateSimulation(settings, hardware, DEFAULT_MODEL);
  if (writeUrl) writeSettings(settings, selectedStepId);

  phaseButtons.forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.phase === settings.phase));
  });
  viewButtons.forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.view === settings.view));
  });
  hardwareSelect.value = hardware.id;
  required<HTMLElement>('.machine').dataset.view = settings.view;
  batchRange.value = String(batchToSlider(settings.batch));
  batchOutput.value = settings.batch.toLocaleString();
  tokensRange.value = String(sequenceToSlider(settings.sequenceLength));
  tokensOutput.value = settings.sequenceLength.toLocaleString();
  overlapToggle.checked = settings.overlap;
  setText('#workload-summary', `${hardware.name} · batch ${settings.batch} · ${settings.sequenceLength.toLocaleString()} token ${settings.phase}`);
  setText('#algorithm-title', settings.phase === 'decode' ? 'How one decode token crosses the machine.' : 'How a prompt becomes the first KV cache.');

  setText('#efficiency-summary', `${Math.round(hardware.computeEfficiency * 100)}% compute / ${Math.round(hardware.memoryEfficiency * 100)}% HBM`);
  setText(
    '#bottleneck-value',
    result.bottleneck === 'host'
      ? 'Host ↔ GPU link'
      : result.bottleneck === 'memory'
        ? 'HBM bandwidth'
        : 'Tensor compute',
  );
  setText(
    '#bottleneck-note',
    result.bottleneck === 'host'
      ? `${formatBytes(result.hostTrafficBytes)} crosses PCIe`
      : result.bottleneck === 'memory'
      ? `memory takes ${formatNumber(result.memoryMs / result.computeMs)}× longer`
      : `compute takes ${formatNumber(result.computeMs / result.memoryMs)}× longer`,
  );
  required('#bottleneck-card').dataset.bound = result.bottleneck;
  setText('#time-value', formatDuration(result.totalMs));
  setText('#rate-value', `${formatNumber(result.tokenRate)} tokens/s`);
  setText('#bytes-value', formatBytes(result.bytes));
  setText(
    '#traffic-note',
    result.hostTrafficBytes > 0
      ? `${formatBytes(result.hbmTrafficBytes)} HBM · ${formatBytes(result.hostTrafficBytes)} host`
      : `${formatBytes(result.weightBytes)} weights · ${formatBytes(result.kvBytes)} KV`,
  );
  setText('#flops-value', formatFlops(result.flops));
  setText('#intensity-value', `${formatNumber(result.arithmeticIntensity)} FLOP/byte`);
  setText('#hbm-value', result.hbmUsedFraction > 1 ? `${formatBytes(result.modelFootprintBytes - hardware.hbmCapacityGB * 1e9)} spill` : `${formatNumber(result.hbmUsedFraction * 100)}%`);
  setText('#hbm-note', result.hbmUsedFraction > 1 ? `${formatBytes(result.modelFootprintBytes)} working set · ${hardware.hbmCapacityGB} GB HBM` : `${formatBytes(result.modelFootprintBytes)} of ${hardware.hbmCapacityGB} GB`);
  setText('#roof-status', `${result.bottleneck}-bound`);
  setText(
    '#chart-note',
    result.bottleneck === 'host'
      ? 'The HBM roofline is no longer the active ceiling: spilled bytes cross PCIe, pulling attainable performance below it.'
      : 'The point moves right as useful math amortizes each byte. Crossing the ridge changes the limiting resource.',
  );
  required('#roof-status').className = `status-chip ${result.bottleneck}`;

  const crossover = result.crossoverBatch ? ` Around batch ${result.crossoverBatch}, the point crosses this GPU’s ridge.` : '';
  if (result.bottleneck === 'host') {
    setText('#finding-title', `${formatBytes(result.spilledKvBytes + result.spilledWeightBytes)} no longer fits in HBM.`);
    setText(
      '#finding-copy',
      `The overflow now crosses a ${hardware.hostLinkGBs} GB/s PCIe link instead of ${hardware.hbmBandwidthTBs} TB/s HBM. Capacity is available in host DRAM, but the feeding trip is dramatically longer.`,
    );
  } else if (settings.phase === 'decode') {
    setText(
      '#finding-title',
      result.bottleneck === 'memory'
        ? `Decode reads ${formatBytes(result.weightBytes)} to make ${settings.batch === 1 ? 'one token' : `${settings.batch} tokens`}.`
        : `This batch finally keeps the math units fed.`,
    );
    setText(
      '#finding-copy',
      result.bottleneck === 'memory'
        ? `The weights barely shrink when the batch is small, but useful work scales with every sequence. That is why batching moves decode to the right on the roofline.${crossover}`
        : `Weight traffic is now amortized across ${settings.batch} sequences. Compute has overtaken HBM as the longer lower bound.`,
    );
  } else {
    setText('#finding-title', `Prefill gives every weight ${settings.sequenceLength.toLocaleString()} tokens of work.`);
    setText(
      '#finding-copy',
      'The prompt supplies enough reuse to move far beyond the ridge point. HBM still matters, but dense matrix work now sets the analytical floor.',
    );
  }

  const memoryEquation = result.hostTrafficBytes > 0
    ? `${formatBytes(result.hbmTrafficBytes)} ÷ ${formatNumber(hardware.hbmBandwidthTBs * hardware.memoryEfficiency)} TB/s + ${formatBytes(result.hostTrafficBytes)} ÷ ${hardware.hostLinkGBs} GB/s`
    : `${formatBytes(result.bytes)} ÷ ${formatNumber(hardware.hbmBandwidthTBs * hardware.memoryEfficiency)} TB/s`;
  required('#equation').innerHTML = `
    <span><small>compute floor</small><strong>${formatFlops(result.flops)} ÷ ${formatNumber(hardware.fp16DenseTflops * hardware.computeEfficiency)} TF/s</strong><b>${formatDuration(result.computeMs)}</b></span>
    <i aria-hidden="true">${settings.overlap ? 'max' : '+'}</i>
    <span><small>memory floor</small><strong>${memoryEquation}</strong><b>${formatDuration(result.memoryMs)}</b></span>
  `;

  setText(
    '#scene-summary',
    `${settings.phase} on ${hardware.name}, batch ${settings.batch}, ${settings.sequenceLength} tokens. ${result.bottleneck} bound, modeled step ${formatDuration(result.totalMs)}.`,
  );
  renderRoofline(roofline, result, hardware);
  scene.update(settings, result, hardware);
  setText('#viewport-mode-note', settings.view === 'hardware' ? 'physical cutaway · drag to orbit' : 'feeding metaphor · drag to orbit');
  renderAlgorithm();
}

phaseButtons.forEach((button) => {
  button.addEventListener('click', () => {
    settings.phase = button.dataset.phase === 'prefill' ? 'prefill' : 'decode';
    update();
  });
});

viewButtons.forEach((button) => {
  button.addEventListener('click', () => {
    settings.view = button.dataset.view === 'hardware' ? 'hardware' : 'story';
    update();
  });
});

hardwareSelect.addEventListener('change', () => {
  settings.hardwareId = hardwareSelect.value;
  update();
});
batchRange.addEventListener('input', () => {
  settings.batch = batchFromSlider(Number(batchRange.value));
  update();
});
tokensRange.addEventListener('input', () => {
  settings.sequenceLength = sequenceFromSlider(Number(tokensRange.value));
  update();
});
overlapToggle.addEventListener('change', () => {
  settings.overlap = overlapToggle.checked;
  update();
});

required<HTMLButtonElement>('#reset-controls').addEventListener('click', () => {
  settings = { phase: 'decode', hardwareId: 'h100-sxm', batch: 1, sequenceLength: 4096, overlap: true, view: 'hardware' };
  selectedStepId = 'qkv';
  update();
  scene.focus('overview');
});

const assumptionsToggle = required<HTMLButtonElement>('#assumptions-toggle');
assumptionsToggle.addEventListener('click', () => {
  const expanded = assumptionsToggle.getAttribute('aria-expanded') === 'true';
  assumptionsToggle.setAttribute('aria-expanded', String(!expanded));
  assumptionsToggle.querySelector('span')!.textContent = expanded ? '+' : '−';
});

required<HTMLButtonElement>('#previous-operation').addEventListener('click', () => {
  moveOperation(-1, true);
});
required<HTMLButtonElement>('#next-operation').addEventListener('click', () => {
  moveOperation(1, true);
});
operationSelect.addEventListener('change', () => selectOperation(operationSelect.value, true));

required<HTMLButtonElement>('#export-image').addEventListener('click', async () => {
  await scene.capture();
  showToast('Still exported');
});
required<HTMLButtonElement>('#reset-camera').addEventListener('click', () => scene.focus('overview'));

required<HTMLButtonElement>('#share-state').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(window.location.href);
    showToast('Share link copied');
  } catch {
    showToast('The URL now holds this state');
  }
});

const tourSteps = [
  {
    kicker: 'The machine · 1 of 4',
    title: 'Start with two sides.',
    copy: 'The host computer starts the work. The accelerator package holds fast memory and the GPU chip. CPU commands cross PCIe; tensors normally remain on the accelerator.',
    focus: 'overview' as const,
    operationId: 'qkv',
    settings: { phase: 'decode' as const, batch: 1, sequenceLength: 4096 },
  },
  {
    kicker: 'Memory · 2 of 4',
    title: 'Weights begin in high-bandwidth memory.',
    copy: 'High-bandwidth memory—HBM—sits beside the GPU chip. For this projection, weights travel from HBM through on-chip cache toward one compute unit.',
    focus: 'hbm' as const,
    operationId: 'qkv',
    settings: { phase: 'decode' as const, batch: 1, sequenceLength: 4096 },
  },
  {
    kicker: 'Compute · 3 of 4',
    title: 'One worker stages data before doing math.',
    copy: 'A compute unit is called an SM on NVIDIA hardware and a CU on AMD hardware. It moves a small tile into local memory, then registers, then matrix and vector units.',
    focus: 'compute' as const,
    operationId: 'qk',
    settings: { phase: 'decode' as const, batch: 1, sequenceLength: 4096 },
  },
  {
    kicker: 'Performance · 4 of 4',
    title: 'Optimization changes which boundary costs most.',
    copy: 'A larger batch lets one weight load serve more token rows. The arithmetic stays the same operation, but useful math grows relative to bytes moved. That is the core performance-computing question Seymour exposes.',
    focus: 'compute' as const,
    operationId: 'qkv',
    settings: { phase: 'decode' as const, batch: 128, sequenceLength: 4096 },
  },
];

const tourPanel = required<HTMLElement>('#tour-panel');
let tourIndex = 0;

function showTourStep(index: number): void {
  tourIndex = index;
  const step = tourSteps[tourIndex]!;
  tourPanel.hidden = false;
  setText('#tour-number', `${tourIndex + 1} / ${tourSteps.length}`);
  setText('#tour-kicker', step.kicker);
  setText('#tour-title', step.title);
  setText('#tour-copy', step.copy);
  required<HTMLElement>('#tour-bar').style.transform = `scaleX(${(tourIndex + 1) / tourSteps.length})`;
  required<HTMLButtonElement>('#tour-next').innerHTML = tourIndex === tourSteps.length - 1 ? 'Explore <span aria-hidden="true">↗</span>' : 'Next <span aria-hidden="true">→</span>';
  selectedStepId = step.operationId;
  settings = { ...settings, ...step.settings };
  update();
  scene.focus(step.focus);
}

required<HTMLButtonElement>('#start-tour').addEventListener('click', () => {
  showTourStep(0);
  required<HTMLElement>('.canonical-map').scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
});
required<HTMLButtonElement>('#tour-exit').addEventListener('click', () => {
  tourPanel.hidden = true;
  scene.focus('overview');
});
required<HTMLButtonElement>('#tour-next').addEventListener('click', () => {
  if (tourIndex === tourSteps.length - 1) {
    tourPanel.hidden = true;
    scene.focus('overview');
    return;
  }
  showTourStep(tourIndex + 1);
});

let toastTimer = 0;
function showToast(message: string): void {
  const toast = required<HTMLElement>('#toast');
  toast.textContent = message;
  toast.classList.add('visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 2200);
}

function renderAlgorithm(): void {
  algorithmSteps = buildAlgorithmSteps(settings, DEFAULT_MODEL);
  const selected = algorithmSteps.find((step) => step.id === selectedStepId) ?? algorithmSteps[0]!;
  selectedStepId = selected.id;
  const selectedIndex = algorithmSteps.indexOf(selected);
  const rail = required<HTMLElement>('#algorithm-steps');
  const chapters = [
    { id: 'attention', label: 'Attention', range: 'steps 1–8' },
    { id: 'mlp', label: 'Feed-forward network', range: 'steps 9–10' },
    { id: 'output', label: 'Choose the next token', range: 'steps 11–12' },
  ] as const;
  rail.innerHTML = chapters.map((chapter) => {
    const steps = algorithmSteps.filter((step) => step.group === chapter.id);
    const activeIndex = steps.findIndex((step) => step.id === selected.id);
    return `<section data-active="${activeIndex >= 0}"><span>${chapter.label}</span><strong>${chapter.range}</strong><small>${activeIndex >= 0 ? `${activeIndex + 1} of ${steps.length} in this chapter` : 'not selected'}</small></section>`;
  }).join('');
  operationSelect.innerHTML = chapters.map((chapter) => `
    <optgroup label="${chapter.label}">
      ${algorithmSteps.filter((step) => step.group === chapter.id).map((step) => `<option value="${step.id}">${step.number} · ${step.name}</option>`).join('')}
    </optgroup>
  `).join('');
  operationSelect.value = selected.id;
  required<HTMLButtonElement>('#previous-operation').disabled = selectedIndex === 0;
  required<HTMLButtonElement>('#next-operation').disabled = selectedIndex === algorithmSteps.length - 1;

  setText('#algorithm-number', selected.number);
  setText('#algorithm-group', selected.group);
  setText('#algorithm-name', selected.name);
  setText('#algorithm-equation', selected.equation);
  setText('#algorithm-description', selected.description);
  setText('#algorithm-input', selected.inputShape);
  setText('#algorithm-output', selected.outputShape);
  setText('#algorithm-flops', selected.flops === 0 ? 'data movement only' : formatFlops(selected.flops));
  setText('#algorithm-weights', selected.parameterBytes === 0 ? 'none' : formatBytes(selected.parameterBytes));
  setText('#algorithm-activations', formatBytes(selected.activationBytes));
  setText('#algorithm-boundary', selected.boundaryBytes === 0 ? 'on-chip · fused' : formatBytes(selected.boundaryBytes));
  setText('#algorithm-repetition', selected.repetition);
  setText('#algorithm-location', locationName(selected.hardwareStage));
  currentKernelPlan = buildKernelPlan(selected, settings, hardware, DEFAULT_MODEL, result);
  renderKernelPlan(currentKernelPlan);
  renderTeaching(selected, currentKernelPlan);
  scene.selectStage(selected.hardwareStage);
}

function selectOperation(id: string, pulse = false): void {
  selectedStepId = id;
  writeSettings(settings, selectedStepId);
  renderAlgorithm();
  if (pulse) traceSelectedPath();
}

function moveOperation(delta: number, pulse: boolean): void {
  const index = algorithmSteps.findIndex((step) => step.id === selectedStepId);
  const target = Math.max(0, Math.min(algorithmSteps.length - 1, index + delta));
  if (target === index) return;
  selectOperation(algorithmSteps[target]!.id, pulse);
}

function renderTeaching(selected: AlgorithmStep, plan: KernelPlan): void {
  const guide = buildTeachingGuide(selected, settings, hardware, plan);
  setText('#path-step', `${selected.number} / ${algorithmSteps.length}`);
  setText('#path-title', guide.pathTitle);
  setText('#path-equation', selected.equation);
  setText('#path-summary', guide.pathSummary);
  setText('#performance-title', guide.performanceTitle);
  setText('#performance-copy', guide.performanceCopy);
  setText('#optimization-title', guide.optimizationTitle);
  setText('#kernel-summary', `${plan.kernelName} · ${plan.groups.toLocaleString()} groups · ${plan.cooperativeLanes} lanes`);

  required<HTMLElement>('#data-legend').innerHTML = guide.dataKinds.map((kind) => {
    const labels = { control: 'CPU launch command', weights: 'model weights', activations: 'working activations', kv: 'key/value cache' } as const;
    return `<span data-data-kind="${kind}"><i></i>${labels[kind]}</span>`;
  }).join('');
  const machineMap = required<HTMLElement>('#system-path');
  machineMap.dataset.hostData = String(plan.hostBytes > 0);
  setText('#host-data-note', plan.hostBytes > 0
    ? `${formatBytes(plan.hostBytes)} of tensor data also crosses PCIe because it did not fit in accelerator memory.`
    : 'Only the launch command crosses PCIe for this operation; tensor data stays on the accelerator.');
  required<HTMLElement>('#term-list').innerHTML = guide.terms.map((term) =>
    `<p><strong>${term.term}</strong><span>${term.definition}</span></p>`,
  ).join('');
  required<HTMLElement>('#optimization-list').innerHTML = guide.optimizations.map((optimization) => `
    <article>
      <header><span>${optimization.layer}</span><strong>${optimization.title}</strong></header>
      <p>${optimization.effect}</p>
      <small><b>Tradeoff</b> ${optimization.tradeoff}</small>
    </article>
  `).join('');

  const usedStages = new Set<string>(['host']);
  if (plan.hbmBytes > 0 || plan.hostBytes > 0) ['package', 'hbm', 'l2'].forEach((stage) => usedStages.add(stage));
  if (selected.flops > 0 || selected.hardwareStage === 'shared' || selected.hardwareStage === 'registers') {
    ['shared', 'registers', 'compute'].forEach((stage) => usedStages.add(stage));
  }
  document.querySelectorAll<HTMLElement>('[data-path-stage]').forEach((node) => {
    const stage = node.dataset.pathStage ?? '';
    node.dataset.used = String(usedStages.has(stage));
    node.dataset.focus = String(
      stage === selected.hardwareStage ||
      (selected.hardwareStage === 'hbm' && (stage === 'package' || stage === 'hbm')) ||
      (selected.hardwareStage === 'compute' && stage === 'compute'),
    );
  });
}

function traceSelectedPath(): void {
  const path = required<HTMLElement>('#system-path');
  path.classList.remove('is-tracing');
  void path.offsetWidth;
  path.classList.add('is-tracing');
  window.clearTimeout(scenePulseTimer);
  if (!reduceMotion) scene.setPaused(false);
  scenePulseTimer = window.setTimeout(() => {
    path.classList.remove('is-tracing');
    scene.setPaused(true);
  }, 900);
}

function renderKernelPlan(plan: KernelPlan): void {
  scene.setKernelPlan(plan);
  setText('#kernel-qualifier', plan.qualifier);
  setText('#kernel-name', plan.kernelName);
  setText('#kernel-id', plan.kernelId);
  setText('#kernel-grid', `${plan.grid[0].toLocaleString()} × ${plan.grid[1].toLocaleString()} × ${plan.grid[2]} = ${plan.groups.toLocaleString()} groups`);
  setText('#kernel-workgroup', `${plan.workgroupSize} threads · ${plan.wavesPerGroup} ${hardware.waveName}s`);
  setText('#kernel-occupancy', `${formatNumber(plan.estimatedFirstWaveOccupancy * 100)}% of ${hardware.unitCount} ${hardware.unitName}s × 2 slots`);
  setText('#kernel-tile', plan.tile);
  setText('#kernel-hbm', formatBytes(plan.hbmBytes));
  setText('#kernel-host', plan.hostBytes > 0 ? formatBytes(plan.hostBytes) : '0 B · resident');
  setText('#kernel-duration', formatDuration(plan.totalMs));
  setText('#instruction-name', plan.instruction);
  setText('#instruction-shape', plan.instructionShape);
  setText(
    '#instruction-copy',
    plan.cooperativeLanes > hardware.waveSize
      ? `${plan.cooperativeLanes} lanes (${plan.cooperativeLanes / hardware.waveSize} ${hardware.waveName}s) issue one matrix operation together. The result fragments remain in registers before the epilogue store.`
      : `${plan.cooperativeLanes} lanes in one ${hardware.waveName} execute together. Reductions exchange partials; matrix instructions consume lane-distributed fragments.`,
  );
  setText('#lane-title', `${plan.cooperativeLanes} cooperating SIMT / SIMD lanes`);
  setText('#lane-subtitle', `${hardware.architecture} · ${hardware.waveSize}-lane ${hardware.waveName}`);

  required<HTMLElement>('#kernel-fused').innerHTML = plan.fusedOperations.map((operation) => `<li>${operation}</li>`).join('');
  required<HTMLElement>('#kernel-assumption-list').innerHTML = plan.assumptions.map((assumption) => `<li>${assumption}</li>`).join('');
  required<HTMLElement>('#lane-grid').innerHTML = Array.from({ length: plan.cooperativeLanes }, (_, index) =>
    `<i aria-hidden="true" style="--lane:${index}" data-lane="${index}" title="lane ${index}"><span>${index}</span></i>`,
  ).join('');

  const tracks: Array<{ id: KernelPhase['track']; label: string }> = [
    { id: 'runtime', label: 'runtime' },
    { id: 'memory', label: 'memory' },
    { id: 'execution', label: 'SM / CU' },
  ];
  const timeline = required<HTMLElement>('#kernel-timeline');
  timeline.innerHTML = tracks.map((track) => {
    const bars = plan.phases.filter((candidate) => candidate.track === track.id).map((candidate) => {
      const left = (candidate.startMs / plan.totalMs) * 100;
      const width = (candidate.durationMs / plan.totalMs) * 100;
      const zero = candidate.durationMs === 0;
      return `<button type="button" class="timeline-phase ${zero ? 'is-tick' : ''}" data-kernel-phase="${candidate.id}" data-kind="${candidate.kind}" style="--left:${left}%;--width:${width}%" title="${candidate.detail}"><span>${candidate.label}</span><small>${zero ? 'ordering point' : formatDuration(candidate.durationMs)}</small></button>`;
    }).join('');
    return `<div class="timeline-track"><b>${track.label}</b><div>${bars}</div></div>`;
  }).join('');
  timeline.querySelectorAll<HTMLButtonElement>('[data-kernel-phase]').forEach((button) => {
    button.addEventListener('click', () => {
      const phase = plan.phases.find((candidate) => candidate.id === button.dataset.kernelPhase);
      if (!phase) return;
      activateKernelPhase(phase);
      scene.focus(focusForStage(phase.location));
    });
  });
  document.querySelectorAll<HTMLElement>('[data-kernel-phase]').forEach((element) => { element.dataset.active = 'false'; });
  required<HTMLElement>('#lane-grid').dataset.phase = 'idle';
  setText('#trace-now', 'Select a phase to inspect');
}

function activateKernelPhase(phase: KernelPhase): void {
  document.querySelectorAll<HTMLElement>('[data-kernel-phase]').forEach((element) => {
    element.dataset.active = String(element.dataset.kernelPhase === phase.id);
  });
  const laneGrid = required<HTMLElement>('#lane-grid');
  laneGrid.dataset.phase = phase.kind;
  const traceLocations: Record<HardwareStage, string> = {
    host: 'host / command path', hbm: 'HBM boundary', l2: 'shared L2',
    shared: hardware.vendor === 'AMD' ? 'CU · LDS' : 'SM · shared',
    registers: 'register file', compute: `${hardware.unitName} matrix/vector unit`,
  };
  setText('#trace-now', `${phase.label} · ${traceLocations[phase.location]}`);
  scene.selectStage(phase.location);
}

function focusForStage(stage: HardwareStage): 'hbm' | 'compute' | 'pipeline' | 'host' {
  if (stage === 'host') return 'host';
  if (stage === 'hbm') return 'hbm';
  if (stage === 'compute') return 'compute';
  return 'pipeline';
}

function locationName(stage: HardwareStage): string {
  const names: Record<HardwareStage, string> = {
    host: 'system memory in the host computer, reached across PCIe',
    hbm: 'high-bandwidth memory beside the GPU chip',
    l2: 'shared on-chip L2 cache',
    shared: 'local scratchpad inside one compute unit',
    registers: 'per-lane registers inside one compute unit',
    compute: 'matrix and vector arithmetic units',
  };
  return names[stage];
}

function required<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

function setText(selector: string, text: string): void {
  required(selector).textContent = text;
}

update(false);
