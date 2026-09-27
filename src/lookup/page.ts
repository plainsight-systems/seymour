import './lookup.css';

interface LookupCell { term: string; href: string; note: string }
interface LookupRow { concept: string; question: string; cells: [LookupCell, LookupCell, LookupCell, LookupCell] }

const rows: LookupRow[] = [
  {
    concept: 'Take many token steps together', question: 'Execution · how much parallel work is exposed?',
    cells: [
      { term: 'max-num-seqs', href: 'https://docs.vllm.ai/en/latest/configuration/engine_args.html', note: 'Caps sequences in one iteration.' },
      { term: 'max-running-requests', href: 'https://docs.sglang.ai/advanced_features/server_arguments.html', note: 'Bounds active request scheduling.' },
      { term: 'in-flight batching', href: 'https://nvidia.github.io/TensorRT-LLM/reference/memory.html', note: 'Schedules requests while KV space remains.' },
      { term: '--parallel + --cont-batching', href: 'https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md', note: 'Controls slots and dynamic batching.' },
    ],
  },
  {
    concept: 'Limit prompt work admitted per step', question: 'Execution · how long can prompt work occupy the machine?',
    cells: [
      { term: 'max-num-batched-tokens', href: 'https://docs.vllm.ai/en/latest/configuration/engine_args.html', note: 'Token budget for a scheduling iteration.' },
      { term: 'chunked-prefill-size', href: 'https://docs.sglang.ai/advanced_features/server_arguments.html', note: 'Maximum prompt chunk size.' },
      { term: 'maxNumTokens', href: 'https://nvidia.github.io/TensorRT-LLM/reference/memory.html', note: 'Scheduler and KV-pool token budget.' },
      { term: '--ubatch-size', href: 'https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md', note: 'Physical prompt-processing batch.' },
    ],
  },
  {
    concept: 'Reuse a shared prompt', question: 'Work · which prompt operations can disappear?',
    cells: [
      { term: 'enable-prefix-caching', href: 'https://docs.vllm.ai/en/latest/configuration/engine_args.html', note: 'Reuses matching prompt blocks.' },
      { term: 'RadixAttention', href: 'https://github.com/sgl-project/sglang', note: 'Matches and reuses shared prefixes.' },
      { term: 'enableBlockReuse', href: 'https://nvidia.github.io/TensorRT-LLM/advanced/kv-cache-reuse.html', note: 'Commits reusable KV blocks.' },
      { term: '--cache-prompt / --cache-reuse', href: 'https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md', note: 'Retains and matches prompt state.' },
    ],
  },
  {
    concept: 'Store model weights in fewer bits', question: 'Traffic · which model bytes stop crossing memory?',
    cells: [
      { term: 'quantization', href: 'https://docs.vllm.ai/en/latest/configuration/engine_args.html', note: 'Selects supported weight formats.' },
      { term: 'quantization', href: 'https://github.com/sgl-project/sglang/tree/main/docs/docs/advanced_features', note: 'Loads supported quantized checkpoints.' },
      { term: 'QuantConfig', href: 'https://nvidia.github.io/TensorRT-LLM/latest/features/quantization.html', note: 'Configures weight and activation formats.' },
      { term: 'GGUF quantization', href: 'https://github.com/ggml-org/llama.cpp/blob/master/docs/build.md', note: 'Model files encode the selected format.' },
    ],
  },
  {
    concept: 'Store KV in fewer bits', question: 'Traffic + Placement · how large is each cached token?',
    cells: [
      { term: 'kv-cache-dtype', href: 'https://docs.vllm.ai/en/latest/configuration/engine_args.html', note: 'Selects the runtime KV format.' },
      { term: 'kv-cache-dtype', href: 'https://github.com/sgl-project/sglang/blob/main/docs/docs/advanced_features/quantized_kv_cache.mdx', note: 'Supports documented FP8 and FP4 formats.' },
      { term: 'KvCacheConfig(dtype)', href: 'https://nvidia.github.io/TensorRT-LLM/latest/features/quantization.html', note: 'Selects FP8 or supported KV formats.' },
      { term: '--cache-type-k / --cache-type-v', href: 'https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md', note: 'Sets key and value cache types.' },
    ],
  },
  {
    concept: 'Park idle KV away from the GPU', question: 'Placement · is restore cheaper than rebuilding the prompt?',
    cells: [
      { term: 'KV cache offloading', href: 'https://docs.vllm.ai/en/latest/features/kv_offloading_usage/', note: 'Uses a secondary connector-backed tier.' },
      { term: 'HiCache', href: 'https://github.com/sgl-project/sglang/tree/main/docs/docs/advanced_features', note: 'Extends reusable KV beyond GPU memory.' },
      { term: 'host offloading / cache connector', href: 'https://nvidia.github.io/TensorRT-LLM/advanced/kv-cache-reuse.html', note: 'Moves reusable blocks to host memory.' },
      { term: '--cache-ram / idle-slot cache', href: 'https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md', note: 'Retains idle prompt state in a RAM cache.' },
    ],
  },
];

interface StackEntry { name: string; what: string; concepts: string; sources: { label: string; href: string }[] }

// Where the portable concepts live below and beside the frameworks: the AMD
// Instinct software stack and the KV-cache tiering projects. Claims are
// limited to what each cited page states.
const stack: StackEntry[] = [
  {
    name: 'ROCm', what: 'AMD’s open GPU software platform for Instinct accelerators: drivers, compilers, libraries, and profilers.',
    concepts: 'Everything below the serving framework on AMD hardware.',
    sources: [{ label: 'ROCm documentation', href: 'https://rocm.docs.amd.com/' }],
  },
  {
    name: 'AITER', what: 'AI Tensor Engine for ROCm: AMD’s operator library of attention, MoE, GEMM, normalization, and quantization kernels, integrated into vLLM and SGLang.',
    concepts: 'Fused attention (scores stay on chip) · low-precision matrix math · MoE expert kernels.',
    sources: [{ label: 'ROCm/aiter', href: 'https://github.com/ROCm/aiter' }],
  },
  {
    name: 'ATOM', what: '“AiTer Optimized Model”: AMD’s own inference stack built on AITER kernels, used to publish reference implementations; proposed to vLLM as a model-implementation backend for AMD GPUs.',
    concepts: 'A clean reference for what the kernels can reach before framework integration.',
    sources: [{ label: 'ROCm/ATOM', href: 'https://github.com/ROCm/ATOM' }, { label: 'vLLM RFC #33478', href: 'https://github.com/vllm-project/vllm/issues/33478' }],
  },
  {
    name: 'LMCache', what: 'A KV-cache layer that moves reusable KV out of GPU memory into CPU memory or storage and can share it across serving instances.',
    concepts: 'Park idle KV away from the GPU · restore versus rebuild.',
    sources: [{ label: 'LMCache: offload KV to CPU', href: 'https://docs.lmcache.ai/getting_started/quickstart/offload_kv_cache.html' }],
  },
  {
    name: 'Mooncake', what: 'A KV-cache transfer engine and distributed store; vLLM uses it to move KV between GPUs and to share cached prefixes across instances.',
    concepts: 'Distance is speed · separating prompt work from token generation (not modeled in the story).',
    sources: [{ label: 'vLLM MooncakeStoreConnector', href: 'https://docs.vllm.ai/en/stable/features/mooncake_store_connector_usage/' }, { label: 'Mooncake', href: 'https://kvcache-ai.github.io/Mooncake/' }],
  },
];

const root = document.querySelector<HTMLElement>('#route-root');
if (!root) throw new Error('Missing #route-root');

root.innerHTML = `<div class="lookup-page"><header class="lookup-hero"><div><p>Concept lookup</p><h1>Learn the idea.<br><em>Then find its name.</em></h1></div><p>Serving stacks expose similar levers under different flags, APIs, and product terms. Start from the cost you intend to change; use this table only after the concept is clear.</p></header>
  <section class="lookup-table" aria-labelledby="lookup-title"><h2 id="lookup-title">One concept, four implementations</h2><div class="lookup-grid" role="table" aria-label="Inference optimization concepts mapped to framework terminology"><div class="lookup-row lookup-head" role="row"><b role="columnheader">Portable concept</b><b role="columnheader">vLLM</b><b role="columnheader">SGLang</b><b role="columnheader">TensorRT-LLM</b><b role="columnheader">llama.cpp</b></div>${rows.map((row) => `<article class="lookup-row" role="row"><header role="rowheader"><strong>${row.concept}</strong><small>${row.question}</small></header>${row.cells.map((cell) => `<div role="cell"><a href="${cell.href}">${cell.term} ↗</a><p>${cell.note}</p></div>`).join('')}</article>`).join('')}</div></section>
  <section class="lookup-stack" aria-labelledby="stack-title"><h2 id="stack-title">Below and beside the frameworks</h2><p>The same concepts, one layer down on AMD Instinct, and in the projects that treat KV cache as its own data tier.</p><div class="lookup-stack-grid">${stack.map((entry) => `<article><h3>${entry.name}</h3><p>${entry.what}</p><p class="lookup-stack-concepts"><b>Concepts:</b> ${entry.concepts}</p><ul>${entry.sources.map((source) => `<li><a href="${source.href}">${source.label} ↗</a></li>`).join('')}</ul></article>`).join('')}</div></section>
  <footer class="lookup-footer"><p>Names and defaults change. The four durable questions are: what work disappears, what traffic disappears, where state must live, and whether execution exposes enough parallel work.</p><a href="#/">Return to the story →</a></footer></div>`;
