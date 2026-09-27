import '@fontsource-variable/anybody';
import '@fontsource-variable/public-sans';
import './router.css';
import { resolveRoute } from './router';

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
    const root = document.querySelector<HTMLElement>('#route-root')!;
    root.innerHTML = '<section class="route-placeholder"><span>Concept lookup</span><h1>Framework names come after the idea.</h1><p>This page will map each optimization concept to documented framework terminology.</p></section>';
  } else {
    document.title = 'Seymour — feed the machine';
    const root = document.querySelector<HTMLElement>('#route-root')!;
    root.innerHTML = '<section class="route-placeholder"><span>New guided story</span><h1>Learn the cost before the vocabulary.</h1><p>The five-panel teaching path is being assembled on this foundation. The complete existing experience is preserved under <a href="#/under-the-hood">Under the hood</a>.</p></section>';
  }
}

window.addEventListener('hashchange', () => window.location.reload());
void boot();
