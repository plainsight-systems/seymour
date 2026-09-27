# Design: Cutaway plates as the story's picture

**Status:** Approved direction, executing
**Change class:** Architectural (replaces the story's visualization layer); executed in reviewable steps
**Supersedes:** §7 of `concept-panels.md` ("one picture that grows")
**Date:** 2026-09-27

## 1. Problem

The concept-panel story (see `concept-panels.md`) shipped with an abstract picture: cost bars and a flat memory strip. That misses the approved direction for the audience, engineers who have never looked at GPU hardware:

- The approved direction is **to show the chip**: isometric 2.5D cutaway plates (server → package → die → compute unit), reviewed and approved as a prototype.
- Each panel re-renders the whole accumulated picture, so the page stacks five near-identical pictures.
- Hero and "open the playground" links are in-page anchors (`#two-jobs`, `#playground`). The router reloads on every `hashchange`, so those links reload the page instead of scrolling.
- Panel 0's footer shows the *decode* bottleneck tag under the *prefill vs. decode* story.

## 2. Decisions

| # | Decision |
|---|---|
| C1 | The cutaway plates **are** the story's picture. Each panel shows the plate (zoom level) that tells its concept, not an accumulated stack. |
| C2 | Quantitative bars stay flat and small beside the plate where they carry exact numbers (panel 0 step cost, panel 2 throughput). |
| C3 | Clicking a part highlights its label and clicking a label highlights the part. Both are keyboard-operable. |
| C4 | Label text renders at a constant on-screen size regardless of how the SVG scales. |
| C5 | Every number on a plate comes from `src/model` (no second copy of the math). Topology facts live in `src/data/topology.ts` with sources. |
| C6 | Story panels are fixed to H100 SXM. The playground offers both chips and all four plates. |

## 3. Panel → plate mapping

| Panel | Plate | What the knob visibly changes |
|---|---|---|
| 0 · Two different jobs | Die, twice: *reading the prompt* vs. *writing one token* | Share of SMs doing math in each job |
| 1 · Every token re-reads the model | Package | Model fill in every HBM stack; the whole fill is read per token |
| 2 · Share the read | Die | Share of SMs doing math as users share one read |
| 3 · Memory fills up | Package | KV fill; the capacity wall and overflow |
| 4 · Distance is speed | Server | The path the KV cache travels, drawn with thickness proportional to bandwidth |
| Playground | Any plate, either chip | All knobs |

The compute-unit plate (follow one tile) appears in the playground.

## 4. Module boundaries

```
src/data/topology.ts          published chip topology + sources (pure data)
src/story/cutaway/project.ts  isometric projection (pure)
src/story/cutaway/scene.ts    scene types and builder helpers (pure)
src/story/cutaway/inputs.ts   model → plate inputs: fills, busy shares, tier path (pure)
src/story/cutaway/plates.ts   plate builders: inputs + topology → scene (pure)
src/story/cutaway/render.ts   SVG renderer, fitted text, selection (DOM only; no math)
```

## 5. Invariants

1. `plates.ts` and `inputs.ts` import no DOM API. Unit tests cover them.
2. Unit counts drawn equal the topology facts. Topology facts agree with `HARDWARE_PROFILES`: enabled units = `unitCount`, active stacks × GB per stack = `hbmCapacityGB`.
3. Every label points at an existing part, and every labeled part has at least one drawn box.
4. Fill fractions come from `calculateSimulation`: weights + KV + free + runtime reserve = physical capacity, and overflow appears iff the model reports KV that doesn't fit.
5. "Busy" shading is labeled as a share of time, never as specific units.
6. Disabled-unit positions are drawn deterministically and labeled illustrative.

## 6. Steps

1. Topology data + tests.
2. Cutaway core (projection, scene, inputs, plates) + tests.
3. Renderer + story integration (panels, playground) + CSS; remove the unused abstract memory strip from panels.
4. Router: in-page anchors scroll; only route changes reload. Tests.
5. Browser verification at desktop and 375 px; README update.

## 7. Rollback

Each step is its own commit. Steps 1–2 add code without changing any page. Reverting step 3 restores the abstract picture.
