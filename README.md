<p align="center">
  <img src="public/assets/seymour-readme.png" alt="An original screenprint-style illustration of a technician carrying memory blocks from a GPU rack to a hungry computing plant." width="100%" />
</p>

# Seymour

**A visual, quantitative map of how LLM inference is laid across a GPU and the system around it.**

**Live demo:** <https://plainsight-systems.github.io/seymour/>

Seymour puts a complete inference request on the hardware that runs it. Follow prompt arrival, prefix reuse, prefill, first-token generation, the decode loop, streaming, and cache release; then select an actual transformer operation and inspect the kernel and SIMD/SIMT work that implements it. Every byte and FLOP comes from the same deterministic first-order model.

The name is for Seymour Cray, by way of the idea that a GPU is a hungry plant: the tensor cores are the mouth and the memory hierarchy has to keep bringing food.

## What is here

The first complete scenario follows one request across a single GPU:

- One canonical nested map explains the machine before it traces the data: host computer → accelerator package → HBM + GPU die → shared L2 → repeated SM/CU workers → local memory, registers, and matrix/vector units.
- The selected transformer equation, tensor shapes, kernel name, and modeled boundary traffic sit beside that map, so the algorithm and the hardware route stay connected.
- An eight-stage request player follows scheduler admission → prefix lookup → prefill → active prompt KV → first token → repeated decode → streaming → release or retention. It owns one master clock: at transformer stages it hands playback to a representative 12-operation layer, completes that path, and then returns to the request lifecycle.
- The execution-detail bay is spatially stable. It stays visible but inactive during orchestration stages, so transformer work no longer inserts a second player into the layout. Continuous playback has one Play/Pause control; the lower controls are inspection-only stepping and jumping within the paused transformer path.
- Before the experiment, a four-question compass frames every optimization by **work**, **traffic**, **placement**, and **execution**. Product and framework names are treated as implementations of those ideas rather than as the ontology of inference performance.
- **Configure run** opens the controls as a right-side overlay. The drawer separates **Workload**, **Scheduling + residency**, **Representation + kernels**, and **Deployment target**. Framework-specific flag names live in a secondary implementation-mapping disclosure.
- Prefix reuse is modeled explicitly. A miss runs the full prompt through prefill; a partial hit runs only the uncached query suffix while attending over the complete cached-plus-new context; a full hit skips prefill. The lifecycle reports the resulting accelerator time-to-first-token and modeled response floor.
- The accelerator selector is not presented as a hardware throttle. It swaps the published SM/CU count, HBM capacity and bandwidth, architecture, and compute ceiling; software can choose that target but cannot alter its silicon.
- Software strategy controls change the deterministic model. Lower-bit storage reduces bytes and capacity pressure, while separate QK → softmax → PV kernels materialize the score/probability matrix through HBM instead of keeping it on chip.
- The SM/CU array shows estimated first-wave unit coverage for the selected kernel: active units are filled, idle units remain empty, and wider kernel grids visibly activate more hardware. This is a declared scheduling model, not profiler telemetry.
- The current limiting boundary is marked in red—HBM, arithmetic hardware, or the host link. Capacity overflow also raises a red system-memory warning beside the workload controls.
- CPU launch commands and tensor traffic are drawn as separate paths. System-memory traffic appears only when the selected workload exceeds accelerator memory.
- A real-time Three.js hardware cutaway is available as an optional spatial inspector. It shows the same parts without competing with the canonical lesson map or advancing automatically.
- NVIDIA H100 SXM and AMD MI300X profiles use published capacity, bandwidth, and dense FP16 peak specifications.
- A Llama 3.1 8B profile computes weight traffic, KV growth, operation counts, timing bounds, arithmetic intensity, and roofline position across selectable weight and KV storage formats.
- Batch and context controls show when decode crosses from HBM-bound to compute-bound.
- The optional Plant analogy and Hardware cutaway share one state: the first keeps the feeding metaphor, while the second exposes the package, HBM stacks, cache, CU/SM array, shared memory/LDS, registers, matrix units, host DRAM, and PCIe fallback path.
- A nested 12-operation player spells out RMSNorm, Q/K/V projections, RoPE, KV append/read, QKᵀ, masking, numerically stable softmax, PV, output projection, residuals, SwiGLU, logits, top-k/top-p, and sampling with equations, live shapes, FLOPs, and bytes.
- Lifecycle **Play** walks the complete request. Within prefill, first-token, and decode stages, the operation controls can pause and step through the transformer one kernel at a time. Playback never changes the chosen workload or software strategy.
- Each operation explains what makes it expensive, defines the relevant performance-computing terms, and locates concrete model, runtime, kernel, and system optimization levers—with their tradeoffs.
- An execution microscope maps each selected operation to a named reference kernel, grid/workgroup shape, fused sub-operations, an overlapping runtime/memory/execution schedule, and a lane-level WGMMA or MFMA view.
- Seymour uses **kernel**, the standard ML/HPC term for the GPU program being dispatched. Readers coming from graphics can think of it as a compute-shader-like program specialized for tensor and vector work.
- The hardware scene draws the host, PCIe, accelerator package, HBM, GPU die, memory controllers, shared L2, SM/CU array, local memory, registers, and matrix lanes as distinct boundaries. Command traffic is separate from tensor traffic; host tensor traffic appears only for the selected kernel when its data spills.
- Playback drives the same canonical map and calculation state used by direct exploration. It starts only when the reader presses Play, pauses whenever a knob changes, and respects reduced-motion preferences.
- Every state is encoded in the URL. The WebGL view can export a still.

This is an analytical model, not a benchmark or cycle-accurate simulator. Assumptions and omissions stay visible in the interface.

## Run locally

```bash
npm install
npm run dev
```

Quality checks:

```bash
npm test
npm run build
```

The production output is entirely static in `dist/`. Vite uses relative asset paths so the same build works at a GitHub Pages project URL or a custom domain.

## How the estimate works

For each state, Seymour computes two lower bounds:

```text
compute floor = FLOPs / (published peak FLOP/s × compute efficiency)
memory floor  = bytes / (published HBM byte/s × memory efficiency)
modeled time  = max(compute floor, memory floor)   # with overlap on
```

The default efficiency factors are 55% for compute and 72% for HBM. They are assumptions, not measured results. Prefill prices dense work only for the uncached prompt suffix while its attention queries still see the full cached-plus-new context. With chunked prefill enabled, `max-num-batched-tokens` divides that suffix into scheduler iterations and Seymour prices one model-weight stream per iteration. Decode counts one weight stream per step plus the KV read for every active sequence. Time to first token is the prefill floor plus one decode iteration; the modeled response floor adds one decode iteration per requested output token.

The HBM reservation control is modeled as the serving runtime’s usable share of physical HBM, not as a change to the GPU. When model weights plus KV cache exceed that budget, Seymour places the overflow in host memory and prices its traffic over PCIe separately. Prefix reuse only removes prompt work when automatic prefix caching is enabled.

Framework mappings remain documented without controlling the teaching model. In vLLM, for example, admission width maps to `--max-num-seqs`, token work to `--max-num-batched-tokens`, HBM reservation to `--gpu-memory-utilization`, and KV representation to `--kv-cache-dtype`. Other serving stacks expose the same underlying decisions through different APIs.

Weight and KV format controls change storage and traffic bytes only. Seymour deliberately keeps the published dense FP16 compute ceiling instead of inventing format-specific kernel speedups. The fused attention schedule keeps the score/probability intermediate on chip; the separate schedule counts four HBM crossings per layer: score write, softmax read, probability write, and probability read by PV. That choice updates both the whole-model roofline and the selected-operation kernel microscope.

The per-operation microscope is also analytical. It uses a visible 5 µs launch assumption and two resident workgroups per SM/CU. Unit coverage answers how many SMs/CUs receive at least one workgroup in the first scheduling wave; resident-slot occupancy answers how full those two assumed slots are. Each algorithm step declares its logical tensor footprint separately from the read/write bytes that cross the modeled HBM boundary, so a fused attention score matrix can remain on chip while a separate schedule exposes the additional traffic. HBM and compute phases use the same efficiency factors as the roofline. On-chip staging and barrier ordering are shown but not assigned invented bandwidth or latency. User-triggered highlights are explanatory; the schedule position and displayed durations carry the quantitative claim.

The instruction names are architecture-specific reference atoms, not a claim that a particular framework or compiler will emit that exact opcode for every workload:

- Hopper matrix work uses the documented 128-thread warpgroup form of `wgmma.mma_async.sync.aligned`; vector/reduction operations remain warp-level.
- CDNA 3 matrix work uses a `v_mfma_f32_16x16x16_f16` reference form with a 64-lane wavefront; vector/reduction operations remain wavefront-level.

Sources:

- [NVIDIA H100 product specifications](https://www.nvidia.com/en-us/data-center/h100/)
- [AMD Instinct MI300X specifications](https://www.amd.com/en/products/accelerators/instinct/mi300/mi300x.html)
- [Meta Llama 3.1 8B configuration](https://huggingface.co/meta-llama/Llama-3.1-8B/blob/main/config.json)
- [vLLM engine arguments](https://docs.vllm.ai/en/v0.17.0/configuration/engine_args/)
- [NVIDIA CUTLASS WGMMA programming guide](https://docs.nvidia.com/cutlass/4.5.2/media/docs/pythonDSL/mma_docs/wgmma_programming.html)
- [NVIDIA Hopper tuning guide](https://docs.nvidia.com/cuda/pdf/Hopper_Tuning_Guide.pdf)
- [AMD ROCm GPU architecture specifications](https://rocm.docs.amd.com/en/docs-6.0.2/reference/gpu-arch/gpu-arch-spec-overview.html)
- [AMD HIP hardware implementation: MFMA](https://rocm.docs.amd.com/projects/HIP/en/develop/understand/hardware_implementation.html)

## Structure

```text
src/data/            cited hardware and model profiles
src/model/           deterministic analytical model and tests
src/visualization/   Three.js scene and camera API
src/ui/              accessible supporting visualizations
public/assets/       original project artwork
```

The important seam is `SeymourScene`: the overlay controls, unified request/operation timeline, and direct exploration all update the same settings object, model result, and camera API. Playback never owns a parallel visualization or calculation.

## Deploy to GitHub Pages

The included workflow builds and publishes on pushes to `main` to <https://plainsight-systems.github.io/seymour/>. In the repository settings, choose **GitHub Actions** as the Pages source. No server, API key, or runtime configuration is required.

## Licensing

Seymour follows the Plainsight split license:

- Source code and configuration are licensed under the [Apache License 2.0](LICENSE-CODE).
- Prose, explanatory content, and original visual assets—including the README illustration—are licensed under [Creative Commons Attribution 4.0 International](LICENSE-CONTENT).

The project’s name and identity do not grant trademark rights. The README illustration is original project artwork and does not reproduce film stills, posters, characters, or actor likenesses.
