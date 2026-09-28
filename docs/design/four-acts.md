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

The lookup page stays a separate route. Under the hood is absorbed into Acts 1 and 2 over time, then retired.

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
| A9 | Act 2 shows both jobs side by side in every stage (reading the prompt, writing the next token) instead of a toggle, so the change in limit is visible without interaction. |
| A10 | Act 2 ends with a challenge: for five workloads, name the slowest stage and whether math or memory limits it. Answers are computed from the forward-pass model for the chosen chip, never written by hand; a test requires every scenario's slowest stage to beat the next by at least 1.25×, so no answer is a coin flip. |
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

Phases 1–4 are built. Scene heights measured at 1440×900 after phase 4: 15 of 20 scene states fit one screen; Act 3 "Distance is speed" and "Change what one read buys" are within 1% (910 and 903 px); Act 2 "Two jobs" is 4% over (940 px); the playground is 13–16% over (1,014 px cutaway view, 1,048 px numbers view). A8 is not yet fully met for those scenes.

