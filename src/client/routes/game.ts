import { createDefaultControllerState, type ConnectionStatus, type ControllerState } from '../../shared/controller';
import { createSocket } from '../socket';

const generateRoomId = (): string => Math.random().toString(36).slice(2, 8).toUpperCase();

const formatState = (state: ControllerState): string => JSON.stringify(state, null, 2);

export const renderGameRoute = (root: HTMLElement): void => {
  const roomId = generateRoomId();
  const remoteUrl = `${window.location.origin}/remote/${roomId}`;
  let status: ConnectionStatus = 'waiting';
  let controllerState = createDefaultControllerState();

  root.innerHTML = `
    <main class="page game-layout">
      <section class="card hero-card">
        <p class="eyebrow">Game screen</p>
        <h1>Room <span id="room-id"></span></h1>
        <p>Open this remote URL on your phone browser:</p>
        <a id="remote-url" class="remote-url"></a>
        <div class="status-row">Status: <strong id="status"></strong></div>
      </section>
      <section class="card">
        <h2>Latest controller state</h2>
        <pre id="controller-state"></pre>
      </section>
    </main>
  `;

  const roomIdElement = root.querySelector<HTMLSpanElement>('#room-id');
  const remoteUrlElement = root.querySelector<HTMLAnchorElement>('#remote-url');
  const statusElement = root.querySelector<HTMLElement>('#status');
  const stateElement = root.querySelector<HTMLPreElement>('#controller-state');

  if (!roomIdElement || !remoteUrlElement || !statusElement || !stateElement) {
    throw new Error('Game route failed to render required elements.');
  }

  const render = (): void => {
    roomIdElement.textContent = roomId;
    remoteUrlElement.textContent = remoteUrl;
    remoteUrlElement.href = remoteUrl;
    statusElement.textContent = status;
    statusElement.dataset.status = status;
    stateElement.textContent = formatState(controllerState);
  };

  render();

  const socket = createSocket();

  socket.on('connect', () => {
    socket.emit('game:createRoom', roomId);
  });

  socket.on('room:status', (nextStatus) => {
    status = nextStatus;
    render();
  });

  socket.on('remote:controlState', (nextState) => {
    controllerState = nextState;
    render();
  });

  socket.on('disconnect', () => {
    status = 'disconnected';
    render();
  });
};
