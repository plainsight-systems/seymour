import '@fontsource-variable/anybody';
import '@fontsource-variable/public-sans';
import './style.css';
import { DEFAULT_MODEL, HARDWARE_PROFILES, getHardware } from './data/profiles';
import {
  calculateSimulation,
  decodeIterationCounts,
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
  outputLengthFromSlider,
  outputLengthToSlider,
  prefixCacheFromSlider,
  prefixCacheToSlider,
  readSettings,
  sequenceFromSlider,
  sequenceToSlider,
  writeSettings,
} from './state';
import type { AlgorithmStep, HardwareStage, KernelPhase, KernelPlan, LifecycleStage, LifecycleStageId, SimulationSettings } from './types';
import { renderRoofline } from './ui/roofline';
import { SeymourScene } from './visualization/SeymourScene';

const app = document.querySelector<HTMLDivElement>('#route-root');
if (!app) throw new Error('Missing #route-root');

app.innerHTML = `
  <div class="underhood-page">
    <section class="intro" aria-labelledby="page-title">
      <div>
        <p class="kicker">A visual introduction to inference hardware</p>
        <h1 id="page-title">The math is hungry. <em>Bring bytes.</em></h1>
      </div>
      <div class="intro-copy">
        <p>Follow one complete inference request from prompt arrival and prefix reuse through prefill, decode, streaming, and cache release.</p>
        <button class="text-button" id="start-tour" type="button">Open the experiment bench <span aria-hidden="true">→</span></button>
      </div>
    </section>

    <section class="machine" aria-label="Interactive inference execution map">
      <div class="machine-topbar">
        <div class="scenario-label">
          <span>Scenario</span>
          <strong>One inference request</strong>
          <small>prompt arrival → prefix reuse → prefill → generated response</small>
        </div>
        <div class="machine-tools">
          <button type="button" class="configuration-trigger" id="open-controls" aria-expanded="false" aria-controls="control-drawer"><span>Configure run</span><strong id="compact-workload-summary"></strong></button>
          <button type="button" class="icon-button" id="share-state"><span aria-hidden="true">↗</span> Share</button>
        </div>
      </div>

      <section class="execution-lesson" aria-labelledby="algorithm-title">
        <header class="lesson-heading">
          <div>
            <p class="kicker">Run one complete request</p>
            <h2 id="algorithm-title">How an inference request crosses the machine.</h2>
          </div>
          <p>Follow prompt ingestion, prefix-cache reuse, prefill, first-token latency, the repeated decode loop, streaming, and cache release. Open <strong>Configure run</strong> when you want to change the workload without permanently shrinking the machine map.</p>
        </header>

        <section class="optimization-compass" aria-labelledby="optimization-compass-title">
          <header><span>How to interrogate an optimization claim</span><strong id="optimization-compass-title">What cost changes—and what cost replaces it?</strong></header>
          <ol>
            <li><b>1 · Work</b><span>Which FLOPs, tokens, or model operations disappear?</span></li>
            <li><b>2 · Traffic</b><span>Which bytes stop crossing HBM or an interconnect?</span></li>
            <li><b>3 · Placement</b><span>Where must state reside when the next kernel needs it?</span></li>
            <li><b>4 · Execution</b><span>Does the schedule expose enough parallel work without adding delay?</span></li>
          </ol>
          <p>Names such as paged attention, continuous batching, quantization, and kernel fusion are implementations. These four questions are the transferable model.</p>
        </section>

        <div class="experiment-bench">
        <aside class="workload-panel control-drawer" id="control-drawer" data-open="false" aria-labelledby="workload-controls-title" aria-hidden="true" inert>
          <header>
            <div><span>Change the pressure</span><strong id="workload-summary"></strong></div>
            <p id="workload-warning" hidden>Working set spills to system memory</p>
            <div class="drawer-actions"><button type="button" id="reset-controls" class="reset-button">Reset</button><button type="button" id="close-controls" class="drawer-close" aria-label="Close run controls">×</button></div>
          </header>
          <form class="controls" id="controls">
            <h3 class="sr-only" id="workload-controls-title">Change workload, scheduling, memory residency, representations, kernels, and deployment target</h3>
            <fieldset class="control-group workload-group">
              <legend><b>1</b><span><strong>Workload</strong><small>What arrives</small></span></legend>
              <div class="control-group-body">
                <label class="field range-field"><span id="tokens-label">Prompt tokens <output id="tokens-output">4,096</output></span><input id="tokens-range" type="range" min="0" max="8" step="1" value="5" /><span class="range-ends"><small>128</small><small>32K tokens</small></span></label>
                <label class="field range-field"><span>Reusable prefix <output id="prefix-cache-output">0%</output></span><input id="prefix-cache-range" type="range" min="0" max="5" step="1" value="0" /><span class="range-ends"><small>miss</small><small>full hit</small></span></label>
                <label class="field range-field"><span>Requested output <output id="output-length-output">32</output></span><input id="output-length-range" type="range" min="0" max="4" step="1" value="2" /><span class="range-ends"><small>1 token</small><small>512 tokens</small></span></label>
              </div>
              <p class="control-explainer" id="workload-boundary-note"></p>
            </fieldset>

            <fieldset class="control-group runtime-group">
              <legend><b>2</b><span><strong>Scheduling + residency</strong><small>Which work is admitted and kept hot</small></span></legend>
              <div class="control-group-body">
                <label class="field range-field"><span>Sequences admitted together <output id="batch-output">1</output></span><input id="batch-range" type="range" min="0" max="10" step="1" value="0" /><span class="range-ends"><small>1</small><small>1,024</small></span><small>More sequences reuse weights, consume more KV space, and expose more parallel work.</small></label>
                <div class="runtime-grid">
                  <label class="field"><span>Prompt tokens per step</span><select id="max-batched-tokens-select"><option value="512">512 tokens</option><option value="1024">1,024 tokens</option><option value="2048">2,048 tokens</option><option value="4096">4,096 tokens</option><option value="8192">8,192 tokens</option><option value="16384">16,384 tokens</option></select><small>Caps how much prompt work enters one scheduling iteration.</small></label>
                  <label class="field"><span>Serving memory share</span><select id="gpu-memory-utilization-select"><option value="0.7">70% of HBM</option><option value="0.8">80% of HBM</option><option value="0.9">90% of HBM</option><option value="0.95">95% of HBM</option></select><small>Leaves the remainder for runtime overhead and safety margin.</small></label>
                  <label class="toggle-field"><span><strong>Reuse shared prompts</strong><small>Retain eligible prompt state across requests</small></span><input id="prefix-caching-toggle" type="checkbox" checked /><i aria-hidden="true"></i></label>
                  <label class="toggle-field"><span><strong>Split long prompts</strong><small>Interleave prompt chunks with other ready work</small></span><input id="chunked-prefill-toggle" type="checkbox" checked /><i aria-hidden="true"></i></label>
                </div>
              </div>
              <p class="control-explainer" id="runtime-impact"></p>
            </fieldset>

            <fieldset class="control-group strategy-group">
              <legend><b>3</b><span><strong>Representation + kernels</strong><small>How many bytes cross each boundary</small></span></legend>
              <div class="model-stamp"><span>Model</span><strong id="model-name">${DEFAULT_MODEL.name}</strong><small id="model-note">${DEFAULT_MODEL.parametersB}B parameters · GQA ${DEFAULT_MODEL.attentionHeads}:${DEFAULT_MODEL.kvHeads}</small></div>
              <div class="control-group-body strategy-grid">
                <label class="field"><span>Weight representation</span><select id="weight-select"><option value="16">FP16 · 2 bytes</option><option value="8">8-bit · 1 byte</option><option value="4">4-bit · 0.5 byte</option></select><small>Fewer bytes per parameter; accuracy and kernel support become tradeoffs.</small></label>
                <label class="field"><span>KV representation</span><select id="kv-select"><option value="16">FP16 · 2 bytes</option><option value="8">8-bit · 1 byte</option></select><small>Fewer bytes per cached token; conversion and quality may change.</small></label>
                <label class="field"><span>Attention schedule</span><select id="attention-select"><option value="fused">Fused · scores stay on chip</option><option value="separate">Separate · scores cross HBM</option></select><small>Attention backend and kernel fusion</small></label>
                <label class="toggle-field"><span><strong>Overlap compute + memory</strong><small>Runtime streams, staging, and prefetch</small></span><input id="overlap-toggle" type="checkbox" checked /><i aria-hidden="true"></i></label>
              </div>
              <p class="control-explainer" id="strategy-impact"></p>
            </fieldset>

            <fieldset class="control-group deployment-group">
              <legend><b>4</b><span><strong>Deployment target</strong><small>Fixed silicon to compare</small></span></legend>
              <div class="control-group-body">
                <label class="field"><span>Accelerator profile</span><select id="hardware-select">${HARDWARE_PROFILES.map((profile) => `<option value="${profile.id}">${profile.vendor} · ${profile.name}</option>`).join('')}</select></label>
                <div class="hardware-context"><span>Published hardware facts</span><strong id="hardware-context-note"></strong><small id="hardware-context-ceilings"></small></div>
              </div>
              <p class="control-explainer">Choosing a GPU changes the comparison target. Software can select this target; it cannot resize its HBM, SM/CU count, or physical bandwidth.</p>
            </fieldset>

            <details class="implementation-map"><summary>Map these ideas to serving frameworks</summary><div><p><strong>Example: vLLM.</strong> Admission width maps to <code>--max-num-seqs</code>; token work to <code>--max-num-batched-tokens</code>; HBM reservation to <code>--gpu-memory-utilization</code>; prefix reuse and prefill splitting to their corresponding enable flags. Weight and KV representations map to model quantization and <code>--kv-cache-dtype</code>.</p><p>The concepts are portable. Flag names and exact behavior vary across vLLM, TensorRT-LLM, SGLang, and custom serving stacks.</p></div></details>
            <div class="assumptions"><button type="button" id="assumptions-toggle" aria-expanded="false" aria-controls="assumptions-body">Model assumptions <span aria-hidden="true">+</span></button><div id="assumptions-body" class="assumptions-body"><p>Seymour is an analytical model—not a serving-framework profiler. Split prefill prices one weight stream per scheduling chunk. The memory budget reserves the remainder of physical HBM for runtime overhead. Weight and KV formats change byte counts only; Seymour keeps the published dense FP16 compute ceiling rather than inventing quantized-kernel speedups. Separate attention materializes the score/probability matrix across HBM four times per layer; fused attention keeps it on chip. Published peak × <strong id="efficiency-summary"></strong>. Host spill uses the published PCIe link ceiling. The kernel microscope exposes a 5 µs launch assumption.</p></div></div>
          </form>
        </aside>

          <section class="canonical-map" aria-labelledby="machine-map-title">
            <section class="request-lifecycle" aria-labelledby="lifecycle-title">
              <header>
                <div><span>Full request</span><strong id="lifecycle-title">From prompt to released cache</strong><small id="lifecycle-state" aria-live="polite">Paused · press Play to follow the request.</small></div>
                <div class="lifecycle-controls" role="group" aria-label="Request lifecycle playback">
                  <button id="reset-lifecycle" type="button"><span aria-hidden="true">↺</span> Start</button>
                  <button id="previous-lifecycle" type="button"><span aria-hidden="true">←</span> Step</button>
                  <button id="play-lifecycle" type="button" aria-pressed="false"><span id="lifecycle-play-icon" aria-hidden="true">▶</span><strong id="lifecycle-play-label">Play request</strong></button>
                  <button id="next-lifecycle" type="button">Step <span aria-hidden="true">→</span></button>
                </div>
              </header>
              <div class="lifecycle-rail" id="lifecycle-rail" aria-label="Eight stages in one inference request"></div>
              <div class="lifecycle-readout">
                <div><span id="lifecycle-step-number"></span><strong id="lifecycle-step-title"></strong><p id="lifecycle-step-summary"></p></div>
                <dl><div><dt id="lifecycle-metric-label"></dt><dd id="lifecycle-metric-value"></dd></div><div><dt>Time to first token</dt><dd id="ttft-value"></dd></div><div><dt>Modeled response</dt><dd id="response-time-value"></dd></div></dl>
              </div>
            </section>
            <section class="sequence-player" data-active="false" aria-labelledby="sequence-player-title">
              <div class="sequence-player-status">
                <span id="operation-phase-label">Execution detail · waiting for transformer work</span>
                <strong id="sequence-player-title">Operation <b id="sequence-index">01 / 12</b></strong>
                <small id="sequence-state" aria-live="polite">The request timeline drives this representative layer automatically.</small>
              </div>
              <div class="sequence-controls" role="group" aria-label="Manual transformer operation inspection">
                <button id="reset-sequence" type="button" title="Return to the first operation"><span aria-hidden="true">↺</span> Start</button>
                <button id="previous-operation" type="button"><span aria-hidden="true">←</span> Step</button>
                <button id="play-sequence" type="button" aria-pressed="false" hidden><span id="play-icon" aria-hidden="true">▶</span><strong id="play-label">Play path</strong></button>
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
                <b class="map-bottleneck">Whole-step limit</b>
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
                    <b class="map-bottleneck">Whole-step limit</b>
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
                          <section class="path-node" data-path-stage="compute"><b class="map-bottleneck">Whole-step limit</b><em>5</em><span>Arithmetic hardware</span><strong>Matrix + vector units</strong><small>Execute multiply-accumulate and vector instructions</small></section>
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
        <p>Prefill and decode price the HBM boundary independently. If the working set does not fit, the overflow crosses the much slower host link to system memory.</p>
      </div>
      <ol class="hierarchy-list">
        <li><span>01</span><strong>Tensor cores / MFMA</strong><small>The mouth · math lands here</small></li>
        <li><span>02</span><strong>Registers</strong><small>Operands · per execution unit</small></li>
        <li><span>03</span><strong>Shared / LDS</strong><small>Tiles · per SM or CU</small></li>
        <li><span>04</span><strong>L2 / Infinity Cache</strong><small>Reuse · shared on chip</small></li>
        <li><span>05</span><strong>HBM</strong><small>Weights + KV · directly available to accelerator kernels</small></li>
        <li><span>06</span><strong>System memory</strong><small>Overflow · must cross PCIe or a coherent fabric</small></li>
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
          <p><strong>Implementation mappings.</strong> <a href="https://docs.vllm.ai/en/v0.17.0/configuration/engine_args/">vLLM engine arguments</a> provide one concrete mapping for the portable scheduling, caching, memory-budget, and representation concepts shown here. Seymour models first-order effects; it does not reproduce any framework scheduler.</p>
          <p><strong>Kernel semantics.</strong> <a href="https://docs.nvidia.com/cutlass/4.5.2/media/docs/pythonDSL/mma_docs/wgmma_programming.html">NVIDIA CUTLASS WGMMA guide</a>, <a href="https://docs.nvidia.com/cuda/pdf/Hopper_Tuning_Guide.pdf">Hopper tuning guide</a>, and <a href="https://rocm.docs.amd.com/en/docs-6.0.2/reference/gpu-arch/gpu-arch-spec-overview.html">AMD ROCm architecture specifications</a>. The displayed kernel is a transparent reference plan, not a claim about a library’s emitted code.</p>
          <p><strong>Not yet modeled.</strong> Collectives, format-specific quantized compute throughput, prefix-cache lookup latency and eviction policy, exact scheduler residency, power throttling, continuous batching, and network/storage tiers. Host fallback is a first-order PCIe transfer model, not a paging simulator.</p>
        </div>
      </details>
    </section>
  </div>

  <footer>
    <div class="footer-plant" aria-hidden="true"><i></i><i></i><i></i></div>
    <p><strong>SEYMOUR</strong> · Feed the machine. Read the numbers.</p>
    <p>Code Apache-2.0 · words &amp; original art CC BY 4.0</p>
  </footer>

  <div class="toast" id="toast" role="status" aria-live="polite"></div>
`;

let settings: SimulationSettings = readSettings();
const lifecycleStageIds: LifecycleStageId[] = ['request', 'prefix', 'prefill', 'kv-ready', 'first-token', 'decode', 'stream', 'release'];
const requestedLifecycleStage = new URLSearchParams(window.location.search).get('stage') as LifecycleStageId | null;
let selectedLifecycleStageId: LifecycleStageId = requestedLifecycleStage && lifecycleStageIds.includes(requestedLifecycleStage)
  ? requestedLifecycleStage
  : 'request';
settings.phase = phaseForLifecycleStage(selectedLifecycleStageId);
if (!HARDWARE_PROFILES.some((hardware) => hardware.id === settings.hardwareId)) {
  settings.hardwareId = HARDWARE_PROFILES[0]!.id;
}
let hardware = getHardware(settings.hardwareId);
let model = applySoftwareStrategy(DEFAULT_MODEL, settings);
let result = calculateSimulation(settings, hardware, model);
let prefillResult = calculateSimulation({ ...settings, phase: 'prefill' }, hardware, model);
let decodeResult = calculateSimulation({ ...settings, phase: 'decode' }, hardware, model);

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
const prefixCacheRange = required<HTMLInputElement>('#prefix-cache-range');
const prefixCacheOutput = required<HTMLOutputElement>('#prefix-cache-output');
const outputLengthRange = required<HTMLInputElement>('#output-length-range');
const outputLengthOutput = required<HTMLOutputElement>('#output-length-output');
const maxBatchedTokensSelect = required<HTMLSelectElement>('#max-batched-tokens-select');
const servingMemoryFractionSelect = required<HTMLSelectElement>('#gpu-memory-utilization-select');
const reusePromptPrefixesToggle = required<HTMLInputElement>('#prefix-caching-toggle');
const splitLongPromptsToggle = required<HTMLInputElement>('#chunked-prefill-toggle');
const weightSelect = required<HTMLSelectElement>('#weight-select');
const kvSelect = required<HTMLSelectElement>('#kv-select');
const attentionSelect = required<HTMLSelectElement>('#attention-select');
const overlapToggle = required<HTMLInputElement>('#overlap-toggle');
const operationSelect = required<HTMLSelectElement>('#operation-select');
const playSequenceButton = required<HTMLButtonElement>('#play-sequence');
const resetSequenceButton = required<HTMLButtonElement>('#reset-sequence');
const playLifecycleButton = required<HTMLButtonElement>('#play-lifecycle');
const resetLifecycleButton = required<HTMLButtonElement>('#reset-lifecycle');
const controlDrawer = required<HTMLElement>('#control-drawer');
const openControlsButton = required<HTMLButtonElement>('#open-controls');
const roofline = required<HTMLElement>('#roofline-chart');
let selectedStepId = new URLSearchParams(window.location.search).get('op') ?? 'rms-attn';
let algorithmSteps: AlgorithmStep[] = [];
let currentKernelPlan: KernelPlan | null = null;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let scenePulseTimer = 0;
let sequenceTimer = 0;
let isSequencePlaying = false;
let sequenceIdleMessage = 'Paused · adjust the run, then press Play.';
let lifecycleTimer = 0;
let isLifecyclePlaying = false;
let lifecycleIdleMessage = 'Paused · press Play to follow the request.';
let sequencePlaybackOwner: 'manual' | 'lifecycle' = 'manual';
scene.setPaused(true);

function update(writeUrl = true): void {
  hardware = getHardware(settings.hardwareId);
  model = applySoftwareStrategy(DEFAULT_MODEL, settings);
  settings.phase = phaseForLifecycleStage(selectedLifecycleStageId);
  prefillResult = calculateSimulation({ ...settings, phase: 'prefill' }, hardware, model);
  decodeResult = calculateSimulation({ ...settings, phase: 'decode' }, hardware, model);
  result = calculateSimulation(settings, hardware, model);
  if (writeUrl) writeSettings(settings, selectedStepId, selectedLifecycleStageId);

  viewButtons.forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.view === settings.view));
  });
  hardwareSelect.value = hardware.id;
  required<HTMLElement>('.machine').dataset.view = settings.view;
  batchRange.value = String(batchToSlider(settings.batch));
  batchOutput.value = settings.batch.toLocaleString();
  tokensRange.value = String(sequenceToSlider(settings.sequenceLength));
  tokensOutput.value = settings.sequenceLength.toLocaleString();
  prefixCacheRange.value = String(prefixCacheToSlider(settings.prefixCachePercent));
  prefixCacheRange.disabled = !settings.reusePromptPrefixes;
  prefixCacheOutput.value = settings.reusePromptPrefixes ? `${settings.prefixCachePercent}%` : 'off';
  outputLengthRange.value = String(outputLengthToSlider(settings.outputLength));
  outputLengthOutput.value = settings.outputLength.toLocaleString();
  maxBatchedTokensSelect.value = String(settings.promptTokensPerStep);
  maxBatchedTokensSelect.disabled = !settings.splitLongPrompts;
  servingMemoryFractionSelect.value = String(settings.servingMemoryFraction);
  reusePromptPrefixesToggle.checked = settings.reusePromptPrefixes;
  splitLongPromptsToggle.checked = settings.splitLongPrompts;
  weightSelect.value = String(settings.weightBits);
  kvSelect.value = String(settings.kvBits);
  attentionSelect.value = settings.attentionKernel;
  overlapToggle.checked = settings.overlap;
  setText('#workload-summary', `${settings.batch} scheduled · ${settings.sequenceLength.toLocaleString()} prompt · ${settings.reusePromptPrefixes ? `${settings.prefixCachePercent}% cached` : 'cache off'} · ${settings.outputLength} output`);
  setText('#compact-workload-summary', `${settings.batch} × ${settings.sequenceLength.toLocaleString()} → ${settings.outputLength} · ${hardware.name}`);
  setText('#model-name', model.name);
  setText('#model-note', `${model.parametersB}B parameters · GQA ${model.attentionHeads}:${model.kvHeads}`);
  setText('#strategy-impact', `${precisionLabel(settings.weightBits)} weights occupy ${formatBytes(result.weightBytes)}. ${precisionLabel(settings.kvBits)} KV uses ${formatBytes(result.kvBytesPerToken)} per token. ${settings.attentionKernel === 'fused' ? 'Fused attention keeps scores on chip.' : 'Separate attention writes and rereads scores through HBM.'}`);
  setText(
    '#runtime-impact',
    `${settings.batch.toLocaleString()} ${settings.batch === 1 ? 'sequence' : 'sequences'} can run per scheduling iteration. Prefix reuse is ${settings.reusePromptPrefixes ? 'enabled' : 'disabled'}. ${settings.splitLongPrompts
      ? prefillResult.prefillChunks > 1
        ? `Split prefill divides the uncached prompt into ${prefillResult.prefillChunks.toLocaleString()} iterations of up to ${prefillResult.prefillChunkTokens.toLocaleString()} tokens per sequence; each iteration streams the weights again.`
        : `The ${settings.promptTokensPerStep.toLocaleString()}-token budget fits this prefill in one iteration.`
      : 'Prompt splitting is off, so the uncached prompt is admitted as one prefill iteration.'} The serving process may use ${formatBytes(result.usableHbmCapacityBytes)} of ${hardware.hbmCapacityGB} GB physical HBM.`,
  );
  setText('#hardware-context-note', `${hardware.unitCount} ${hardware.unitName}s · ${hardware.hbmCapacityGB} GB HBM · ${hardware.hbmBandwidthTBs} TB/s`);
  setText('#hardware-context-ceilings', `${formatNumber(hardware.fp16DenseTflops)} dense FP16 TFLOP/s · ${hardware.architecture}`);
  setText(
    '#workload-boundary-note',
    result.totalMs === 0
      ? 'Full prefix hit: the complete prompt K/V is reusable, so this request skips prefill and moves directly to first-token decode.'
      : result.bottleneck === 'host'
      ? `${settings.phase === 'prefill' ? 'Prefill' : 'Decode'} is host-bound: ${formatBytes(result.hostTrafficBytes)} crosses PCIe because the ${formatBytes(result.modelFootprintBytes)} working set exceeds the runtime’s ${formatBytes(result.usableHbmCapacityBytes)} HBM budget.`
      : result.bottleneck === 'compute'
        ? `${settings.phase === 'prefill' ? 'Prefill' : 'Decode'} is compute-bound: arithmetic takes ${formatNumber(result.computeMs / Math.max(result.memoryMs, Number.EPSILON))}× longer than memory traffic.`
        : settings.phase === 'prefill'
          ? `Prefill is HBM-bound for this uncached suffix: memory traffic takes ${formatNumber(result.memoryMs / Math.max(result.computeMs, Number.EPSILON))}× longer than arithmetic.`
          : result.crossoverBatch
          ? `Decode is HBM-bound here. Around batch ${result.crossoverBatch}, weight reuse reaches this GPU’s ${formatNumber(result.ridgePoint)} FLOP/byte ridge.`
          : `Decode is HBM-bound even with perfect weight reuse: this context tops out near ${formatNumber(result.batchLimitArithmeticIntensity)} FLOP/byte, below this GPU’s ${formatNumber(result.ridgePoint)} FLOP/byte ridge. Shorter context or smaller KV storage changes that limit.`,
  );
  setText('#algorithm-title', 'How an inference request crosses the machine.');
  const workloadPanel = required<HTMLElement>('.workload-panel');
  const spillsToHost = result.hostTrafficBytes > 0;
  workloadPanel.dataset.spill = String(spillsToHost);
  required<HTMLElement>('#workload-warning').hidden = !spillsToHost;
  required<HTMLElement>('#system-path').dataset.bottleneck = result.totalMs === 0 ? '' : result.bottleneck;

  setText('#efficiency-summary', `${Math.round(hardware.computeEfficiency * 100)}% compute / ${Math.round(hardware.memoryEfficiency * 100)}% HBM`);
  setText(
    '#bottleneck-value',
    result.totalMs === 0
      ? 'Prefill skipped'
      : result.bottleneck === 'host'
      ? 'Host ↔ GPU link'
      : result.bottleneck === 'memory'
        ? 'HBM bandwidth'
        : 'Tensor compute',
  );
  setText(
    '#bottleneck-note',
    result.totalMs === 0
      ? '100% of prompt K/V reused'
      : result.bottleneck === 'host'
      ? `${formatBytes(result.hostTrafficBytes)} crosses PCIe`
      : result.bottleneck === 'memory'
      ? `memory takes ${formatNumber(result.memoryMs / result.computeMs)}× longer`
      : `compute takes ${formatNumber(result.computeMs / result.memoryMs)}× longer`,
  );
  required('#bottleneck-card').dataset.bound = result.totalMs === 0 ? 'skipped' : result.bottleneck;
  setText('#time-value', result.totalMs === 0 ? 'skipped' : formatDuration(result.totalMs));
  setText('#rate-value', result.totalMs === 0 ? 'reuse hit' : `${formatNumber(result.tokenRate)} tokens/s`);
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
  setText('#hbm-value', result.hbmUsedFraction > 1 ? `${formatBytes(result.modelFootprintBytes - result.usableHbmCapacityBytes)} spill` : `${formatNumber(result.hbmUsedFraction * 100)}%`);
  setText('#hbm-note', `${formatBytes(result.modelFootprintBytes)} working set · ${formatBytes(result.usableHbmCapacityBytes)} runtime budget (${Math.round(settings.servingMemoryFraction * 100)}% of ${hardware.hbmCapacityGB} GB)`);
  setText('#roof-status', result.totalMs === 0 ? 'prefill skipped' : `${result.bottleneck}-bound`);
  setText(
    '#chart-note',
    result.bottleneck === 'host'
      ? 'The HBM roofline is no longer the active ceiling: spilled bytes cross PCIe, pulling attainable performance below it.'
      : 'The point moves right as useful math amortizes each byte. Crossing the ridge changes the limiting resource.',
  );
  required('#roof-status').className = `status-chip ${result.totalMs === 0 ? 'skipped' : result.bottleneck}`;

  const crossover = result.crossoverBatch
    ? ` Around batch ${result.crossoverBatch}, the point crosses this GPU’s ridge.`
    : ` At this context, per-sequence KV traffic caps the batch limit near ${formatNumber(result.batchLimitArithmeticIntensity)} FLOP/byte—below the ${formatNumber(result.ridgePoint)} FLOP/byte ridge.`;
  if (result.totalMs === 0) {
    setText('#finding-title', 'The prefix cache removes the entire prefill stage.');
    setText('#finding-copy', 'All prompt K/V pages are reusable, so the accelerator performs no prompt transformer work. The request still pays the first decode iteration before it can return a token.');
  } else if (result.bottleneck === 'host') {
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
    const uncachedTokens = Math.max(0, settings.sequenceLength - (settings.reusePromptPrefixes ? Math.round(settings.sequenceLength * settings.prefixCachePercent / 100) : 0));
    setText('#finding-title', `Prefill gives every weight ${uncachedTokens.toLocaleString()} uncached tokens of work.`);
    setText(
      '#finding-copy',
      settings.reusePromptPrefixes && settings.prefixCachePercent > 0
        ? `The reusable prefix removes ${settings.prefixCachePercent}% of the dense prompt work. The remaining suffix still attends across the full ${settings.sequenceLength.toLocaleString()}-token history, so a cache hit reduces time to first token without changing the final context. HBM still matters, but dense matrix work sets this analytical floor.`
        : 'The full prompt supplies enough weight reuse to move far beyond the ridge point. HBM still matters, but dense matrix work now sets the analytical floor.',
    );
  }

  const memoryEquation = result.hostTrafficBytes > 0
    ? `${formatBytes(result.hbmTrafficBytes)} ÷ ${formatNumber(hardware.hbmBandwidthTBs * hardware.memoryEfficiency)} TB/s + ${formatBytes(result.hostTrafficBytes)} ÷ ${hardware.hostLinkGBs} GB/s`
    : `${formatBytes(result.bytes)} ÷ ${formatNumber(hardware.hbmBandwidthTBs * hardware.memoryEfficiency)} TB/s`;
  required('#equation').innerHTML = result.totalMs === 0 ? `
    <span><small>prefill work</small><strong>complete prefix reused</strong><b>skipped</b></span>
    <i aria-hidden="true">→</i>
    <span><small>next paid stage</small><strong>first-token decode</strong><b>${formatDuration(decodeResult.totalMs)}</b></span>
  ` : `
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
  renderLifecycle();
}

viewButtons.forEach((button) => {
  button.addEventListener('click', () => {
    settings.view = button.dataset.view === 'hardware' ? 'hardware' : 'story';
    update();
  });
});

hardwareSelect.addEventListener('change', () => {
  pauseLifecycle('Settings changed · restart when ready.');
  pauseSequence('Settings changed · press Play to run this configuration.');
  settings.hardwareId = hardwareSelect.value;
  update();
});
batchRange.addEventListener('input', () => {
  pauseLifecycle('Settings changed · restart when ready.');
  pauseSequence('Settings changed · press Play to run this configuration.');
  settings.batch = batchFromSlider(Number(batchRange.value));
  update();
});
tokensRange.addEventListener('input', () => {
  pauseLifecycle('Settings changed · restart when ready.');
  pauseSequence('Settings changed · press Play to run this configuration.');
  settings.sequenceLength = sequenceFromSlider(Number(tokensRange.value));
  update();
});
prefixCacheRange.addEventListener('input', () => {
  pauseLifecycle('Prefix reuse changed · restart when ready.');
  pauseSequence('Settings changed · press Play to run this configuration.');
  settings.prefixCachePercent = prefixCacheFromSlider(Number(prefixCacheRange.value));
  update();
});
outputLengthRange.addEventListener('input', () => {
  pauseLifecycle('Response length changed · restart when ready.');
  pauseSequence('Settings changed · press Play to run this configuration.');
  settings.outputLength = outputLengthFromSlider(Number(outputLengthRange.value));
  update();
});
maxBatchedTokensSelect.addEventListener('change', () => {
  pauseLifecycle('Scheduler token budget changed · restart when ready.');
  pauseSequence('Settings changed · press Play to run this configuration.');
  settings.promptTokensPerStep = Number(maxBatchedTokensSelect.value);
  update();
});
servingMemoryFractionSelect.addEventListener('change', () => {
  pauseLifecycle('Runtime memory budget changed · restart when ready.');
  pauseSequence('Settings changed · press Play to run this configuration.');
  settings.servingMemoryFraction = Number(servingMemoryFractionSelect.value);
  update();
});
reusePromptPrefixesToggle.addEventListener('change', () => {
  pauseLifecycle('Prefix cache policy changed · restart when ready.');
  pauseSequence('Settings changed · press Play to run this configuration.');
  settings.reusePromptPrefixes = reusePromptPrefixesToggle.checked;
  update();
});
splitLongPromptsToggle.addEventListener('change', () => {
  pauseLifecycle('Prefill scheduling changed · restart when ready.');
  pauseSequence('Settings changed · press Play to run this configuration.');
  settings.splitLongPrompts = splitLongPromptsToggle.checked;
  update();
});
weightSelect.addEventListener('change', () => {
  pauseLifecycle('Settings changed · restart when ready.');
  pauseSequence('Settings changed · press Play to run this configuration.');
  settings.weightBits = Number(weightSelect.value) as SimulationSettings['weightBits'];
  update();
});
kvSelect.addEventListener('change', () => {
  pauseLifecycle('Settings changed · restart when ready.');
  pauseSequence('Settings changed · press Play to run this configuration.');
  settings.kvBits = Number(kvSelect.value) as SimulationSettings['kvBits'];
  update();
});
attentionSelect.addEventListener('change', () => {
  pauseLifecycle('Settings changed · restart when ready.');
  pauseSequence('Settings changed · press Play to run this configuration.');
  settings.attentionKernel = attentionSelect.value as SimulationSettings['attentionKernel'];
  update();
});
overlapToggle.addEventListener('change', () => {
  pauseLifecycle('Settings changed · restart when ready.');
  pauseSequence('Settings changed · press Play to run this configuration.');
  settings.overlap = overlapToggle.checked;
  update();
});

required<HTMLButtonElement>('#reset-controls').addEventListener('click', () => {
  pauseLifecycle('Defaults restored · ready to play from request arrival.');
  pauseSequence('Defaults restored · ready to play from operation 1.');
  settings = { phase: 'prefill', hardwareId: 'h100-sxm', batch: 1, sequenceLength: 4096, prefixCachePercent: 0, outputLength: 32, reusePromptPrefixes: true, splitLongPrompts: true, promptTokensPerStep: 8192, servingMemoryFraction: 0.9, weightBits: 16, kvBits: 16, kvPlacement: 'hbm', attentionKernel: 'fused', overlap: true, view: 'hardware' };
  selectedLifecycleStageId = 'request';
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

required<HTMLButtonElement>('#previous-lifecycle').addEventListener('click', () => {
  pauseLifecycle('Paused · stepped back one lifecycle stage.');
  moveLifecycle(-1, true);
});
required<HTMLButtonElement>('#next-lifecycle').addEventListener('click', () => {
  pauseLifecycle('Paused · stepped forward one lifecycle stage.');
  moveLifecycle(1, true);
});
resetLifecycleButton.addEventListener('click', () => {
  pauseLifecycle('At request arrival · press Play or Step forward.');
  selectLifecycleStage('request', true);
});
playLifecycleButton.addEventListener('click', () => {
  if (isLifecyclePlaying) pauseLifecycle('Paused · inspect this stage or resume Play.');
  else playLifecycle();
});

openControlsButton.addEventListener('click', () => setControlsOpen(true));
required<HTMLButtonElement>('#close-controls').addEventListener('click', () => setControlsOpen(false, true));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && controlDrawer.dataset.open === 'true') setControlsOpen(false, true);
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
  pauseLifecycle('Ready · press Play to follow the full request.');
  selectedStepId = algorithmSteps[0]?.id ?? 'rms-attn';
  selectLifecycleStage('request');
  required<HTMLElement>('.canonical-map').scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
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

function phaseForLifecycleStage(stageId: LifecycleStageId): SimulationSettings['phase'] {
  return ['request', 'prefix', 'prefill', 'kv-ready'].includes(stageId) ? 'prefill' : 'decode';
}

function buildLifecycleStages(): LifecycleStage[] {
  const cachedTokens = settings.reusePromptPrefixes ? Math.round(settings.sequenceLength * settings.prefixCachePercent / 100) : 0;
  const uncachedTokens = settings.sequenceLength - cachedTokens;
  const repeatedDecodeTokens = decodeIterationCounts(settings.outputLength).repeated;
  const prefixOutcome = !settings.reusePromptPrefixes
    ? 'Automatic prefix caching is disabled, so the runtime sends the complete prompt to prefill.'
    : settings.prefixCachePercent === 0
    ? 'Prefix miss: no reusable K/V pages were found, so the full prompt must run through prefill.'
    : settings.prefixCachePercent === 100
      ? 'Full prefix hit: every prompt token already has reusable K/V pages, so prefill is skipped.'
      : `Partial prefix hit: ${cachedTokens.toLocaleString()} tokens reuse existing K/V pages; only the ${uncachedTokens.toLocaleString()}-token suffix runs through prefill.`;

  return [
    {
      id: 'request', number: '01', label: 'Request', title: 'The request enters the serving scheduler.',
      summary: `${settings.batch} ${settings.batch === 1 ? 'sequence is' : 'sequences are'} admitted to this scheduler iteration with ${settings.sequenceLength.toLocaleString()} prompt tokens each. This is the software-controlled maximum sequence batch, not a change to the GPU.`,
      equation: 'scheduler.enqueue(request)', metricLabel: 'Sequences / iteration', metricValue: settings.batch.toLocaleString(),
      phase: 'prefill', hardwareStage: 'host', hasTransformerWork: false,
    },
    {
      id: 'prefix', number: '02', label: 'Prefix lookup', title: 'Look for reusable prompt K/V pages.',
      summary: prefixOutcome,
      equation: 'cached prefix ∩ prompt tokens', metricLabel: !settings.reusePromptPrefixes ? 'Cache policy' : settings.prefixCachePercent === 0 ? 'Cache outcome' : 'Tokens reused', metricValue: !settings.reusePromptPrefixes ? 'disabled' : settings.prefixCachePercent === 0 ? 'miss' : cachedTokens.toLocaleString(),
      phase: 'prefill', hardwareStage: cachedTokens === 0 ? 'host' : 'hbm', hasTransformerWork: false,
    },
    {
      id: 'prefill', number: '03', label: 'Prefill', title: uncachedTokens === 0 ? 'Prefill is skipped.' : 'Process the uncached prompt suffix in parallel.',
      summary: uncachedTokens === 0
        ? 'The prefix cache already contains K/V pages for the complete prompt. No prompt transformer work is repeated.'
        : `${uncachedTokens.toLocaleString()} uncached query tokens run through all model layers while attending over the complete ${settings.sequenceLength.toLocaleString()}-token context. ${prefillResult.prefillChunks > 1 ? `The ${settings.promptTokensPerStep.toLocaleString()}-token scheduler budget divides that work into ${prefillResult.prefillChunks.toLocaleString()} iterations of up to ${prefillResult.prefillChunkTokens.toLocaleString()} tokens per sequence.` : 'The scheduler admits the prefill in one iteration.'}`,
      equation: `Qsuffix · Kfullᵀ → P · Vfull`, metricLabel: prefillResult.prefillChunks > 1 ? 'Prefill iterations' : 'Prefill accelerator floor', metricValue: uncachedTokens === 0 ? 'skipped' : prefillResult.prefillChunks > 1 ? `${prefillResult.prefillChunks} · ${formatDuration(prefillResult.totalMs)}` : formatDuration(prefillResult.totalMs),
      phase: 'prefill', hardwareStage: uncachedTokens === 0 ? 'hbm' : 'compute', hasTransformerWork: uncachedTokens > 0, skipped: uncachedTokens === 0,
    },
    {
      id: 'kv-ready', number: '04', label: 'KV ready', title: 'The complete prompt history is resident for generation.',
      summary: `Cached and newly written K/V pages now represent all ${settings.sequenceLength.toLocaleString()} prompt positions. Every decode iteration reads this history while producing the next token.`,
      equation: 'KV = prefix pages + new suffix pages', metricLabel: 'Prompt KV footprint', metricValue: formatBytes(decodeResult.kvFootprintBytes),
      phase: 'prefill', hardwareStage: 'hbm', hasTransformerWork: false,
    },
    {
      id: 'first-token', number: '05', label: 'First token', title: 'Run the first decode iteration and sample a token.',
      summary: 'One query position crosses every transformer layer, reads the prompt K/V history, projects logits, and samples the first output token.',
      equation: 'xlast → transformer → logits → sample', metricLabel: 'First decode iteration', metricValue: formatDuration(decodeResult.totalMs),
      phase: 'decode', hardwareStage: 'compute', hasTransformerWork: true,
    },
    {
      id: 'decode', number: '06', label: 'Decode loop', title: repeatedDecodeTokens === 0 ? 'No additional decode iterations were requested.' : 'Repeat decode once for each remaining output token.',
      summary: repeatedDecodeTokens === 0
        ? 'The requested response contains one token, so generation leaves the loop after the first-token stage.'
        : `${repeatedDecodeTokens.toLocaleString()} more iterations each append one K/V position, reread the growing history, and sample one token.`,
      equation: 'tokenₙ → decode → tokenₙ₊₁ ↻', metricLabel: 'Repeated decode floor', metricValue: repeatedDecodeTokens === 0 ? 'skipped' : formatDuration(decodeResult.totalMs * repeatedDecodeTokens),
      phase: 'decode', hardwareStage: repeatedDecodeTokens === 0 ? 'hbm' : 'compute', hasTransformerWork: repeatedDecodeTokens > 0, skipped: repeatedDecodeTokens === 0,
    },
    {
      id: 'stream', number: '07', label: 'Stream', title: 'Return sampled token IDs to the client.',
      summary: 'Serving software detokenizes and streams outputs as they are generated. This boundary is outside the accelerator model; no large tensor follows the token ID.',
      equation: 'token IDs → detokenize → client', metricLabel: 'Tokens returned', metricValue: settings.outputLength.toLocaleString(),
      phase: 'decode', hardwareStage: 'host', hasTransformerWork: false,
    },
    {
      id: 'release', number: '08', label: 'Release', title: 'Release or retain the request’s KV pages.',
      summary: 'Generation is complete, so the allocator can free these pages or retain eligible prefix blocks for a future request.',
      equation: 'KV pages → free list or prefix cache', metricLabel: 'Final working set', metricValue: formatBytes(decodeResult.modelFootprintBytes),
      phase: 'decode', hardwareStage: 'hbm', hasTransformerWork: false,
    },
  ];
}

function renderLifecycle(): void {
  const stages = buildLifecycleStages();
  const selected = stages.find((stage) => stage.id === selectedLifecycleStageId) ?? stages[0]!;
  selectedLifecycleStageId = selected.id;
  const selectedIndex = stages.indexOf(selected);
  const rail = required<HTMLElement>('#lifecycle-rail');
  rail.innerHTML = stages.map((stage, index) => `
    <button type="button" data-lifecycle-id="${stage.id}" data-status="${index < selectedIndex ? 'complete' : index === selectedIndex ? 'current' : 'upcoming'}" aria-pressed="${index === selectedIndex}" aria-label="Stage ${index + 1} of ${stages.length}: ${stage.title}">
      <span>${stage.number}</span><strong>${stage.label}</strong>${stage.skipped ? '<small>skipped</small>' : ''}
    </button>
  `).join('');
  rail.querySelectorAll<HTMLButtonElement>('[data-lifecycle-id]').forEach((button) => {
    button.addEventListener('click', () => {
      pauseLifecycle('Paused · jumped to the selected lifecycle stage.');
      selectLifecycleStage(button.dataset.lifecycleId as LifecycleStageId, true);
    });
  });

  setText('#lifecycle-step-number', `${selected.number} / ${stages.length}`);
  setText('#lifecycle-step-title', selected.title);
  setText('#lifecycle-step-summary', selected.summary);
  setText('#lifecycle-metric-label', selected.metricLabel);
  setText('#lifecycle-metric-value', selected.metricValue);
  setText('#ttft-value', formatDuration(prefillResult.totalMs + decodeResult.totalMs));
  setText('#response-time-value', formatDuration(prefillResult.totalMs + decodeResult.totalMs * settings.outputLength));
  syncLifecyclePlayer(stages, selectedIndex);

  const sequencePlayer = required<HTMLElement>('.sequence-player');
  sequencePlayer.hidden = false;
  sequencePlayer.dataset.active = String(selected.hasTransformerWork);
  required<HTMLElement>('.teaching-rail').hidden = !selected.hasTransformerWork;
  required<HTMLElement>('.kernel-deep-dive').hidden = !selected.hasTransformerWork;
  required<HTMLElement>('.metric-strip').hidden = !selected.hasTransformerWork;
  required<HTMLElement>('.explanation').hidden = !selected.hasTransformerWork;
  required<HTMLElement>('.execution-lesson').dataset.lifecycleWork = String(selected.hasTransformerWork);

  const operationButtons = [...sequencePlayer.querySelectorAll<HTMLButtonElement>('.algorithm-steps button')];
  const operationControls = [
    resetSequenceButton,
    required<HTMLButtonElement>('#previous-operation'),
    playSequenceButton,
    required<HTMLButtonElement>('#next-operation'),
  ];
  const manualOperationControl = selected.hasTransformerWork && !isLifecyclePlaying;
  operationButtons.forEach((button) => { button.disabled = !manualOperationControl; });
  operationControls.forEach((button) => { button.disabled = !manualOperationControl; });
  operationSelect.disabled = !manualOperationControl;

  if (selected.hasTransformerWork) {
    setText('#operation-phase-label', selected.id === 'prefill'
      ? `Inside prefill · one representative layer × ${model.layers}`
      : selected.id === 'first-token'
        ? `Inside first token · one representative layer × ${model.layers}`
        : `Inside decode · first token + ${decodeIterationCounts(settings.outputLength).repeated.toLocaleString()} repeated ${decodeIterationCounts(settings.outputLength).repeated === 1 ? 'iteration' : 'iterations'}`);
    if (!isSequencePlaying) {
      setText('#sequence-state', isLifecyclePlaying
        ? 'The request timeline is handing control to this transformer path.'
        : 'Paused here · step through operations or resume the complete request.');
    }
    return;
  }

  setText('#operation-phase-label', 'Execution detail · waiting for transformer work');
  setText('#sequence-state', isLifecyclePlaying
    ? 'The request is handling orchestration and residency before the next kernel path.'
    : 'Play the request. This bay remains in place and activates when transformer work begins.');

  setText('#path-step', `Lifecycle ${selected.number} / ${stages.length}`);
  setText('#path-title', selected.title);
  setText('#path-equation', selected.equation);
  setText('#path-summary', selected.summary);
  required<HTMLElement>('#system-path').dataset.bottleneck = '';
  required<HTMLElement>('#data-legend').innerHTML = selected.hardwareStage === 'host'
    ? '<span data-data-kind="control"><i></i>serving control path</span>'
    : '<span data-data-kind="kv"><i></i>key/value cache pages</span>';
  setText('#unit-utilization', 'No transformer kernel dispatched');
  setText('#unit-utilization-note', 'This lifecycle stage is serving orchestration or cache management.');
  setText('#host-data-note', selected.id === 'request'
    ? 'The scheduler shapes the request on the host before a GPU kernel is submitted.'
    : selected.id === 'prefix'
      ? 'The serving runtime resolves reusable prefix pages before it launches uncached prompt work.'
      : selected.id === 'stream'
        ? 'Small sampled token IDs return to the host for detokenization and streaming.'
        : 'The cache allocator updates page ownership; it does not run a transformer kernel.');
  required<HTMLElement>('#worker-array').setAttribute('aria-label', 'No compute units are assigned transformer work in this lifecycle stage.');
  required<HTMLElement>('#worker-array-grid').querySelectorAll<HTMLElement>('i').forEach((cell) => {
    cell.dataset.active = 'false';
    cell.classList.remove('is-enlarged');
  });
  const usedStages = selected.hardwareStage === 'host'
    ? new Set(['host'])
    : new Set(['host', 'package', 'hbm']);
  document.querySelectorAll<HTMLElement>('[data-path-stage]').forEach((node) => {
    const stage = node.dataset.pathStage ?? '';
    node.dataset.used = String(usedStages.has(stage));
    node.dataset.focus = String(stage === selected.hardwareStage || (selected.hardwareStage === 'hbm' && stage === 'package'));
  });
  scene.selectStage(selected.hardwareStage);
}

function selectLifecycleStage(id: LifecycleStageId, pulse = false): void {
  selectedLifecycleStageId = id;
  settings.phase = phaseForLifecycleStage(id);
  pauseSequence('Lifecycle stage selected · inspect an operation when transformer work is active.');
  update();
  if (pulse) traceSelectedPath();
}

function moveLifecycle(delta: number, pulse: boolean): void {
  const index = lifecycleStageIds.indexOf(selectedLifecycleStageId);
  const target = Math.max(0, Math.min(lifecycleStageIds.length - 1, index + delta));
  if (target === index) return;
  selectLifecycleStage(lifecycleStageIds[target]!, pulse);
}

function playLifecycle(): void {
  let index = lifecycleStageIds.indexOf(selectedLifecycleStageId);
  let resetOperations = false;
  if (index === lifecycleStageIds.length - 1) {
    index = 0;
    selectedLifecycleStageId = lifecycleStageIds[0]!;
    resetOperations = true;
    update();
  }
  window.clearTimeout(sequenceTimer);
  isLifecyclePlaying = true;
  lifecycleIdleMessage = '';
  renderLifecycle();
  traceSelectedPath();
  beginLifecycleStage(resetOperations);
}

function beginLifecycleStage(resetOperations = true): void {
  const current = buildLifecycleStages().find((stage) => stage.id === selectedLifecycleStageId);
  if (current?.hasTransformerWork && !current.skipped) {
    playSequenceForLifecycle(resetOperations);
    return;
  }
  sequencePlaybackOwner = 'manual';
  scheduleLifecycleAdvance();
}

function scheduleLifecycleAdvance(): void {
  window.clearTimeout(lifecycleTimer);
  const current = buildLifecycleStages().find((stage) => stage.id === selectedLifecycleStageId);
  lifecycleTimer = window.setTimeout(() => {
    const index = lifecycleStageIds.indexOf(selectedLifecycleStageId);
    if (!isLifecyclePlaying || index < 0) return;
    if (index === lifecycleStageIds.length - 1) {
      pauseLifecycle('Complete · the response streamed and its KV pages were released or retained.');
      return;
    }
    selectedLifecycleStageId = lifecycleStageIds[index + 1]!;
    update();
    traceSelectedPath();
    beginLifecycleStage(true);
  }, current?.skipped ? 850 : reduceMotion ? 2200 : 1800);
}

function pauseLifecycle(message = 'Paused · inspect this stage or resume Play.'): void {
  window.clearTimeout(lifecycleTimer);
  isLifecyclePlaying = false;
  lifecycleIdleMessage = message;
  if (sequencePlaybackOwner === 'lifecycle' && isSequencePlaying) {
    window.clearTimeout(sequenceTimer);
    isSequencePlaying = false;
    sequencePlaybackOwner = 'manual';
    sequenceIdleMessage = 'Paused with the request · step here or resume the complete request.';
    const operationIndex = algorithmSteps.findIndex((step) => step.id === selectedStepId);
    if (operationIndex >= 0) syncSequencePlayer(algorithmSteps[operationIndex]!, operationIndex);
  }
  const stages = buildLifecycleStages();
  const index = stages.findIndex((stage) => stage.id === selectedLifecycleStageId);
  if (index >= 0) renderLifecycle();
}

function syncLifecyclePlayer(stages: LifecycleStage[], index: number): void {
  const selected = stages[index]!;
  setText('#lifecycle-state', isLifecyclePlaying ? `Playing · ${selected.title}` : lifecycleIdleMessage);
  playLifecycleButton.setAttribute('aria-pressed', String(isLifecyclePlaying));
  setText('#lifecycle-play-icon', isLifecyclePlaying ? 'Ⅱ' : '▶');
  setText('#lifecycle-play-label', isLifecyclePlaying ? 'Pause' : index === stages.length - 1 ? 'Replay request' : 'Play request');
  required<HTMLButtonElement>('#previous-lifecycle').disabled = index === 0;
  required<HTMLButtonElement>('#next-lifecycle').disabled = index === stages.length - 1;
  resetLifecycleButton.disabled = index === 0 && !isLifecyclePlaying;
  required<HTMLElement>('.request-lifecycle').dataset.playing = String(isLifecyclePlaying);
}

function setControlsOpen(open: boolean, returnFocus = false): void {
  controlDrawer.dataset.open = String(open);
  controlDrawer.setAttribute('aria-hidden', String(!open));
  controlDrawer.inert = !open;
  openControlsButton.setAttribute('aria-expanded', String(open));
  document.documentElement.dataset.controlsOpen = String(open);
  if (open) required<HTMLButtonElement>('#close-controls').focus({ preventScroll: true });
  else if (returnFocus) openControlsButton.focus({ preventScroll: true });
}

function renderAlgorithm(): void {
  algorithmSteps = buildAlgorithmSteps(settings, model);
  const selected = algorithmSteps.find((step) => step.id === selectedStepId) ?? algorithmSteps[0]!;
  selectedStepId = selected.id;
  const selectedIndex = algorithmSteps.indexOf(selected);
  const lifecycleStage = buildLifecycleStages().find((stage) => stage.id === selectedLifecycleStageId);
  const canControlOperations = Boolean(lifecycleStage?.hasTransformerWork) && !isLifecyclePlaying;
  const rail = required<HTMLElement>('#algorithm-steps');
  const chapters = [
    { id: 'attention', label: 'Attention', range: 'steps 1–8' },
    { id: 'mlp', label: 'Feed-forward network', range: 'steps 9–10' },
    { id: 'output', label: 'Choose the next token', range: 'steps 11–12' },
  ] as const;
  rail.innerHTML = algorithmSteps.map((step, index) => `
    <button type="button" data-operation-id="${step.id}" data-group="${step.group}" data-status="${index < selectedIndex ? 'complete' : index === selectedIndex ? 'current' : 'upcoming'}" aria-pressed="${index === selectedIndex}" aria-label="Operation ${index + 1} of ${algorithmSteps.length}: ${step.name}" ${canControlOperations ? '' : 'disabled'}>
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
  operationSelect.disabled = !canControlOperations;
  playSequenceButton.disabled = !canControlOperations;
  required<HTMLButtonElement>('#previous-operation').disabled = !canControlOperations || selectedIndex === 0;
  required<HTMLButtonElement>('#next-operation').disabled = !canControlOperations || selectedIndex === algorithmSteps.length - 1;
  resetSequenceButton.disabled = !canControlOperations || (selectedIndex === 0 && !isSequencePlaying);
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
  writeSettings(settings, selectedStepId, selectedLifecycleStageId);
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
  pauseLifecycle('Paused on this lifecycle stage while its transformer operations play.');
  sequencePlaybackOwner = 'manual';
  let index = algorithmSteps.findIndex((step) => step.id === selectedStepId);
  if (index === algorithmSteps.length - 1) {
    index = 0;
    selectOperation(algorithmSteps[0]!.id);
  }
  isSequencePlaying = true;
  sequenceIdleMessage = '';
  syncSequencePlayer(algorithmSteps[index]!, index);
  traceSelectedPath();
  scheduleSequenceAdvance(1100);
}

function playSequenceForLifecycle(resetOperations: boolean): void {
  if (algorithmSteps.length === 0) return;
  window.clearTimeout(sequenceTimer);
  sequencePlaybackOwner = 'lifecycle';
  if (resetOperations || algorithmSteps.findIndex((step) => step.id === selectedStepId) < 0) {
    selectedStepId = algorithmSteps[0]!.id;
    renderAlgorithm();
  }
  isSequencePlaying = true;
  sequenceIdleMessage = '';
  const index = Math.max(0, algorithmSteps.findIndex((step) => step.id === selectedStepId));
  syncSequencePlayer(algorithmSteps[index]!, index);
  traceSelectedPath();
  setText('#lifecycle-state', `Playing ${selectedLifecycleStageId} · ${algorithmSteps[index]!.name}`);
  const detailBay = required<HTMLElement>('.sequence-player');
  const rect = detailBay.getBoundingClientRect();
  if (rect.top < 0 || rect.bottom > window.innerHeight) {
    detailBay.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
  }
  scheduleSequenceAdvance(reduceMotion ? 650 : 460);
}

function scheduleSequenceAdvance(delayMs: number): void {
  window.clearTimeout(sequenceTimer);
  sequenceTimer = window.setTimeout(() => {
    const index = algorithmSteps.findIndex((step) => step.id === selectedStepId);
    if (!isSequencePlaying || index < 0) return;
    if (index === algorithmSteps.length - 1) {
      if (sequencePlaybackOwner === 'lifecycle') {
        isSequencePlaying = false;
        sequenceIdleMessage = `Representative ${selectedLifecycleStageId === 'prefill' ? 'layer' : 'token path'} complete · returning to the request timeline.`;
        syncSequencePlayer(algorithmSteps[index]!, index);
        lifecycleTimer = window.setTimeout(() => {
          if (!isLifecyclePlaying) return;
          const lifecycleIndex = lifecycleStageIds.indexOf(selectedLifecycleStageId);
          if (lifecycleIndex === lifecycleStageIds.length - 1) {
            pauseLifecycle('Complete · the response streamed and its KV pages were released or retained.');
            return;
          }
          selectedLifecycleStageId = lifecycleStageIds[lifecycleIndex + 1]!;
          sequencePlaybackOwner = 'manual';
          update();
          required<HTMLElement>('.request-lifecycle').scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
          traceSelectedPath();
          beginLifecycleStage(true);
        }, reduceMotion ? 250 : 520);
        return;
      }
      pauseSequence('Complete · one token path crossed all 12 operations.');
      return;
    }
    selectOperation(algorithmSteps[index + 1]!.id, true);
    if (sequencePlaybackOwner === 'lifecycle') {
      setText('#lifecycle-state', `Playing ${selectedLifecycleStageId} · ${algorithmSteps[index + 1]!.name}`);
    }
    scheduleSequenceAdvance(delayMs);
  }, delayMs);
}

function pauseSequence(message = 'Paused · use Step or resume Play.'): void {
  window.clearTimeout(sequenceTimer);
  isSequencePlaying = false;
  sequencePlaybackOwner = 'manual';
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
