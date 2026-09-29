<p align="center">
  <img src="public/assets/seymour-readme.png" alt="An original screenprint-style illustration of a technician carrying memory blocks from a GPU rack to a hungry computing plant." width="100%" />
</p>

# Seymour

**A visual, quantitative introduction to the costs that shape LLM inference.**

**Live demo:** <https://plainsight-systems.github.io/seymour/>

Seymour teaches performance computing from the software engineer's point of view. It starts with five portable ideas—work, traffic, placement, capacity, and parallel execution—then shows where serving systems expose the corresponding optimizations. Every number comes from one deterministic first-order model; concepts the model does not calculate are labeled **not modeled**.

The name is for Seymour Cray, by way of the idea that a GPU is a hungry plant: the math units are the mouth, and the memory hierarchy has to keep bringing food.

## The experience

The static site has three routes in one GitHub Pages build:

| Route | Purpose |
| --- | --- |
| `#/` | The six-panel story and optimization playground |
| `#/under-the-hood` | The full request lifecycle, transformer operations, kernel schedules, SIMD/SIMT lanes, and Three.js hardware cutaway |
| `#/lookup` | Portable optimization concepts mapped to vLLM, SGLang, TensorRT-LLM, and llama.cpp terminology, plus the AMD Instinct stack (ROCm, AITER, ATOM) and KV-tiering projects (LMCache, Mooncake) |

Old query-string share links still open Under the hood with their selected state.

### The six-panel story

The story shows the chip. Each panel pairs one knob with an isometric cutaway plate—server, package, die, or compute unit—drawn from published topology and driven by the same model:

1. **Two different jobs** — two copies of the die: prompt processing lights nearly every SM with math, while generating a token leaves almost all of them waiting on memory.
2. **Every token re-reads the model** — the package's memory stacks fill with the model's weights, and every generated token reads all of them.
3. **Share the read** — as users share one read, more of the die's time goes to math.
4. **Memory fills up** — KV state fills the stacks until it hits the capacity wall and overflows off the package.
5. **Distance is speed** — on the server plate, the KV cache's data path lights up from GPU memory out to one peer GPU, all seven peers, system memory, local SSD, or object storage; active state needs to stay near the math, and idle state may be worth parking farther away when restore beats recompute. Switched NVLink gives one peer the full per-GPU bandwidth, while a directly linked AMD platform reaches one peer over one link and all seven together.
6. **Change what one read buys** — a mixture-of-experts model (Qwen3 30B-A3B) reads only the experts its tokens touch, so the discount fades as users share the step; speculative decoding turns one read into several tokens on a dense model but gains little on MoE at one user, because checking guesses touches more experts.

Every panel can switch between NVIDIA H100 SXM, H200 SXM, and AMD MI300X, MI325X, and MI355X. Modeled moves are toggles the reader can apply (8-bit KV, shared-prompt reuse, FP8 math, speculation), and each panel describes what its concept looks like in a profiler trace alongside the model's own math and memory busy shares.

Click any part to highlight its label, or any label to highlight the part. Plates are stylized and not to scale; counts and arrangement follow NVIDIA's and AMD's published documents, and every label is marked as a published figure, a representative figure, or a schematic placement.

Each panel has one real knob, a computed surprise, and a list of engineering moves clearly marked as modeled or not modeled. The story deliberately introduces plain-language costs before hardware and framework vocabulary.

### Playground and challenges

The playground combines the story's knobs and lets the reader zoom through all four plates on either accelerator, including a follow-one-tile path from memory to the matrix units: concurrent users, context length, model and KV precision, shared-prefix reuse, active-KV placement, and accelerator choice. Its bottleneck readout always answers one of four durable questions:

- **Work:** what calculation can disappear?
- **Traffic:** what bytes can stop moving?
- **Placement:** where must active or idle state live?
- **Execution:** is enough parallel work exposed?

Six tested challenges in Act 4 make the reader prove the model: a busy chatbot, a long-document workload, an object-storage proposal, a code assistant, a mixture-of-experts model on one GPU, and picking the chip. Each fixes a workload and targets, starts from an obvious attempt that fails, and exposes only the knobs it allows. Each also states what every passing answer must do, and a test searches every allowed setting to prove the lesson never claims more than the challenge demands. Acts 1–3 end with their own challenges: rebuilding the GPU, finding the bottleneck of one forward pass, and picking the throttle that helps most.

### Under the hood

The deeper route preserves the original machinery for readers who want to inspect one inference step in detail:

- a complete request lifecycle from admission and prefix lookup through prefill, first token, repeated decode, streaming, and cache release;
- a 12-operation transformer path with equations, live tensor shapes, FLOPs, and boundary bytes;
- named reference kernels, grid/workgroup shapes, launch and memory schedules, modeled SM/CU utilization, and lane-level WGMMA or MFMA views;
- a canonical hardware map plus an optional Three.js cutaway spanning host memory, PCIe, accelerator package, HBM, caches, compute units, registers, and matrix/vector units;
- red warnings for the currently limiting boundary and for capacity overflow into slower system memory.

Seymour uses **kernel**, the standard ML/HPC term for the GPU program being dispatched. Readers coming from graphics can think of it as a compute-shader-like program specialized for tensor and vector work.

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

The production output is entirely static in `dist/`. Vite uses relative asset paths, so the same build works at the GitHub Pages project URL or a custom domain.

## Modeling contract

Seymour is an analytical teaching model, not a benchmark, profiler, or cycle-accurate simulator. For each state it computes lower bounds:

```text
compute floor = FLOPs / (published peak FLOP/s × compute efficiency)
memory floor  = bytes / (published HBM byte/s × memory efficiency)
modeled time  = max(compute floor, memory floor)   # when overlap is enabled
```

The visible default assumptions are 55% of published compute peak and 72% of published HBM bandwidth, applied identically to every accelerator so comparisons reflect published peaks rather than measured efficiency. Weight and KV formats change storage and traffic bytes; FP8 matrix math uses the published dense FP8 peak only when weights are 8-bit or smaller. MXFP4 math is not modeled. On-chip tiers show published capacity but no invented bandwidth.

Mixture-of-experts steps read shared weights plus the experts their tokens touch, assuming uniform independent routing (real routers are skewed, which touches fewer experts at mid-size batches). Speculative decoding verifies k guessed tokens plus one per sequence in a single weight pass and yields (1 − a^(k+1)) / (1 − a) tokens on average with an assumed 70% acceptance; drafting cost is not modeled. The playground's response timing prices decode at the answer's midpoint context.

Prompt processing prices dense work for the uncached suffix while its attention queries still see the full cached-plus-new context. Attention is causal: each prompt token is scored only against itself and earlier tokens, so with the fused kernel (which skips masked blocks) a prompt's attention math is about half the full token-by-token grid; the separate schedule computes the full grid and masks afterwards. Token generation counts one model-weight stream per step plus the KV read for every active sequence. Shared-prefix reuse removes prompt work only when a matching prefix is already available.

Active KV placement can be moved among GPU memory, system memory, a peer GPU, local SSD, and network object storage. GPU and peer figures come from published profiles; farther tiers use visibly labeled representative values. The model also compares the cost of restoring one idle session with recomputing its prompt, which is the important distinction behind legitimate KV offloading.

If model weights plus GPU-resident KV exceed the serving memory budget, the overflow is shown in red and priced over the one-direction PCIe link. Fused attention keeps its score/probability intermediate on chip; the separate schedule counts its additional HBM crossings.

The execution microscope is analytical too. It uses a visible 5 µs launch assumption and two resident workgroups per SM/CU. Unit coverage estimates how many units receive a workgroup in the first scheduling wave; it is not telemetry.

## Sources

Core hardware, model, and memory-distance inputs are linked in the interface and derived from:

- [NVIDIA H100 product specifications](https://www.nvidia.com/en-us/data-center/h100/)
- [NVIDIA Hopper tuning guide](https://docs.nvidia.com/cuda/pdf/Hopper_Tuning_Guide.pdf)
- [NVIDIA H100 Tensor Core GPU Architecture whitepaper](https://resources.nvidia.com/en-us-hopper-architecture/nvidia-h100-tensor-c) (cutaway unit, cluster, and memory-stack counts)
- [NVIDIA HGX reference architecture](https://docs.nvidia.com/enterprise-reference-architectures/hgx-ai-factory-h100-h200-b200/latest/components.html)
- [AMD Instinct MI300X specifications](https://www.amd.com/en/products/accelerators/instinct/mi300/mi300x.html)
- [AMD ROCm: MI300 series microarchitecture](https://rocm.docs.amd.com/en/latest/reference/gpu-arch/mi300.html) and [GPU architecture specifications](https://rocm.docs.amd.com/en/latest/reference/gpu-arch-specs.html) (cutaway die and cache counts)
- [Chips and Cheese: AMD’s CDNA 3 compute architecture](https://chipsandcheese.com/p/amds-cdna-3-compute-architecture)
- [AMD MI300X platform data sheet](https://www.amd.com/content/dam/amd/en/documents/instinct-tech-docs/data-sheets/amd-instinct-mi300x-platform-data-sheet.pdf)
- [Meta Llama 3.1 8B configuration](https://huggingface.co/meta-llama/Llama-3.1-8B/blob/main/config.json)
- [Samsung data-center SSD specifications](https://semiconductor.samsung.com/ssd/datacenter-ssd/)
- [Amazon S3 performance design patterns](https://docs.aws.amazon.com/AmazonS3/latest/userguide/optimizing-performance.html)
- [NVIDIA CUTLASS WGMMA programming guide](https://docs.nvidia.com/cutlass/4.5.2/media/docs/pythonDSL/mma_docs/wgmma_programming.html)
- [AMD HIP hardware implementation: MFMA](https://rocm.docs.amd.com/projects/HIP/en/develop/understand/hardware_implementation.html)

The Concept lookup route cites the current documentation for each framework term it displays.

## Structure

```text
src/data/             cited hardware, model, and memory-tier data
src/model/            deterministic analytical model and tests
src/story/            concept panels, cutaway plates, playground, and challenges
src/lookup/           cited framework-term lookup
src/visualization/    Three.js hardware scene and camera API
src/ui/               Under-the-hood supporting visualizations
docs/design/          approved product and implementation plan
public/assets/        original project artwork
```

## Deploy to GitHub Pages

The included workflow builds and publishes pushes to `main` at <https://plainsight-systems.github.io/seymour/>. In the repository settings, choose **GitHub Actions** as the Pages source. No server, API key, or runtime configuration is required.

## Licensing

Seymour follows the Plainsight split license:

- Source code and configuration are licensed under the [Apache License 2.0](LICENSE-CODE).
- Prose, explanatory content, and original visual assets—including the README illustration—are licensed under [Creative Commons Attribution 4.0 International](LICENSE-CONTENT).

The project's name and identity do not grant trademark rights. The README illustration is original project artwork and does not reproduce film stills, posters, characters, or actor likenesses.
