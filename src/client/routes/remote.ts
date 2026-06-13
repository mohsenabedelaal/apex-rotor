import { createDefaultControllerState, type ConnectionStatus, type ControllerState, type JoystickAxes } from '../../shared/controller';
import { createSocket } from '../socket';

type JoystickState = {
  axes: JoystickAxes;
  activePointerId: number | null;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const axesFromPointer = (pad: HTMLElement, clientX: number, clientY: number): JoystickAxes => {
  const rect = pad.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const radius = Math.min(rect.width, rect.height) / 2;

  return {
    x: Number(clamp((clientX - centerX) / radius, -1, 1).toFixed(3)),
    y: Number(clamp((clientY - centerY) / radius, -1, 1).toFixed(3)),
  };
};

const updateThumb = (thumb: HTMLElement, axes: JoystickAxes): void => {
  thumb.style.transform = `translate(${axes.x * 42}px, ${axes.y * 42}px)`;
};

export const renderRemoteRoute = (root: HTMLElement, roomId: string): void => {
  let status: ConnectionStatus = 'waiting';
  let sequence = 0;
  const state: ControllerState = createDefaultControllerState();
  const left: JoystickState = { axes: state.leftJoystick, activePointerId: null };
  const right: JoystickState = { axes: state.rightJoystick, activePointerId: null };

  root.innerHTML = `
    <main class="page remote-layout">
      <section class="card hero-card">
        <p class="eyebrow">Phone remote</p>
        <h1>Room <span id="room-id"></span></h1>
        <div class="status-row">Status: <strong id="status"></strong></div>
      </section>
      <section class="controls">
        <div class="joystick-card card">
          <h2>Left joystick</h2>
          <div class="joystick" data-stick="left"><div class="joystick-thumb"></div></div>
        </div>
        <div class="joystick-card card">
          <h2>Right joystick</h2>
          <div class="joystick" data-stick="right"><div class="joystick-thumb"></div></div>
        </div>
      </section>
      <section class="button-row">
        <button id="brake" class="control-button brake" type="button">Brake</button>
        <button id="reset" class="control-button reset" type="button">Reset</button>
      </section>
    </main>
  `;

  const roomIdElement = root.querySelector<HTMLSpanElement>('#room-id');
  const statusElement = root.querySelector<HTMLElement>('#status');
  const brakeButton = root.querySelector<HTMLButtonElement>('#brake');
  const resetButton = root.querySelector<HTMLButtonElement>('#reset');
  const leftPad = root.querySelector<HTMLElement>('[data-stick="left"]');
  const rightPad = root.querySelector<HTMLElement>('[data-stick="right"]');
  const leftThumb = leftPad?.querySelector<HTMLElement>('.joystick-thumb');
  const rightThumb = rightPad?.querySelector<HTMLElement>('.joystick-thumb');

  if (!roomIdElement || !statusElement || !brakeButton || !resetButton || !leftPad || !rightPad || !leftThumb || !rightThumb) {
    throw new Error('Remote route failed to render required elements.');
  }

  const renderStatus = (): void => {
    roomIdElement.textContent = roomId;
    statusElement.textContent = status;
    statusElement.dataset.status = status;
  };

  const socket = createSocket();

  const publish = (): void => {
    state.leftJoystick = left.axes;
    state.rightJoystick = right.axes;
    state.brake = brakeButton.matches(':active') || brakeButton.dataset.pressed === 'true';
    state.reset = resetButton.matches(':active') || resetButton.dataset.pressed === 'true';
    state.sequence = sequence;
    state.updatedAt = Date.now();
    socket.emit('remote:controlState', { roomId, state: { ...state, leftJoystick: { ...state.leftJoystick }, rightJoystick: { ...state.rightJoystick } } });
  };

  const bumpAndPublish = (): void => {
    sequence += 1;
    publish();
  };

  const bindJoystick = (pad: HTMLElement, thumb: HTMLElement, joystick: JoystickState): void => {
    pad.addEventListener('pointerdown', (event) => {
      joystick.activePointerId = event.pointerId;
      pad.setPointerCapture(event.pointerId);
      joystick.axes = axesFromPointer(pad, event.clientX, event.clientY);
      updateThumb(thumb, joystick.axes);
      bumpAndPublish();
    });

    pad.addEventListener('pointermove', (event) => {
      if (joystick.activePointerId !== event.pointerId) {
        return;
      }
      joystick.axes = axesFromPointer(pad, event.clientX, event.clientY);
      updateThumb(thumb, joystick.axes);
      bumpAndPublish();
    });

    const resetJoystick = (event: PointerEvent): void => {
      if (joystick.activePointerId !== event.pointerId) {
        return;
      }
      joystick.activePointerId = null;
      joystick.axes = { x: 0, y: 0 };
      updateThumb(thumb, joystick.axes);
      bumpAndPublish();
    };

    pad.addEventListener('pointerup', resetJoystick);
    pad.addEventListener('pointercancel', resetJoystick);
  };

  const bindButton = (button: HTMLButtonElement): void => {
    const setPressed = (pressed: boolean): void => {
      button.dataset.pressed = String(pressed);
      bumpAndPublish();
    };

    button.addEventListener('pointerdown', () => setPressed(true));
    button.addEventListener('pointerup', () => setPressed(false));
    button.addEventListener('pointercancel', () => setPressed(false));
    button.addEventListener('pointerleave', () => setPressed(false));
  };

  bindJoystick(leftPad, leftThumb, left);
  bindJoystick(rightPad, rightThumb, right);
  bindButton(brakeButton);
  bindButton(resetButton);
  renderStatus();

  socket.on('connect', () => {
    socket.emit('remote:joinRoom', roomId);
    bumpAndPublish();
  });

  socket.on('room:status', (nextStatus) => {
    status = nextStatus;
    renderStatus();
  });

  socket.on('disconnect', () => {
    status = 'disconnected';
    renderStatus();
  });

  window.setInterval(publish, 100);
};
