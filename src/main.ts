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
import { applySoftwareStrategy, precisionLabel } from './model/strategy';
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
        <button class="text-button" id="start-tour" type="button">Open the experiment bench <span aria-hidden="true">→</span></button>
      </div>
    </section>

    <section class="machine" aria-label="Interactive inference execution map">
      <div class="machine-topbar">
        <div class="scenario-label">
          <span>Scenario</span>
          <strong>Autoregressive decode</strong>
          <small>one new token per sequence</small>
        </div>
        <div class="machine-tools">
          <button type="button" class="icon-button" id="share-state"><span aria-hidden="true">↗</span> Share</button>
        </div>
      </div>

      <section class="execution-lesson" aria-labelledby="algorithm-title">
        <header class="lesson-heading">
          <div>
            <p class="kicker">Run one generated token</p>
            <h2 id="algorithm-title">How a decode token crosses the machine.</h2>
          </div>
          <p>Set the workload, press <strong>Play</strong>, and watch one token pass through all twelve transformer operations. Pause at any point or step one operation at a time. Each operation dispatches a GPU <strong>kernel</strong>—similar to a compute shader.</p>
        </header>

        <div class="experiment-bench">
        <section class="workload-panel" aria-labelledby="workload-controls-title">
          <header>
            <div><span>Shape the run</span><strong id="workload-summary"></strong></div>
            <p id="workload-warning" hidden>Working set spills to system memory</p>
            <button type="button" id="reset-controls" class="reset-button">Reset</button>
          </header>
          <form class="controls" id="controls">
            <h3 class="sr-only" id="workload-controls-title">Change workload, software strategy, and deployment target</h3>
            <fieldset class="control-group workload-group">
              <legend><b>1</b><span><strong>Workload</strong><small>What arrives</small></span></legend>
              <div class="control-group-body">
                <label class="field range-field"><span>Concurrent sequences <output id="batch-output">1</output></span><input id="batch-range" type="range" min="0" max="10" step="1" value="0" /><span class="range-ends"><small>1</small><small>1,024 active</small></span></label>
                <label class="field range-field"><span id="tokens-label">Context per sequence <output id="tokens-output">4,096</output></span><input id="tokens-range" type="range" min="0" max="8" step="1" value="5" /><span class="range-ends"><small>128</small><small>32K tokens</small></span></label>
              </div>
              <p class="control-explainer" id="workload-boundary-note"></p>
            </fieldset>

            <fieldset class="control-group strategy-group">
              <legend><b>2</b><span><strong>Software strategy</strong><small>What your stack changes</small></span></legend>
              <div class="model-stamp"><span>Model</span><strong id="model-name">${DEFAULT_MODEL.name}</strong><small id="model-note">${DEFAULT_MODEL.parametersB}B parameters · GQA ${DEFAULT_MODEL.attentionHeads}:${DEFAULT_MODEL.kvHeads}</small></div>
              <div class="control-group-body strategy-grid">
                <label class="field"><span>Weight storage</span><select id="weight-select"><option value="16">FP16 · 2 bytes</option><option value="8">8-bit · 1 byte</option><option value="4">4-bit · 0.5 byte</option></select><small>Changes model bytes, not the peak-compute claim</small></label>
                <label class="field"><span>KV cache storage</span><select id="kv-select"><option value="16">FP16 · 2 bytes</option><option value="8">8-bit · 1 byte</option></select><small>Changes cache capacity and traffic</small></label>
                <label class="field"><span>Attention schedule</span><select id="attention-select"><option value="fused">Fused · scores stay on chip</option><option value="separate">Separate · scores cross HBM</option></select><small>Changes the QK → softmax → PV boundary</small></label>
                <label class="toggle-field"><span><strong>Overlap compute + memory</strong><small>Runtime pipelines both floors</small></span><input id="overlap-toggle" type="checkbox" checked /><i aria-hidden="true"></i></label>
              </div>
              <p class="control-explainer" id="strategy-impact"></p>
            </fieldset>

            <fieldset class="control-group deployment-group">
              <legend><b>3</b><span><strong>Deployment target</strong><small>Fixed silicon to compare</small></span></legend>
              <div class="control-group-body">
                <label class="field"><span>Accelerator profile</span><select id="hardware-select">${HARDWARE_PROFILES.map((profile) => `<option value="${profile.id}">${profile.vendor} · ${profile.name}</option>`).join('')}</select></label>
                <div class="hardware-context"><span>Published hardware facts</span><strong id="hardware-context-note"></strong><small id="hardware-context-ceilings"></small></div>
              </div>
              <p class="control-explainer">Choosing a GPU changes the comparison target. Software can select this target; it cannot resize its HBM, SM/CU count, or physical bandwidth.</p>
            </fieldset>

            <div class="assumptions"><button type="button" id="assumptions-toggle" aria-expanded="false" aria-controls="assumptions-body">Model assumptions <span aria-hidden="true">+</span></button><div id="assumptions-body" class="assumptions-body"><p>Weight and KV formats change byte counts only; Seymour keeps the published dense FP16 compute ceiling rather than inventing quantized-kernel speedups. Separate attention materializes the score/probability matrix across HBM four times per layer; fused attention keeps it on chip. Published peak × <strong id="efficiency-summary"></strong>. Host spill uses the published PCIe link ceiling. The kernel microscope exposes a 5 µs launch assumption.</p></div></div>
          </form>
        </section>

          <section class="canonical-map" aria-labelledby="machine-map-title">
            <section class="sequence-player" aria-labelledby="sequence-player-title">
              <div class="sequence-player-status">
                <span>One token · complete path</span>
                <strong id="sequence-player-title">Operation <b id="sequence-index">01 / 12</b></strong>
                <small id="sequence-state" aria-live="polite">Paused · adjust the run, then press Play.</small>
              </div>
              <div class="sequence-controls" role="group" aria-label="Token path playback">
                <button id="reset-sequence" type="button" title="Return to the first operation"><span aria-hidden="true">↺</span> Start</button>
                <button id="previous-operation" type="button"><span aria-hidden="true">←</span> Step</button>
                <button id="play-sequence" type="button" aria-pressed="false"><span id="play-icon" aria-hidden="true">▶</span><strong id="play-label">Play path</strong></button>
                <button id="next-operation" type="button">Step <span aria-hidden="true">→</span></button>
              </div>
              <label class="operation-picker"><span>Jump to operation</span><select id="operation-select" aria-label="Choose transformer operation"></select></label>
              <div class="algorithm-steps" id="algorithm-steps" aria-label="Twelve operations in one generated token"></div>
            </section>

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

            <div class="machine-map" id="system-path" aria-label="Conceptual map of the host computer and accelerator. Highlighted regions show the selected operation's path.">
              <section class="map-host path-node" data-path-stage="host">
                <b class="map-bottleneck">Current bottleneck</b>
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
                    <b class="map-bottleneck">Current bottleneck</b>
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
                      <div class="worker-array" id="worker-array" aria-label="Modeled compute-unit activity for the selected kernel">
                        <div class="worker-array-copy"><span>Kernel dispatch</span><strong id="unit-utilization"></strong><small id="unit-utilization-note"></small></div>
                        <div class="worker-array-grid" id="worker-array-grid" aria-hidden="true">${Array.from({ length: 24 }, () => '<i></i>').join('')}</div>
                      </div>
                      <section class="map-worker">
                        <header><span>One worker, enlarged</span><strong>Compute unit</strong><small>NVIDIA calls it an SM. AMD calls it a CU.</small></header>
                        <div class="worker-pipeline">
                          <section class="path-node" data-path-stage="shared"><em>3</em><span>Nearby scratchpad</span><strong>Local memory</strong><small>Shared memory on NVIDIA · Local Data Share (LDS) on AMD</small></section>
                          <section class="path-node" data-path-stage="registers"><em>4</em><span>Per-lane working values</span><strong>Registers</strong><small>Hold fragments immediately before and after math</small></section>
                          <section class="path-node" data-path-stage="compute"><b class="map-bottleneck">Current bottleneck</b><em>5</em><span>Arithmetic hardware</span><strong>Matrix + vector units</strong><small>Execute multiply-accumulate and vector instructions</small></section>
                        </div>
                      </section>
                    </div>
                  </section>
                </div>
              </section>
            </div>

            <p class="route-disclaimer"><strong>How to read this:</strong> numbered highlights show tensor data moving closer to the math units. The separate PCIe arrow is the CPU command path. These are diagram marks, not literal pipes.</p>
          </section>
        </div>

        <div class="lesson-workspace">
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
                <div><dt>Unit coverage</dt><dd id="kernel-occupancy"></dd></div>
                <div><dt>Tile</dt><dd id="kernel-tile"></dd></div>
                <div><dt>HBM traffic</dt><dd id="kernel-hbm"></dd></div>
                <div><dt>Host traffic</dt><dd id="kernel-host"></dd></div>
              </dl>
              <div class="fused-ops"><span>Kernel stages</span><ol id="kernel-fused"></ol></div>
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
          <p>Decode streams active weights once per step and reads prior KV. If the working set exceeds HBM, the overflow is priced separately across the host link.</p>
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
          <p><strong>Not yet modeled.</strong> Collectives, format-specific quantized compute throughput, cache-hit rates, exact scheduler residency, power throttling, continuous batching, and network/storage tiers. Host fallback is a first-order PCIe transfer model, not a paging simulator.</p>
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
settings.phase = 'decode';
if (!HARDWARE_PROFILES.some((hardware) => hardware.id === settings.hardwareId)) {
  settings.hardwareId = HARDWARE_PROFILES[0]!.id;
}
let hardware = getHardware(settings.hardwareId);
let model = applySoftwareStrategy(DEFAULT_MODEL, settings);
let result = calculateSimulation(settings, hardware, model);

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

const viewButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-view]')];
const hardwareSelect = required<HTMLSelectElement>('#hardware-select');
const batchRange = required<HTMLInputElement>('#batch-range');
const batchOutput = required<HTMLOutputElement>('#batch-output');
const tokensRange = required<HTMLInputElement>('#tokens-range');
const tokensOutput = required<HTMLOutputElement>('#tokens-output');
const weightSelect = required<HTMLSelectElement>('#weight-select');
const kvSelect = required<HTMLSelectElement>('#kv-select');
const attentionSelect = required<HTMLSelectElement>('#attention-select');
const overlapToggle = required<HTMLInputElement>('#overlap-toggle');
const operationSelect = required<HTMLSelectElement>('#operation-select');
const playSequenceButton = required<HTMLButtonElement>('#play-sequence');
const resetSequenceButton = required<HTMLButtonElement>('#reset-sequence');
const roofline = required<HTMLElement>('#roofline-chart');
let selectedStepId = new URLSearchParams(window.location.search).get('op') ?? 'rms-attn';
let algorithmSteps: AlgorithmStep[] = [];
let currentKernelPlan: KernelPlan | null = null;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let scenePulseTimer = 0;
let sequenceTimer = 0;
let isSequencePlaying = false;
let sequenceIdleMessage = 'Paused · adjust the run, then press Play.';
scene.setPaused(true);

function update(writeUrl = true): void {
  hardware = getHardware(settings.hardwareId);
  model = applySoftwareStrategy(DEFAULT_MODEL, settings);
  result = calculateSimulation(settings, hardware, model);
  if (writeUrl) writeSettings(settings, selectedStepId);

  viewButtons.forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.view === settings.view));
  });
  hardwareSelect.value = hardware.id;
  required<HTMLElement>('.machine').dataset.view = settings.view;
  batchRange.value = String(batchToSlider(settings.batch));
  batchOutput.value = settings.batch.toLocaleString();
  tokensRange.value = String(sequenceToSlider(settings.sequenceLength));
  tokensOutput.value = settings.sequenceLength.toLocaleString();
  weightSelect.value = String(settings.weightBits);
  kvSelect.value = String(settings.kvBits);
  attentionSelect.value = settings.attentionKernel;
  overlapToggle.checked = settings.overlap;
  setText('#workload-summary', `${settings.batch} active · ${settings.sequenceLength.toLocaleString()} tokens · W${settings.weightBits}/KV${settings.kvBits} · ${hardware.name}`);
  setText('#model-name', model.name);
  setText('#model-note', `${model.parametersB}B parameters · GQA ${model.attentionHeads}:${model.kvHeads}`);
  setText('#strategy-impact', `${precisionLabel(settings.weightBits)} weights occupy ${formatBytes(result.weightBytes)}. ${precisionLabel(settings.kvBits)} KV uses ${formatBytes(result.kvBytesPerToken)} per token. ${settings.attentionKernel === 'fused' ? 'Fused attention keeps scores on chip.' : 'Separate attention writes and rereads scores through HBM.'}`);
  setText('#hardware-context-note', `${hardware.unitCount} ${hardware.unitName}s · ${hardware.hbmCapacityGB} GB HBM · ${hardware.hbmBandwidthTBs} TB/s`);
  setText('#hardware-context-ceilings', `${formatNumber(hardware.fp16DenseTflops)} dense FP16 TFLOP/s · ${hardware.architecture}`);
  setText(
    '#workload-boundary-note',
    result.bottleneck === 'host'
      ? `Host-bound: ${formatBytes(result.hostTrafficBytes)} crosses PCIe because the ${formatBytes(result.modelFootprintBytes)} working set exceeds ${hardware.hbmCapacityGB} GB of HBM.`
      : result.bottleneck === 'compute'
        ? `Compute-bound: arithmetic now takes ${formatNumber(result.computeMs / Math.max(result.memoryMs, Number.EPSILON))}× longer than memory traffic.`
        : result.crossoverBatch
          ? `HBM-bound here. Around batch ${result.crossoverBatch}, weight reuse reaches this GPU’s ${formatNumber(result.ridgePoint)} FLOP/byte ridge.`
          : `HBM-bound even with perfect weight reuse: this context tops out near ${formatNumber(result.batchLimitArithmeticIntensity)} FLOP/byte, below this GPU’s ${formatNumber(result.ridgePoint)} FLOP/byte ridge. Shorter context or smaller KV storage changes that limit.`,
  );
  setText('#algorithm-title', 'How one decode token crosses the machine.');
  const workloadPanel = required<HTMLElement>('.workload-panel');
  const spillsToHost = result.hostTrafficBytes > 0;
  workloadPanel.dataset.spill = String(spillsToHost);
  required<HTMLElement>('#workload-warning').hidden = !spillsToHost;
  required<HTMLElement>('#system-path').dataset.bottleneck = result.bottleneck;

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
      : result.attentionMaterializationBytes > 0
        ? `${formatBytes(result.attentionMaterializationBytes)} score traffic from separate attention`
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

  const crossover = result.crossoverBatch
    ? ` Around batch ${result.crossoverBatch}, the point crosses this GPU’s ridge.`
    : ` At this context, per-sequence KV traffic caps the batch limit near ${formatNumber(result.batchLimitArithmeticIntensity)} FLOP/byte—below the ${formatNumber(result.ridgePoint)} FLOP/byte ridge.`;
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

viewButtons.forEach((button) => {
  button.addEventListener('click', () => {
    settings.view = button.dataset.view === 'hardware' ? 'hardware' : 'story';
    update();
  });
});

hardwareSelect.addEventListener('change', () => {
  pauseSequence('Settings changed · press Play to run this configuration.');
  settings.hardwareId = hardwareSelect.value;
  update();
});
batchRange.addEventListener('input', () => {
  pauseSequence('Settings changed · press Play to run this configuration.');
  settings.batch = batchFromSlider(Number(batchRange.value));
  update();
});
tokensRange.addEventListener('input', () => {
  pauseSequence('Settings changed · press Play to run this configuration.');
  settings.sequenceLength = sequenceFromSlider(Number(tokensRange.value));
  update();
});
weightSelect.addEventListener('change', () => {
  pauseSequence('Settings changed · press Play to run this configuration.');
  settings.weightBits = Number(weightSelect.value) as SimulationSettings['weightBits'];
  update();
});
kvSelect.addEventListener('change', () => {
  pauseSequence('Settings changed · press Play to run this configuration.');
  settings.kvBits = Number(kvSelect.value) as SimulationSettings['kvBits'];
  update();
});
attentionSelect.addEventListener('change', () => {
  pauseSequence('Settings changed · press Play to run this configuration.');
  settings.attentionKernel = attentionSelect.value as SimulationSettings['attentionKernel'];
  update();
});
overlapToggle.addEventListener('change', () => {
  pauseSequence('Settings changed · press Play to run this configuration.');
  settings.overlap = overlapToggle.checked;
  update();
});

required<HTMLButtonElement>('#reset-controls').addEventListener('click', () => {
  pauseSequence('Defaults restored · ready to play from operation 1.');
  settings = { phase: 'decode', hardwareId: 'h100-sxm', batch: 1, sequenceLength: 4096, weightBits: 16, kvBits: 16, attentionKernel: 'fused', overlap: true, view: 'hardware' };
  selectedStepId = 'rms-attn';
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
  pauseSequence('Paused · stepped back one operation.');
  moveOperation(-1, true);
});
required<HTMLButtonElement>('#next-operation').addEventListener('click', () => {
  pauseSequence('Paused · stepped forward one operation.');
  moveOperation(1, true);
});
operationSelect.addEventListener('change', () => {
  pauseSequence('Paused · jumped to the selected operation.');
  selectOperation(operationSelect.value, true);
});
resetSequenceButton.addEventListener('click', () => {
  pauseSequence('At the start · press Play or Step forward.');
  selectOperation(algorithmSteps[0]?.id ?? 'rms-attn', true);
});
playSequenceButton.addEventListener('click', () => {
  if (isSequencePlaying) pauseSequence('Paused · use Step or resume Play.');
  else playSequence();
});

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

required<HTMLButtonElement>('#start-tour').addEventListener('click', () => {
  pauseSequence('Ready · adjust the run, then press Play.');
  selectOperation(algorithmSteps[0]?.id ?? 'rms-attn');
  required<HTMLElement>('.workload-panel').scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
  scene.focus('overview');
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
  algorithmSteps = buildAlgorithmSteps(settings, model);
  const selected = algorithmSteps.find((step) => step.id === selectedStepId) ?? algorithmSteps[0]!;
  selectedStepId = selected.id;
  const selectedIndex = algorithmSteps.indexOf(selected);
  const rail = required<HTMLElement>('#algorithm-steps');
  const chapters = [
    { id: 'attention', label: 'Attention', range: 'steps 1–8' },
    { id: 'mlp', label: 'Feed-forward network', range: 'steps 9–10' },
    { id: 'output', label: 'Choose the next token', range: 'steps 11–12' },
  ] as const;
  rail.innerHTML = algorithmSteps.map((step, index) => `
    <button type="button" data-operation-id="${step.id}" data-group="${step.group}" data-status="${index < selectedIndex ? 'complete' : index === selectedIndex ? 'current' : 'upcoming'}" aria-pressed="${index === selectedIndex}" aria-label="Operation ${index + 1} of ${algorithmSteps.length}: ${step.name}">
      <span>${step.number}</span><strong>${step.label}</strong>
    </button>
  `).join('');
  rail.querySelectorAll<HTMLButtonElement>('[data-operation-id]').forEach((button) => {
    button.addEventListener('click', () => {
      pauseSequence('Paused · jumped to the selected operation.');
      selectOperation(button.dataset.operationId ?? selectedStepId, true);
    });
  });
  operationSelect.innerHTML = chapters.map((chapter) => `
    <optgroup label="${chapter.label}">
      ${algorithmSteps.filter((step) => step.group === chapter.id).map((step) => `<option value="${step.id}">${step.number} · ${step.name}</option>`).join('')}
    </optgroup>
  `).join('');
  operationSelect.value = selected.id;
  required<HTMLButtonElement>('#previous-operation').disabled = selectedIndex === 0;
  required<HTMLButtonElement>('#next-operation').disabled = selectedIndex === algorithmSteps.length - 1;
  resetSequenceButton.disabled = selectedIndex === 0 && !isSequencePlaying;
  syncSequencePlayer(selected, selectedIndex);

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
  currentKernelPlan = buildKernelPlan(selected, settings, hardware, model, result);
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

function playSequence(): void {
  if (algorithmSteps.length === 0) return;
  let index = algorithmSteps.findIndex((step) => step.id === selectedStepId);
  if (index === algorithmSteps.length - 1) {
    index = 0;
    selectOperation(algorithmSteps[0]!.id);
  }
  isSequencePlaying = true;
  sequenceIdleMessage = '';
  syncSequencePlayer(algorithmSteps[index]!, index);
  traceSelectedPath();
  scheduleSequenceAdvance();
}

function scheduleSequenceAdvance(): void {
  window.clearTimeout(sequenceTimer);
  sequenceTimer = window.setTimeout(() => {
    const index = algorithmSteps.findIndex((step) => step.id === selectedStepId);
    if (!isSequencePlaying || index < 0) return;
    if (index === algorithmSteps.length - 1) {
      pauseSequence('Complete · one generated token crossed all 12 operations.');
      return;
    }
    selectOperation(algorithmSteps[index + 1]!.id, true);
    scheduleSequenceAdvance();
  }, reduceMotion ? 2100 : 1650);
}

function pauseSequence(message = 'Paused · use Step or resume Play.'): void {
  window.clearTimeout(sequenceTimer);
  isSequencePlaying = false;
  sequenceIdleMessage = message;
  scene.setPaused(true);
  const index = algorithmSteps.findIndex((step) => step.id === selectedStepId);
  if (index >= 0) syncSequencePlayer(algorithmSteps[index]!, index);
}

function syncSequencePlayer(selected: AlgorithmStep, index: number): void {
  setText('#sequence-index', `${selected.number} / ${algorithmSteps.length}`);
  setText(
    '#sequence-state',
    isSequencePlaying
      ? `Playing · ${selected.name}`
      : sequenceIdleMessage,
  );
  playSequenceButton.setAttribute('aria-pressed', String(isSequencePlaying));
  setText('#play-icon', isSequencePlaying ? 'Ⅱ' : '▶');
  setText('#play-label', isSequencePlaying ? 'Pause' : index === algorithmSteps.length - 1 ? 'Replay path' : 'Play path');
  required<HTMLElement>('.sequence-player').dataset.playing = String(isSequencePlaying);
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

  const activeUnitCount = Math.min(hardware.unitCount, plan.groups);
  const idleUnitCount = Math.max(0, hardware.unitCount - activeUnitCount);
  const activePercent = plan.estimatedActiveUnitFraction * 100;
  setText('#unit-utilization', `${activeUnitCount} / ${hardware.unitCount} ${hardware.unitName}s active`);
  setText('#unit-utilization-note', `${formatNumber(activePercent)}% first-wave coverage · ${idleUnitCount} idle · modeled, not profiler telemetry`);
  const workerArray = required<HTMLElement>('#worker-array');
  workerArray.setAttribute('aria-label', `${activeUnitCount} of ${hardware.unitCount} ${hardware.unitName}s receive work in the first modeled scheduling wave; ${idleUnitCount} are idle.`);
  const unitCells = [...required<HTMLElement>('#worker-array-grid').querySelectorAll<HTMLElement>('i')];
  const activeCells = Math.max(1, Math.round(plan.estimatedActiveUnitFraction * unitCells.length));
  unitCells.forEach((cell, index) => {
    cell.dataset.active = String(index < activeCells);
    cell.classList.toggle('is-enlarged', index === activeCells - 1);
  });
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
  setText('#kernel-occupancy', `${Math.min(hardware.unitCount, plan.groups)} of ${hardware.unitCount} ${hardware.unitName}s active · ${formatNumber(plan.estimatedFirstWaveOccupancy * 100)}% of 2 assumed resident slots`);
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
