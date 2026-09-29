# Design: Four acts

**Status:** Approved direction, executing in phases
**Change class:** Architectural (information structure of the story route)
**Supersedes:** the six-panel page layout in `concept-panels.md` and `cutaway-plates.md` (their models, plates, and decisions on honesty still apply)
**Date:** 2026-09-28

## 1. Problem

The story tries to teach hardware, the algorithm, and optimization at once in every panel. Readers who have never looked at a GPU meet memory stacks, KV traffic, and speculative decoding in the same view. The page reads as dense, and the playground's challenges arrive without the vocabulary they depend on.

## 2. Structure

Four acts, stacked vertically. Each act is one screen tall; scrolling moves between acts. Inside an act, scenes are horizontal tabs.

| Act | Purpose | Scenes |
|---|---|---|
| **1 · The GPU** | What the hardware is and what each part does | Server · Package · Die · Compute unit (parts and purpose at each zoom level) · Challenge: place the parts |
| **2 · Inference** | What the model computes, in order, with sizes and complexity | Linear walk through the forward pass; grouping to be supplied by the owner |
| **3 · The throttles** | How each Act 2 step is changed by decisions and limited by Act 1 hardware | One scene per lever (the current concept panels, re-scoped) |
| **4 · Putting it together** | Prove it under constraints | Playground and challenges |

The lookup page stays a separate route. Under the hood was absorbed into Acts 1 and 2 and retired on 2026-09-29: its route, code, and the Three.js dependency were removed.

## 3. Decisions

| # | Decision |
|---|---|
| A1 | Acts stack vertically, each at least one screen tall (`100svh`). No scroll snapping: browsers re-snap to the previous act when lazily rendered scenes change the page height, which overrode both scene links and the reader's own scrolling. |
| A2 | Scenes are horizontal tabs (`role=tablist`), arrow-key navigable, with one scene visible at a time. |
| A3 | Every scene is addressable: `#act-1/package`. Loading or following such a link scrolls to the act and opens the scene. |
| A4 | The accelerator choice is global and carries across all acts, including the playground. The workload set in Act 2 carries into Act 3 once Act 2 exists. |
| A5 | Act 1 uses the isometric plates only. A Three.js realistic view with physically based materials was built and removed on review: stylized boxes under realistic lighting did not read as the real hardware. A realistic view may return later; generated imagery is not used for technical views, because it cannot guarantee published counts. |
| A6 | Act 1 shows hardware only: no model loaded into memory, no busy shading. Those belong to Acts 2 and 3. |
| A7 | The Act 1 challenge places package-level parts (die, memory stacks, interposer, substrate) and die-level parts (compute units, L2, memory controllers). Drag and drop has a click-to-place equivalent for keyboard users. Feedback appears where the reader is looking: the open zone under a dragged card lights up, a miss flashes the zone red and shows why just above the drawing, and finishing a round lights each part in turn before a result card with the miss count. |
| A9 | Act 2 frames prompt and generation as one loop, not two jobs: a strip under the act header shows pass 1 (the whole prompt) and then one pass per new token, and every stage shows the first pass beside a later pass instead of a toggle, so the change in limit is visible without interaction. Reader-facing copy says "first pass" and "per-token pass" rather than prefill and decode. |
| A10 | Act 2 ends with a challenge: for five workloads, name the slowest stage and whether math or memory limits it. Answers are computed from the forward-pass model for the chosen chip, never written by hand; a test requires every scenario's slowest stage to beat the next by at least 1.25×, so no answer is a coin flip. The mix covers each stage-and-limit pair, with attention limited by memory twice (a team of 16 at 8K context, and 64 users at 32K), because that case is common in serving and the MLP case is not the whole story. |
| A11 | Act 3 ends with a challenge: for five stuck workloads, pick the one throttle that helps most (8-bit weights and math, 8-bit KV, reuse a shared prompt, guess 4 tokens ahead, serve twice the users). Each move is run through the model for the chosen chip. Scenarios state what makes a move situational (how often guesses land; how much of the prompt is shared), so no single move always wins; a test requires the best move to beat the next by 1.25× on every chip and fixes each scenario's lesson. Moves that overflow GPU memory are labeled. All three challenges share one quiz shell (score bar, free navigation, finale). |
| A12 | Act 4 has two scenes: Challenges, then Playground. The six challenges use the shared quiz bar and finale and show each target as a meter with a link to the scene that teaches its fix. Every challenge offers every throttle (users per pass, weight / math / KV precision, prompt reuse, guessing ahead, active and idle KV placement); only the workload is fixed and shown, demand and quality rules are visible targets. Challenges are built for the chip picked above: workloads and targets come from that chip's own numbers, computed by the model (e.g. enough conversations to overflow its memory; a first-token target at 45% of its obvious attempt), so every chip gets the same puzzle. Each challenge states what every passing answer does (`lessonHolds`); a test searches every throttle combination on every chip to prove it. "Pick the chip" makes the chip its question, so there Act 4's chip buttons show its pick, disabled. |
| A8 | Target: every scene fits one screen at desktop size. Content that does not fit is trimmed or split into another scene, not scrolled inside a scene. |

## 4. Phases

1. **Shell.** Acts, tabs, act indicator, scene links, global chip selector. Existing content moves in as-is: Act 1 plates (hardware-only mode), Act 2 holds the prompt-vs-token scene, Act 3 holds the remaining concept panels, Act 4 holds the playground. No new features; no placeholder tabs.
2. **Act 1.** Parts-and-purpose panel for each part; the placement challenge.
3. **Act 2.** The forward pass, with the owner's grouping.
4. **Act 3.** Each lever names the Act 2 steps it changes and the Act 1 part that limits it; scenes trimmed to fit one screen.
5. **Act 4.** Challenge refinements from play-testing.

## 5. Rollback

Phase 1 replaces the story page's outer layout only; the model, plates, panels, and playground modules are reused unchanged. Reverting the phase 1 commit restores the six-panel page.

## 6. Status (2026-09-28)

Phases 1–4 are built. Scene heights measured at 1440×900 after phase 4: 15 of 20 scene states fit one screen; Act 3 "Distance is speed" and "Change what one read buys" are within 1% (910 and 903 px); Act 2 "First vs. later" is 4% over (940 px); the playground is 13–16% over (1,014 px cutaway view, 1,048 px numbers view). A8 is not yet fully met for those scenes.

After the pass-loop strip (60 px) was added to Act 2: the seven stage scenes and the challenge fit at 1440×900 except Attention (902 px, 0.2% over); "First vs. later" is 1,028 px.

Act 4 after its restructure (1440×900): every challenge fits (at most 755 px of content, act 900 px). The playground's Server, Package, and Die zooms fit (878–892 px) and its Numbers view fits (787 px); its Compute unit zoom does not (992 px).
