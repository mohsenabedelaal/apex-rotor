import { renderGameRoute } from './routes/game';
import { renderRemoteRoute } from './routes/remote';

export const App = (root: HTMLElement): void => {
  const path = window.location.pathname;

  if (path === '/' || path === '/game') {
    renderGameRoute(root);
    return;
  }

  const remoteMatch = path.match(/^\/remote\/([A-Za-z0-9-]+)$/);
  if (remoteMatch) {
    renderRemoteRoute(root, remoteMatch[1]);
    return;
  }

  root.innerHTML = `
    <main class="page card">
      <h1>Route not found</h1>
      <p>Open <a href="/game">/game</a> to create a controller room.</p>
    </main>
  `;
};
