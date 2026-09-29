# Design: Concept Panels

> **Status (2026-09-29):** superseded by [four-acts.md](four-acts.md). The Under the hood route this plan preserved has since been removed; references to it below are historical.

**Status:** Approved direction, ready to execute
**Change class:** Architectural (information architecture + model inputs), executed in phases
**Owner:** Andy Hunter · **Executor:** Sol
**Date:** 2026-09-27

This document is self-contained. An executor should be able to carry out every step without the conversation that produced it. Where a decision is still open, a default is given; take the default unless it proves wrong, and record why if you deviate.

---

## 1. Problem

Seymour is accurate but impenetrable.

Facts observed in the running app (localhost:5173, commit `f55c1c0`):

- The main page stacks 8 lifecycle stages × 12 transformer operations, each with its own Start / Step / Step player, plus a 5-level machine map, a kernel microscope, a 3D view, a roofline, a memory hierarchy list, and fine print. The intro sentence is repeated twice in a row.
- Hardware vocabulary (HBM, SM/CU, LDS, "ridge 226 FLOP/byte") arrives before the plain-language claim it supports.
- The memory hierarchy list ("Nearer is faster. Farther is larger.") has no capacities or bandwidths, so the reader cannot see the order-of-magnitude cliffs between levels.
- The most important insight is buried: at batch 64 decode, the stat strip shows **16.1 GB of weights + 34.4 GB of KV** read per step. KV traffic is 2× the model. That fact explains paging, prefix reuse, KV quantization, and GQA, and it sits in small type.
- Controls are framework configuration in disguise: "token-work budget", "HBM reserved for serving", "split long prefills" are vLLM's `max_num_batched_tokens`, `gpu_memory_utilization`, `enable_chunked_prefill`. The overfit reaches into the model layer: `SimulationSettings` has fields literally named `maxNumBatchedTokens` and `gpuMemoryUtilization` (`src/types.ts`).
- The strongest idea on the page, the four questions (Work / Traffic / Placement / Execution), is a static sidebar that nothing else uses.

## 2. Audience

A senior engineer who understands inference at the model level (tokens, attention, KV cache as a concept) but:

- has not studied serving-harness optimization, and
- has not looked at modern GPU hardware, if at all. "HBM" means nothing yet.

Calibration example: a public thread seriously debated "what about moving the KV cache to S3". The reader we are writing for could plausibly have asked that. After Seymour they should be able to explain, with numbers, why that fails for active decode and when a version of it is legitimate (parking idle sessions).

**Goal:** demonstrate *our* understanding of GPU inference optimization through clear explanation. Knobs are **conceptual**, so an engineer who understands them can then find the equivalent in vLLM, SGLang, TensorRT-LLM, llama.cpp, or a design of their own.

## 3. Decisions (made; do not relitigate)

| # | Decision |
|---|---|
| D1 | The main experience is **five concept panels, stacked**, each with **one knob**, followed by a **playground**. |
| D2 | All panels share **one visualization that gains a layer per panel** (information stays centered; by the playground the reader already knows how to read every part). |
| D3 | **Five** panels: prefill vs. decode is panel 0. |
| D4 | **Challenges are in scope** for the playground. |
| D5 | **No framework names in the main story.** Concepts only. Framework names live on a separate concept-lookup page that the story never links into mid-panel. |
| D6 | The current deep experience (12 operations, kernel microscope, WGMMA/MFMA lanes, 3D cutaway, machine map) is preserved on an **Under the hood** page, not deleted. |
| D7 | Hash routes in one static build: `#/` (story), `#/under-the-hood`, `#/lookup`. Must keep working on GitHub Pages with Vite `base: './'`. |
| D8 | Tiers beyond the GPU (NVLink peer, local SSD, network/object storage) may use **labeled, sourced, representative order-of-magnitude values**, never presented as precise specs. |
| D9 | This plan lives in the repo (this file). |

## 4. Invariants (must remain true throughout)

1. **The model layer stays deterministic and pure.** `src/model/**` has no DOM, time, or randomness. Every number on screen comes from it.
2. **No facades.** A knob only exists if the model computes its effect. Concepts the model does not compute (e.g. paging reducing fragmentation) appear as text explicitly marked *not modeled* and are never used to make a challenge solvable.
3. **On-chip tiers get no invented bandwidth.** Registers, shared memory/LDS, and L2 show published capacities only; their speed is described qualitatively. (This matches the current model's stance.)
4. **Existing published hardware facts and their sources are unchanged** unless a correction is made as its own, declared change.
5. **Every share URL keeps working.** Old query-string URLs (`?phase=…&batch=…`) resolve to the Under the hood page with the same state.
6. **Accessibility and phone width.** Every panel works at 375 px wide with no horizontal scroll, and every knob is keyboard-operable with a visible label.

## 5. Non-goals

- No new hardware or model profiles.
- No benchmark claims, measured numbers, or quantized-kernel speedups (the model keeps the dense FP16 compute ceiling; precision changes bytes only).
- No framework-specific behavior in the model.
- No redesign of the Under the hood page beyond moving it and fixing listed bugs.

---

## 6. Information architecture

```
#/                 Story
                   ├─ Panel 0  Two different jobs          (knob: prompt length)
                   ├─ Panel 1  Every token re-reads it all (knob: model precision)
                   ├─ Panel 2  Share the read              (knob: concurrent users)
                   ├─ Panel 3  Memory fills up             (knob: context length)
                   ├─ Panel 4  Distance is speed           (knob: where the KV cache lives)
                   └─ Playground + challenges              (all knobs, readout, challenges)
#/under-the-hood   Current deep experience, moved intact
#/lookup           Concept → names in serving frameworks
```

A small persistent nav links the three pages. The story ends with one line pointing to Under the hood ("see what happens inside one step") and one to Lookup ("find these ideas in the framework you use").

## 7. The shared picture

One component, rendered in every panel and the playground. Each panel reveals one more layer; earlier layers stay visible.

```
 GPU MEMORY (what fits)              ONE STEP (what it costs)
┌────────────────────────────┐      reading  ████████████████░░  6.9 ms
│ model ██████               │      math     █░░░░░░░░░░░░░░░░░  0.3 ms
│ KV    ░░░░░░░░             │      → the math units wait on memory
│ free                       │
└────────────────────────────┘      per user: 145 tok/s · total: 145 tok/s
                                     [panel 4 adds the distance ladder below]
```

| Layer | Introduced in | Shows |
|---|---|---|
| **Step cost** | Panel 0 | Two bars: time to read bytes vs. time to do math. The longer one is labeled as the limit. Prefill and decode shown side by side. |
| **Model block** | Panel 1 | The model's bytes inside the GPU memory box. |
| **Throughput** | Panel 2 | Tokens/s per user and total. |
| **KV block + wall** | Panel 3 | The KV block growing inside the memory box; the capacity wall; what happens past it. |
| **Distance ladder** | Panel 4 | The tiers from §9 with capacity and bandwidth; where the KV cache currently lives; bandwidth needed vs. available. |

**Implementation shape:**

- `src/story/picture/model.ts`: pure `buildPictureModel(result, settings, hardware, model) → PictureModel`. All numbers and labels are derived here. Unit-tested.
- `src/story/picture/render.ts`: `renderPicture(root, picture: PictureModel, layers: ReadonlySet<Layer>)`. DOM/SVG only; no calculation.

## 8. Panel specs

Every panel has the same five parts:

1. **Claim:** one sentence, no jargon.
2. **Knob:** exactly one, with a visible label and discrete stops.
3. **Picture:** the shared one, with its new layer highlighted.
4. **The surprise:** what breaks or flips at the extreme of the knob. Written so it is true for the computed numbers (derive it from the model output, don't hard-code the figure).
5. **The moves:** what engineers do about it, as concepts. Each move is tagged **modeled** (the playground has a knob for it) or **not modeled** (text only).

Each panel **resets to its own fixed defaults** when entered: H100 SXM, Llama 3.1 8B, FP16 weights and KV, fused attention, overlap on, KV in GPU memory, batch 1, 4,096-token context, unless the panel's knob changes that value. Hardware selection appears only in the playground.

Vocabulary rule: plain words first. A hardware term appears only when its panel needs it, with a one-line gloss on first use ("GPU memory, called HBM: …"). SM, L2, registers, WGMMA, MFMA appear only on Under the hood.

### Panel 0: Two different jobs

- **Claim:** Reading the prompt and writing the answer are different jobs, limited by different things.
- **Knob:** Prompt length (128 → 32K).
- **Layer:** Step cost, prefill vs. decode.
- **Surprise:** Prefill processes thousands of tokens in one step and is limited by math. Decode produces one token per step and is limited by reading memory. Per token, prefill is roughly two orders of magnitude cheaper. At current defaults the model gives ≈137 ms for 4,096 prompt tokens vs. ≈6.9 ms per decoded token; **compute the ratio from the model, don't hard-code it.**
- **Moves:** reuse a shared prompt prefix instead of recomputing it (*modeled*); split long prompts so they don't stall other users' decoding (*modeled* as chunking cost; the interference with other users is *not modeled*, so say so); run the two jobs on separate machines (*not modeled*).

### Panel 1: Every token re-reads the whole model

- **Claim:** To produce each token, the GPU reads every weight in the model from memory.
- **Knob:** Model precision (16-bit → 8-bit → 4-bit).
- **Layer:** Model block.
- **Surprise:** The math units sit mostly idle. Time per token ≈ model bytes ÷ memory speed, nearly independent of how fast the math is. Halving the bytes nearly halves the time.
- **Moves:** store weights in fewer bits (*modeled*; accuracy and kernel support are the tradeoff, *not modeled*, so say so); smaller or sparser models (*not modeled*).
- **First gloss:** "GPU memory (HBM)" and "math units".

### Panel 2: Share the read

- **Claim:** If many users take a step together, one read of the model serves all of them.
- **Knob:** Concurrent users (1 → 1,024).
- **Layer:** Throughput (per user and total).
- **Surprise:** Total throughput climbs almost for free while each user's speed barely changes, until the bottleneck flips to math or, as the next panel shows, memory fills.
- **Moves:** batch requests together (*modeled*); keep the batch full as requests arrive and finish (*not modeled*: the model is a steady-state step, not an arrival process).

### Panel 3: Memory fills up

- **Claim:** Every conversation keeps a memory of its context (the KV cache), and it takes space and must be read every step.
- **Knob:** Context length (128 → 32K). Users fixed at a panel default where the effect is visible (default: 64; confirm with the model that the wall is reachable within the knob range).
- **Layer:** KV block + capacity wall.
- **Surprise:** The KV cache overtakes the model, both in space and in bytes read per step (at 64 users × 4K context: 34.4 GB of KV vs. 16.1 GB of weights read per step). You hit a wall on capacity *and* on read speed.
- **Moves:** store KV in fewer bits (*modeled*); share KV for common prefixes (*modeled* via prefix reuse); pack KV in fixed-size blocks to avoid wasted space (*not modeled*); models that keep fewer KV heads (*not modeled*: fixed by the model profile; mention GQA 32:8 as a fact of this model).

### Panel 4: Distance is speed

- **Claim:** Where data lives decides how fast you can read it. Each step away from the math is a cliff, not a slope.
- **Knob:** Where the KV cache lives: GPU memory → host memory → peer GPU → local SSD → network/object storage.
- **Layer:** Distance ladder (§9).
- **Surprise, part 1:** At the panel default (64 users, 4K context) each decode step reads ≈34 GB of KV in ≈21 ms, which needs ≈1.6 TB/s for KV alone. Moving it one tier out multiplies step time many times; object storage makes each step take seconds. **Derive every figure from the model.**
- **Surprise, part 2 (the nuance):** Moving the KV of **idle** sessions farther away, and bringing it back when the session resumes, is legitimate and widely used. The decision is **restore vs. recompute**: is reading the parked KV back faster than re-running prefill on that context? Show both times.
- **Moves:** keep **active** state near the math (*modeled*); park **idle** state farther away and restore it on reuse (*modeled* via restore-vs-recompute, §10.3); prefetch before it's needed (*not modeled*).
- **First gloss:** "PCIe", "NVLink", each tier as it appears.

### Playground

- All knobs from panels 0–4, plus hardware choice (H100 SXM / MI300X).
- The shared picture with every layer on.
- **Bottleneck readout:** one sentence naming what currently limits the step, tagged with one of the four questions (Work / Traffic / Placement / Execution), and the lever that would help most, phrased as a concept.
- **Challenges** (§11).

## 9. Distance ladder data

New module: `src/data/memoryLadder.ts`. Each tier:

```ts
interface MemoryTier {
  id: 'registers' | 'shared' | 'l2' | 'hbm' | 'host' | 'peer' | 'ssd' | 'object';
  label: string;             // plain-language name first
  term?: string;             // hardware term, glossed on first use
  capacity: Quantity;        // bytes; from the hardware profile where it exists
  bandwidth?: Quantity;      // bytes/s; absent for on-chip tiers (invariant 3)
  firstByteLatency?: Quantity;
  basis: 'published' | 'representative';
  sourceUrl: string;
  sourceLabel: string;
}
```

| Tier | Capacity | Bandwidth | Basis |
|---|---|---|---|
| Registers, shared memory, L2 | From `HARDWARE_PROFILES` | None (qualitative only) | published |
| GPU memory (HBM) | From profile | From profile | published |
| Host memory over PCIe | Representative server DRAM (label it) | From profile `hostLinkGBs`, **see note** | published link |
| Peer GPU over NVLink / Infinity Fabric | Peer's HBM | Vendor-published GPU-to-GPU bandwidth; cite | published |
| Local NVMe SSD | Representative | Representative per-drive sequential read; cite | representative |
| Network / object storage | Effectively unbounded | Representative per-client throughput plus first-byte latency; cite | representative |

**Note on `hostLinkGBs`:** both profiles carry `128` GB/s, which matches PCIe Gen5 x16 **bidirectional**. Reading KV back is one direction (~64 GB/s). Verify against the cited sources. If it's bidirectional, correct it as its **own declared change** (it also affects the existing host-spill calculation), with a test, before step 1d builds on it.

Every representative value must render with a visible "representative" marker and a source link. Never display more than two significant figures for representative values.

## 10. Model changes

### 10.1 Rename settings to concepts (refactor, no behavior change)

| Current field | New field | URL key |
|---|---|---|
| `maxNumBatchedTokens` | `promptTokensPerStep` | unchanged (`tokenBudget`) |
| `gpuMemoryUtilization` | `servingMemoryFraction` | unchanged (`memory`) |
| `chunkedPrefill` | `splitLongPrompts` | unchanged (`chunked`) |
| `prefixCaching` | `reusePromptPrefixes` | unchanged (`prefix`) |

Also rename matching UI copy on Under the hood where it names framework concepts. URL keys stay the same so old links keep working (invariant 5). Any remaining identifiers that are vLLM names (search `max_num`, `gpu_memory`, `vllm`, `paged`) get the same treatment.

### 10.2 KV placement (feature)

Add `kvPlacement: MemoryTier['id']`, restricted to `'hbm' | 'host' | 'peer' | 'ssd' | 'object'`, default `'hbm'`.

- Decode: KV read time = KV bytes read per step ÷ that tier's effective bandwidth, plus first-byte latency where defined. Weights stay in HBM. Step time = max(compute, HBM traffic, KV-tier traffic) with overlap on; sum without overlap. Keep the existing efficiency-factor convention: HBM uses the profile's `memoryEfficiency`; other tiers use their stated value with no invented efficiency factor, and say so in the assumptions list.
- Capacity: KV placed off-GPU no longer consumes HBM capacity.
- The existing automatic host spill (when things don't fit) keeps working when `kvPlacement === 'hbm'`.
- New result fields: `kvTierId`, `kvTierMs`, `kvTierBandwidthNeeded` (bytes/s needed to keep the step at its HBM-only time).

### 10.3 Restore vs. recompute (feature)

Pure function: `restoreVsRecompute(settings, hardware, model, tier) → { restoreMs, recomputeMs, cheaper: 'restore' | 'recompute' }`.

- `restoreMs` = one sequence's KV footprint ÷ tier bandwidth + first-byte latency.
- `recomputeMs` = prefill time for that context from `calculateSimulation` with `phase: 'prefill'`, batch 1.

### 10.4 Tests required

- The rename: all existing tests pass unchanged apart from field names; an old URL parses to the same values.
- Placement: `kvPlacement: 'hbm'` reproduces current results exactly (snapshot the key fields for defaults, batch 64, and 32K context). Each farther tier is monotonically slower for the same workload. Off-GPU KV frees HBM capacity.
- Restore vs. recompute: for a long context, restore from host beats recompute; for object storage with its latency, the answer is whatever the model computes. The test pins the computed answer and asserts it is deterministic, not that it matches a preferred narrative.

## 11. Challenges

### 11.1 Engine (pure, `src/story/challenges/`)

```ts
interface Challenge {
  id: string;
  title: string;
  brief: string;                       // plain language
  fixed: Partial<SimulationSettings>;  // what the reader can't change
  adjustable: KnobId[];                // what they can
  constraints: Constraint[];
  solution: SimulationSettings;        // a known passing configuration
  naive: SimulationSettings;           // the obvious first attempt; must fail
  lesson: string;                      // shown on success; names the concepts used
}
interface Constraint {
  metric: 'msPerToken' | 'timeToFirstTokenMs' | 'totalTokensPerSec' | 'concurrentUsers' | 'fitsInGpuMemory';
  op: '<=' | '>=' | '==';
  value: number | boolean;
}
evaluateChallenge(challenge, settings) → { passed: boolean; results: { constraint, actual, met }[] }
```

### 11.2 Rules (enforced by tests, one test file per challenge)

1. `solution` passes every constraint.
2. `naive` fails at least one constraint.
3. `solution` differs from `fixed` only in `adjustable` knobs.
4. Every adjustable knob is a **modeled** knob (invariant 2).

If a challenge can't satisfy all four, it doesn't ship. Tune the constraints to the model's real numbers; never tune the model to a challenge.

### 11.3 Starting set (constraint values to be set from model output)

| Challenge | Brief | Concepts it exercises |
|---|---|---|
| **The chatbot** | Serve many users at moderate context under a per-token time limit. | Precision, batching |
| **The long document** | A few users at very long context. Make it fit and stay responsive. | KV precision, prefix reuse, capacity wall |
| **The S3 proposal** | A teammate proposes keeping the active KV cache in object storage. Try it, then find the version that works. | Placement, restore vs. recompute |

The S3 challenge passes when the reader keeps active KV in GPU memory **and** the readout shows parking idle sessions on a farther tier with restore beating recompute. Design its constraints so both halves are required.

UI: the challenge picker sits in the playground. Each unmet constraint shows actual vs. target. On success, show the `lesson`.

## 12. Concept lookup page (`#/lookup`)

A table: **concept → what each framework calls it**, for vLLM, SGLang, TensorRT-LLM, and llama.cpp. Rows correspond to the "moves" in §8. Rules:

- Every framework term is cited to that framework's docs.
- Where a framework has no equivalent, the cell says so.
- The lookup page may link back to the panel that explains each concept. Panels never link into it except for the single closing line (D5).

## 13. Known bugs to fix (on Under the hood)

Each fix is its own small change with a test.

1. **Contradictory occupancy copy:** `src/model/teaching.ts:203` always says "The remaining units are idle" even at 100% coverage. Emit the idle sentence only when `estimatedActiveUnitFraction < 1`.
2. **Two bottlenecks shown at once:** for prefill RMSNorm, the operation text says "HBM traffic is the longest priced stage" while the map highlights matrix units as "Current bottleneck" (the stage-level result). Label which scope each refers to (this operation vs. the whole step), or make the map follow the selected operation.
3. **"Open the experiment bench" resets state** to `stage=request` and opens no separate bench. This control is removed by the restructure; if Under the hood keeps a similar control, it must not discard the current stage or operation.
4. **Decode count mismatch:** "31 more iterations" vs. "× 32 tokens". Make both derive from the same value and label them consistently (first token comes from prefill; N−1 decode steps).

## 14. Execution plan

One primary intent per step. Each step is its own commit (or PR) and ends with `npm test` and `npm run build` passing. UI steps are also checked in the browser at localhost:5173 at desktop width and at 375 px.

| Step | Intent | Class | Done when |
|---|---|---|---|
| **1a** | Fix bugs §13.1, §13.2, §13.4 | Local | Each has a failing-then-passing test |
| **1b** | `hostLinkGBs` direction check (§9 note); correct only if wrong | Local | Source cited in the commit; test updated if the value changed |
| **1c** | Rename settings to concepts (§10.1) | Cross-cutting refactor | No behavior change: existing tests pass; old-URL parse test added |
| **1d** | Memory ladder data module (§9) | Local | Every tier has basis + source; tests assert on-chip tiers have no bandwidth |
| **1e** | KV placement + restore vs. recompute (§10.2–10.3) | Cross-cutting | Tests in §10.4 pass; `'hbm'` snapshot identical to pre-change output |
| **2** | Challenge engine + starting set (§11) | Local | Four rules enforced per challenge |
| **3** | Picture model + renderer (§7) | Local | `buildPictureModel` unit-tested; renderer shows each layer in isolation |
| **4** | Hash router; move current experience intact to `#/under-the-hood`; old query URLs land there | Architectural | Under the hood looks and behaves as before; old share link opens with the same state |
| **5** | Panels 0–4 at `#/` (§8) | Architectural | Each panel: claim, one knob, layer, computed surprise, tagged moves; copy lint passes |
| **6** | Playground + readout + challenge UI | Local | All three challenges completable in the browser; naive attempts fail visibly |
| **7** | Concept lookup page (§12) | Local | Every framework term cited |
| **8** | README update; remove leftovers from the old main page | Local | README describes the story/under-the-hood/lookup split and still carries the live URL |

**Copy lint (added in step 5):** a test that scans story-page copy (`src/story/**`) for a banned list: `vLLM`, `SGLang`, `TensorRT`, `llama.cpp`, `max_num`, `gpu_memory_utilization`, `PagedAttention`, `continuous batching`, `chunked prefill`, `WGMMA`, `MFMA`, `SM90`. Fails if any appear. This enforces D5 deterministically.

**Code placement:** new story code goes under `src/story/` (panels, picture, challenges, router glue). Do not grow `src/main.ts` (≈1,500 lines). Step 4 should reduce it to the Under the hood page's entry point.

## 15. Rollback

- Steps 1a–3 add or refactor code without changing the default page, so each can be reverted as a single commit.
- Step 4 keeps the old experience fully working at `#/under-the-hood`. Until step 8, rolling back the new front page is one change: point `#/` back at the old experience.
- Step 8 is the only step that deletes old main-page code; do it last, after the story has been reviewed in the browser.

## 16. Open items (defaults given)

| Item | Default |
|---|---|
| Panel 3 fixed user count | 64; confirm the capacity wall is reachable within the context knob range, otherwise raise it and note why |
| Panel 4 fixed workload | 64 users × 4K context (matches the figures in the brief) |
| Representative values for SSD and object storage | Choose a cited, conservative figure; show "representative" and the source |
| Challenge constraint values | Set from model output so rules 1–2 hold with visible margin (≥10% either side of the limit) |
| Playground layout on phones | Picture above, knobs below, readout pinned directly under the picture |

If a default turns out to be wrong, change it, and record the reason in the commit message and in this table.
