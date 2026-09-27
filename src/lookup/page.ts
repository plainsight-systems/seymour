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

const root = document.querySelector<HTMLElement>('#route-root');
if (!root) throw new Error('Missing #route-root');

root.innerHTML = `<div class="lookup-page"><header class="lookup-hero"><div><p>Concept lookup</p><h1>Learn the idea.<br><em>Then find its name.</em></h1></div><p>Serving stacks expose similar levers under different flags, APIs, and product terms. Start from the cost you intend to change; use this table only after the concept is clear.</p></header>
  <section class="lookup-table" aria-labelledby="lookup-title"><h2 id="lookup-title">One concept, four implementations</h2><div class="lookup-grid" role="table" aria-label="Inference optimization concepts mapped to framework terminology"><div class="lookup-row lookup-head" role="row"><b role="columnheader">Portable concept</b><b role="columnheader">vLLM</b><b role="columnheader">SGLang</b><b role="columnheader">TensorRT-LLM</b><b role="columnheader">llama.cpp</b></div>${rows.map((row) => `<article class="lookup-row" role="row"><header role="rowheader"><strong>${row.concept}</strong><small>${row.question}</small></header>${row.cells.map((cell) => `<div role="cell"><a href="${cell.href}">${cell.term} ↗</a><p>${cell.note}</p></div>`).join('')}</article>`).join('')}</div></section>
  <footer class="lookup-footer"><p>Names and defaults change. The four durable questions are: what work disappears, what traffic disappears, where state must live, and whether execution exposes enough parallel work.</p><a href="#/">Return to the story →</a></footer></div>`;
