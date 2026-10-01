<p align="center">
  <img src="public/assets/seymour-readme.png" alt="An original screenprint-style illustration of a technician carrying memory blocks from a GPU rack to a hungry computing plant." width="100%" />
</p>

# Seymour

**Your GPU is starving. Come find out why.**

**Live demo:** <https://plainsight-systems.github.io/seymour/>

A modern GPU can do roughly a quadrillion math operations a second, and when it serves an LLM it spends much of its time doing nothing: waiting for bytes to show up from memory. Seymour is a hands-on tour of why. Take the chip apart, push a token through the model, pull the throttles, then try to hit real serving targets without blowing the memory budget.

It's built for software engineers, hardware and software together, and it keeps you honest: every number comes from one small, deterministic model you can read, and anything that model doesn't calculate is stamped **not modeled** right where you see it.

## The experience

The static site has three routes in one GitHub Pages build:

| Route | Purpose |
| --- | --- |
| `#/` | The story, in four acts |
| `#/lookup` | Portable optimization concepts mapped to vLLM, SGLang, TensorRT-LLM, and llama.cpp terminology, plus the AMD Instinct stack (ROCm, AITER, ATOM) and KV-tiering projects (LMCache, Mooncake) |
| `#/game` | **Seymour — The Game**, a five-shift, NES-inspired lunch rush where real workload constraints decide whether each serving configuration passes |

The story is four acts stacked down the page, each a screen tall, each a row of scene tabs. One accelerator is chosen for the whole story (NVIDIA H100 SXM, H200 SXM, or AMD MI300X, MI325X, MI355X) and every number follows it. Every scene has an address (`#act-2/attention`), so any scene can be linked.

### Act 1 · The GPU

The chip at four zoom levels (server, package, die, compute unit), drawn as isometric cutaway plates from published topology. Click a part, or a term such as HBM or Tensor Core, to see what it is called, what it does, and why it matters for inference. Plates are stylized and not to scale; counts and arrangement follow NVIDIA's and AMD's published documents, and every label says whether it rests on a published figure, a representative figure, or a schematic placement. The act ends with a challenge: put the package and the die back together by dragging each part onto its outline.

### Act 2 · Inference

One forward pass of Llama 3.1 8B, stage by stage: text to tokens on the CPU, embed, attention, MLP, un-embed, softmax and sampling on the GPU, and back to text. A request runs these stages once over the whole prompt (the first pass), then once per new token (every later pass); each stage shows both side by side, with its math, bytes, time floors, and what limits it. The act ends with a challenge: for five workloads, name the slowest stage and whether math or memory limits it.

### Act 3 · The throttles

How each stage changes with the choices you make, and which part of the chip it runs into: every token re-reads the model, share the read, memory fills up, distance is speed (where the KV cache lives, from GPU memory to object storage), and change what one read buys (mixture of experts and guessing tokens ahead). Each panel has one knob, a computed surprise, the moves that change it (modeled ones are switches; the rest are marked not modeled), and what the concept looks like in a profiler trace. The act ends with a challenge: for five stuck workloads, pick the one throttle that helps most.

### Act 4 · Putting it together

Six challenges with fixed workloads and targets: a busy chatbot, a long document, an object-storage proposal, a code assistant, a mixture-of-experts model on one GPU, and picking the chip. Each offers every throttle, starts from an obvious attempt that fails, and is built for the chosen chip: its workload and targets come from that chip's own numbers, so every chip gets the same puzzle. Then the playground: every knob at once, on any chip.

### How the challenges stay honest

Every answer comes from the model, never typed in. Each challenge states what every passing answer must do, and a test searches every combination of choices on every chip to prove the lesson never claims more than the challenge demands (Acts 2 and 3 also require a clear winner, so no answer is a coin flip).

### Seymour — The Game

Plants arrive with workload tickets instead of lunch orders. Configure model precision, math precision, prefix reuse, KV precision, and memory placement to satisfy each plant before its patience runs out. The same deterministic model used by the story evaluates every order; missed capacity targets, slower memory tiers, and blown fuses are consequences of the modeled system rather than trivia answers.

Five authored shifts introduce one idea at a time, then unlock an endless lunch rush. The game is desktop-first, fully pausable, playable with pointer or keyboard, and saves campaign progress locally. Its approved product and interaction brief lives at [`docs/design/seymour-game.md`](docs/design/seymour-game.md).

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

The Concept lookup route cites the current documentation for each framework term it displays.

## Structure

```text
src/data/             cited hardware, model, memory-tier, topology, and part-glossary data
src/model/            deterministic analytical model (whole step, per operation, forward pass) and tests
src/story/            the four acts: page wiring, cutaway plates, scene modules, challenges
src/lookup/           cited framework-term lookup
src/game/             game rules, authored shifts, canvas scene, sound, persistence, and tests
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

<sub>Feed me, Seymour.</sub>
