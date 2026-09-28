// The story's structure: four acts stacked vertically, each one screen tall,
// with scenes as horizontal tabs. This module owns layout, tabs, the act
// indicator, and scene links; scene content is supplied by the caller.

export interface SceneSpec {
  id: string;
  label: string;
}

export interface ActSpec {
  id: string;
  number: number;
  title: string;
  intro: string;
  scenes: SceneSpec[];
}

export interface ActsView {
  /** The element a scene's content is rendered into. */
  sceneHost(sceneId: string): HTMLElement;
  /** Opens a scene (and scrolls to its act when asked). Returns false for unknown ids. */
  open(target: string, scroll: boolean): boolean;
}

export interface ActsOptions {
  /** Markup placed in every act header (e.g. the accelerator selector). */
  headerTools: string;
  /** Called when a scene becomes visible, so hidden content can render on demand. */
  onShow(sceneId: string): void;
}

function tabId(actId: string, sceneId: string): string {
  return `tab-${actId}-${sceneId}`;
}

function panelId(actId: string, sceneId: string): string {
  return `scene-${actId}-${sceneId}`;
}

export function mountActs(root: HTMLElement, acts: ActSpec[], options: ActsOptions): ActsView {
  document.documentElement.classList.add('story-acts');
  root.innerHTML = `<div class="acts">
    <nav class="act-rail" aria-label="Acts">${acts.map((act) => `<a href="#${act.id}" data-rail="${act.id}" title="Act ${act.number} · ${act.title}"><b>${act.title}</b><span>${act.number}</span></a>`).join('')}</nav>
    ${acts.map((act) => `<section class="act" id="${act.id}" aria-labelledby="${act.id}-title">
      <header class="act-head">
        <div class="act-title"><span>Act ${act.number}</span><h2 id="${act.id}-title">${act.title}</h2><p>${act.intro}</p></div>
        <div class="act-tools">${options.headerTools}</div>
      </header>
      <div class="act-tabs" role="tablist" aria-label="Act ${act.number} scenes">${act.scenes.map((scene, index) => `<button type="button" role="tab" id="${tabId(act.id, scene.id)}" aria-controls="${panelId(act.id, scene.id)}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}" data-scene="${scene.id}"><span>${index + 1}</span>${scene.label}</button>`).join('')}</div>
      <div class="act-scenes">${act.scenes.map((scene, index) => `<div class="act-scene" role="tabpanel" id="${panelId(act.id, scene.id)}" aria-labelledby="${tabId(act.id, scene.id)}" data-scene-panel="${scene.id}" ${index === 0 ? '' : 'hidden'}></div>`).join('')}</div>
    </section>`).join('')}
  </div>`;

  const actOf = new Map<string, ActSpec>();
  for (const act of acts) for (const scene of act.scenes) actOf.set(scene.id, act);

  function select(act: ActSpec, sceneId: string, focus: boolean): void {
    const section = root.querySelector<HTMLElement>(`#${act.id}`)!;
    for (const tab of section.querySelectorAll<HTMLButtonElement>('[role="tab"]')) {
      const on = tab.dataset.scene === sceneId;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      if (on && focus) tab.focus();
    }
    for (const panel of section.querySelectorAll<HTMLElement>('[role="tabpanel"]')) panel.hidden = panel.dataset.scenePanel !== sceneId;
    options.onShow(sceneId);
  }

  for (const act of acts) {
    const tablist = root.querySelector<HTMLElement>(`#${act.id} [role="tablist"]`)!;
    tablist.addEventListener('click', (event) => {
      const tab = (event.target as Element).closest<HTMLButtonElement>('[role="tab"]');
      if (!tab) return;
      select(act, tab.dataset.scene!, false);
      history.replaceState(null, '', `#${act.id}/${tab.dataset.scene}`);
    });
    tablist.addEventListener('keydown', (event) => {
      const tabs = [...tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
      const current = tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
      const next = event.key === 'ArrowRight' ? (current + 1) % tabs.length
        : event.key === 'ArrowLeft' ? (current - 1 + tabs.length) % tabs.length
          : event.key === 'Home' ? 0
            : event.key === 'End' ? tabs.length - 1
              : -1;
      if (next < 0) return;
      event.preventDefault();
      select(act, tabs[next]!.dataset.scene!, true);
      history.replaceState(null, '', `#${act.id}/${tabs[next]!.dataset.scene}`);
    });
  }

  // The rail marks the act currently in view.
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      for (const link of root.querySelectorAll<HTMLElement>('[data-rail]')) link.toggleAttribute('aria-current', link.dataset.rail === entry.target.id);
    }
  }, { threshold: 0.5 });
  for (const act of acts) observer.observe(root.querySelector(`#${act.id}`)!);

  // Scenes render their drawings a frame after they become visible, so acts
  // above a jump target can grow after the jump and push it down. Keep the
  // target pinned while the layout settles; the reader's own scrolling wins.
  let pinned: string | null = null;
  let pinTimer = 0;
  const jump = () => { if (pinned) root.querySelector(`#${pinned}`)!.scrollIntoView({ block: 'start', behavior: 'instant' }); };
  const release = () => { pinned = null; window.clearTimeout(pinTimer); };
  function pin(actId: string): void {
    pinned = actId;
    window.clearTimeout(pinTimer);
    pinTimer = window.setTimeout(release, 1500);
    // A timer, not requestAnimationFrame: frames pause in background tabs.
    window.setTimeout(jump, 0);
  }
  new ResizeObserver(jump).observe(root.querySelector('.acts')!);
  for (const type of ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const) window.addEventListener(type, release, { passive: true });

  const view: ActsView = {
    sceneHost(sceneId: string): HTMLElement {
      const act = actOf.get(sceneId);
      if (!act) throw new Error(`Unknown scene "${sceneId}"`);
      return root.querySelector<HTMLElement>(`#${panelId(act.id, sceneId)}`)!;
    },
    open(target: string, scroll: boolean): boolean {
      // Accepts `act-2/two-jobs`, `act-2`, or a bare scene id such as `playground`.
      const [first, second] = target.split('/');
      const act = acts.find((candidate) => candidate.id === first) ?? actOf.get(first!);
      if (!act) return false;
      const sceneId = second ?? (actOf.get(first!) ? first! : null);
      if (sceneId && act.scenes.some((scene) => scene.id === sceneId)) select(act, sceneId, false);
      if (scroll) pin(act.id);
      return true;
    },
  };

  window.addEventListener('seymour:anchor', (event) => {
    if (view.open((event as CustomEvent<string>).detail, true)) event.preventDefault();
  });
  return view;
}
