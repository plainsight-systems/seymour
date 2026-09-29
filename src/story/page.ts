import './story.css';
import { DEFAULT_SETTINGS, HARDWARE_PROFILES, getHardware } from '../data/profiles';
import { mountActs, type ActSpec } from './acts';
import { mountBuildChallenge, type BuildChallengeView } from './challenge/build';
import { mountChallengeBoard, type ChallengeBoardView } from './challenges/board';
import { mountBottleneckChallenge } from './forward/challenge';
import { FORWARD_TOOLS, PASS_LOOP, STAGE_ORDER, STAGE_TAB_LABEL, mountForwardScenes } from './forward/scenes';
import type { HardwareLink } from './forward/stages';
import { GPU_SCENES, mountGpuScenes, type GpuSceneId, type GpuScenesView } from './gpu';
import { escapeHtml } from './html';
import { STORY_PANELS } from './panels';
import { EFFICIENCY_NOTE, mountPanels, type PanelsView } from './panels/view';
import { mountPlayground, type PlaygroundView } from './playground';
import { mountPickChallenge } from './throttles/challenge';

// The story page: four acts stacked vertically, each a row of scene tabs.
// This module only lays out the acts and wires the scenes together; each
// scene's content lives in its own module.

const root = document.querySelector<HTMLElement>('#route-root');
if (!root) throw new Error('Missing #route-root');

/** The accelerator every act shows; switching it in any act switches all. */
let storyHardwareId = DEFAULT_SETTINGS.hardwareId as string;

function chipToggle(): string {
  return `<span class="panel-chip" role="group" aria-label="Accelerator">${HARDWARE_PROFILES.map((hardware) => `<button type="button" data-chip="${hardware.id}" aria-pressed="${hardware.id === storyHardwareId}" title="${escapeHtml(`${hardware.vendor} ${hardware.name}`)}">${escapeHtml(hardware.name.replace(' SXM', ''))}</button>`).join('')}</span>`;
}

const ACTS: ActSpec[] = [
  {
    id: 'act-1', number: 1, title: 'The GPU',
    intro: 'What the hardware is, from the whole server down to one compute unit, and what each part is for.',
    scenes: [...GPU_SCENES.map(({ id, label }) => ({ id, label })), { id: 'build', label: 'Challenge: build it' }],
  },
  {
    id: 'act-2', number: 2, title: 'Inference',
    intro: 'What the model computes, stage by stage: from text on the CPU, through every layer on the GPU, and back to text. A request runs these stages once for the whole prompt, then once more for every token of the answer. Llama 3.1 8B throughout.',
    scenes: [...STAGE_ORDER.map((id) => ({ id, label: STAGE_TAB_LABEL[id] })), { id: 'first-vs-later', label: 'First vs. later' }, { id: 'bottleneck', label: 'Challenge' }],
    tools: FORWARD_TOOLS,
    banner: PASS_LOOP,
  },
  {
    id: 'act-3', number: 3, title: 'The throttles',
    intro: 'How each stage from Act 2 changes with the choices you make, and which part from Act 1 it runs into.',
    footnote: EFFICIENCY_NOTE,
    scenes: [...STORY_PANELS.filter((panel) => panel.id !== 'first-vs-later').map((panel) => ({ id: panel.id, label: panel.title })), { id: 'pick', label: 'Challenge' }],
  },
  {
    id: 'act-4', number: 4, title: 'Putting it together',
    intro: 'Real serving problems with fixed targets, then every knob at once on any chip.',
    footnote: EFFICIENCY_NOTE,
    scenes: [{ id: 'challenges', label: 'Challenges' }, { id: 'playground', label: 'Playground' }],
  },
];

// The scene modules mount after the acts exist, so the acts' first onShow may
// arrive before them. Views mounted while hidden measure nothing, so each
// redraws when its scene opens.
let gpu: GpuScenesView | null = null;
let build: BuildChallengeView | null = null;
let challengeBoard: ChallengeBoardView | null = null;
let playground: PlaygroundView | null = null;
/** Act 4's visible scene: while the challenges are open, "Pick the chip" can lock the chip buttons. */
let act4Scene: 'challenges' | 'playground' = 'challenges';

const acts = mountActs(root, ACTS, {
  headerTools: chipToggle(),
  onShow: (sceneId) => {
    if (sceneId === 'challenges' || sceneId === 'playground') { act4Scene = sceneId; syncAct4Chips(); }
    if (sceneId === 'playground') playground?.refresh();
    if (sceneId === 'build') build?.refresh();
    if (GPU_SCENES.some((scene) => scene.id === sceneId)) gpu?.refresh(sceneId as GpuSceneId);
  },
});

/** Opens an Act 1 scene and selects the named part on it. */
function openHardwarePart(link: HardwareLink): void {
  acts.navigate(`act-1/${link.scene}`);
  gpu?.selectPart(link.scene, link.part);
}

// Act 1: the chip, then the build challenge.
gpu = mountGpuScenes((sceneId) => acts.sceneHost(sceneId), storyHardwareId);
build = mountBuildChallenge(acts.sceneHost('build'), storyHardwareId);

// Acts 2 and 3: the concept panels (Act 2's "first vs. later" and the throttles).
const panels: PanelsView = mountPanels((panelId) => acts.sceneHost(panelId), storyHardwareId, {
  openStage: (stage) => acts.navigate(`act-2/${stage}`),
  openPart: openHardwarePart,
});

// Act 2: one forward pass, stage by stage. Its users and context carry into the panels.
const forward = mountForwardScenes(
  (stage) => acts.sceneHost(stage),
  acts.partOf('act-2', '.act-tools'),
  acts.partOf('act-2', '[data-pass-loop]'),
  openHardwarePart,
  (workload) => panels.adoptWorkload(workload),
);
forward.render(storyHardwareId);
const bottleneck = mountBottleneckChallenge(acts.sceneHost('bottleneck'), (stage) => acts.navigate(`act-2/${stage}`));
bottleneck.render(storyHardwareId);

// Act 3's challenge.
const pickChallenge = mountPickChallenge(acts.sceneHost('pick'), (target) => acts.navigate(target));
pickChallenge.render(storyHardwareId);

// Act 4: the challenges, then the playground.
challengeBoard = mountChallengeBoard(acts.sceneHost('challenges'), storyHardwareId, (target) => acts.navigate(target), () => syncAct4Chips());
playground = mountPlayground(acts.sceneHost('playground'));

// One accelerator for the whole story: any act's selector switches every act.
root.addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('.act-tools [data-chip]');
  if (!button || button.dataset.chip === storyHardwareId) return;
  storyHardwareId = button.dataset.chip!;
  for (const chip of root.querySelectorAll<HTMLButtonElement>('.act-tools [data-chip]')) chip.setAttribute('aria-pressed', String(chip.dataset.chip === storyHardwareId));
  gpu?.setHardware(storyHardwareId);
  build?.setHardware(storyHardwareId);
  forward.render(storyHardwareId);
  bottleneck.render(storyHardwareId);
  panels.setHardware(storyHardwareId);
  pickChallenge.render(storyHardwareId);
  challengeBoard?.setHardware(storyHardwareId);
  playground?.setHardware(storyHardwareId);
  syncAct4Chips();
});

/**
 * Act 4's chip buttons never claim a chip the numbers are not using. The
 * challenges follow the story-wide chip, except "Pick the chip", where the
 * chip is the question: there the buttons show its pick, disabled, with a note.
 */
function syncAct4Chips(): void {
  // Before the board mounts (while the acts are still being built) there is nothing to lock.
  if (!challengeBoard) return;
  const tools = acts.partOf('act-4', '.act-tools');
  const locked = act4Scene === 'challenges' && challengeBoard.chipIsAKnob() ? challengeBoard.currentChip() : null;
  for (const chip of tools.querySelectorAll<HTMLButtonElement>('[data-chip]')) {
    chip.setAttribute('aria-pressed', String(chip.dataset.chip === (locked ?? storyHardwareId)));
    chip.disabled = locked !== null;
  }
  let note = tools.querySelector<HTMLElement>('[data-chip-lock]');
  if (!note) {
    note = document.createElement('small');
    note.className = 'chip-lock';
    note.dataset.chipLock = '';
    tools.appendChild(note);
  }
  note.hidden = locked === null;
  note.textContent = locked ? `${getHardware(locked).name}: picked in this challenge` : '';
}
syncAct4Chips();
