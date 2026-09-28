import '@fontsource-variable/anybody';
import '@fontsource-variable/public-sans';
import './router.css';
import { isRouteChange, resolveRoute } from './router';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app root');

async function boot(): Promise<void> {
  const resolved = resolveRoute(window.location.hash, window.location.search);
  if (resolved.redirectHash) {
    window.location.replace(`${window.location.pathname}${window.location.search}${resolved.redirectHash}`);
    return;
  }

  app!.innerHTML = `<header class="route-header">
    <a class="route-brand" href="#/" aria-label="Seymour story"><span aria-hidden="true"><i></i><i></i><i></i></span><strong>Seymour</strong></a>
    <nav aria-label="Seymour sections">
      <a href="#/" aria-current="${resolved.route === 'story' ? 'page' : 'false'}">Story</a>
      <a href="#/under-the-hood" aria-current="${resolved.route === 'under-the-hood' ? 'page' : 'false'}">Under the hood</a>
      <a href="#/lookup" aria-current="${resolved.route === 'lookup' ? 'page' : 'false'}">Concept lookup</a>
      <a href="https://github.com/plainsight-systems/seymour">GitHub</a>
    </nav>
  </header><main id="route-root" tabindex="-1"></main>`;

  if (resolved.route === 'under-the-hood') {
    document.title = 'Under the hood — Seymour';
    await import('./underhood');
  } else if (resolved.route === 'lookup') {
    document.title = 'Concept lookup — Seymour';
    await import('./lookup/page');
  } else {
    document.title = 'Seymour — feed the machine';
    await import('./story/page');
    if (resolved.anchor) scrollToAnchor(resolved.anchor);
  }
}

/**
 * In-page anchors go to the page first (the story resolves `act-2/two-jobs`
 * to an act and a scene tab); if nothing handles them, scroll to the id.
 */
function scrollToAnchor(id: string): void {
  const handled = !window.dispatchEvent(new CustomEvent('seymour:anchor', { detail: id, cancelable: true }));
  if (!handled) document.getElementById(id)?.scrollIntoView({ block: 'start' });
}

window.addEventListener('hashchange', (event) => {
  const fromHash = new URL(event.oldURL).hash;
  const toHash = window.location.hash;
  if (isRouteChange(fromHash, toHash, window.location.search)) {
    window.location.reload();
    return;
  }
  const { anchor } = resolveRoute(toHash, window.location.search);
  if (anchor) scrollToAnchor(anchor);
});
void boot();
