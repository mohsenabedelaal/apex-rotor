import { createDefaultControllerState, type ConnectionStatus, type ControllerState } from '../../shared/controller';
import { createSocket } from '../socket';

type BabylonModule = Record<string, any>;

type DroneRuntime = {
  reset: () => void;
  dispose: () => void;
};

const generateRoomId = (): string => Math.random().toString(36).slice(2, 8).toUpperCase();

const formatState = (state: ControllerState): string => JSON.stringify(state, null, 2);

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const loadBabylon = async (): Promise<BabylonModule> => {
  const importFromCdn = new Function('url', 'return import(url)') as (url: string) => Promise<BabylonModule>;
  return importFromCdn('https://cdn.jsdelivr.net/npm/@babylonjs/core@9.12.0/+esm');
};

const createDroneScene = async (canvas: HTMLCanvasElement, getControls: () => ControllerState): Promise<DroneRuntime> => {
  const BABYLON = await loadBabylon();
  const engine = new BABYLON.Engine(canvas, true);
  const scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.47, 0.72, 0.95, 1);

  const camera = new BABYLON.FollowCamera('follow-camera', new BABYLON.Vector3(0, 6, -12), scene);
  camera.radius = 12;
  camera.heightOffset = 5;
  camera.rotationOffset = 180;
  camera.cameraAcceleration = 0.05;
  camera.maxCameraSpeed = 18;
  camera.attachControl(canvas, true);

  const light = new BABYLON.HemisphericLight('sun', new BABYLON.Vector3(0.2, 1, 0.4), scene);
  light.intensity = 0.9;

  const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 90, height: 90 }, scene);
  const groundMaterial = new BABYLON.StandardMaterial('ground-material', scene);
  groundMaterial.diffuseColor = new BABYLON.Color3(0.18, 0.42, 0.25);
  ground.material = groundMaterial;

  const obstacleMaterial = new BABYLON.StandardMaterial('obstacle-material', scene);
  obstacleMaterial.diffuseColor = new BABYLON.Color3(0.82, 0.38, 0.22);

  [
    [-12, 1.5, 8, 3],
    [9, 2, 12, 4],
    [16, 1, -9, 2],
    [-18, 2.5, -14, 5],
  ].forEach(([x, y, z, height], index) => {
    const obstacle = BABYLON.MeshBuilder.CreateBox(`obstacle-${index + 1}`, { width: 3, depth: 3, height }, scene);
    obstacle.position = new BABYLON.Vector3(x, y, z);
    obstacle.material = obstacleMaterial;
  });

  const drone = new BABYLON.TransformNode('drone-root', scene);
  const droneMaterial = new BABYLON.StandardMaterial('drone-material', scene);
  droneMaterial.diffuseColor = new BABYLON.Color3(0.16, 0.72, 1);
  const accentMaterial = new BABYLON.StandardMaterial('drone-accent-material', scene);
  accentMaterial.diffuseColor = new BABYLON.Color3(1, 0.92, 0.25);

  const body = BABYLON.MeshBuilder.CreateBox('drone-body', { width: 1.6, height: 0.35, depth: 1.1 }, scene);
  body.parent = drone;
  body.material = droneMaterial;

  const nose = BABYLON.MeshBuilder.CreateSphere('drone-nose', { diameter: 0.38 }, scene);
  nose.parent = drone;
  nose.position.z = 0.7;
  nose.scaling.y = 0.55;
  nose.material = accentMaterial;

  const armSpecs = [
    { name: 'front-arm', rotation: 0, z: 0.55 },
    { name: 'back-arm', rotation: 0, z: -0.55 },
    { name: 'left-arm', rotation: Math.PI / 2, x: -0.8 },
    { name: 'right-arm', rotation: Math.PI / 2, x: 0.8 },
  ];

  armSpecs.forEach((arm) => {
    const mesh = BABYLON.MeshBuilder.CreateBox(arm.name, { width: 2.6, height: 0.12, depth: 0.12 }, scene);
    mesh.parent = drone;
    mesh.position.x = arm.x ?? 0;
    mesh.position.z = arm.z ?? 0;
    mesh.rotation.y = arm.rotation;
    mesh.material = droneMaterial;
  });

  [-1.35, 1.35].forEach((x) => {
    [-1.1, 1.1].forEach((z) => {
      const rotor = BABYLON.MeshBuilder.CreateCylinder(`rotor-${x}-${z}`, { diameter: 0.65, height: 0.06 }, scene);
      rotor.parent = drone;
      rotor.position = new BABYLON.Vector3(x, 0.08, z);
      rotor.material = accentMaterial;
    });
  });

  camera.lockedTarget = drone;

  const startPosition = new BABYLON.Vector3(0, 2.5, 0);
  const velocity = new BABYLON.Vector3(0, 0, 0);
  let yaw = 0;
  let previousReset = false;

  const reset = (): void => {
    drone.position.copyFrom(startPosition);
    drone.rotation = new BABYLON.Vector3(0, 0, 0);
    velocity.set(0, 0, 0);
    yaw = 0;
  };

  reset();

  scene.onBeforeRenderObservable.add(() => {
    const deltaSeconds = Math.min(engine.getDeltaTime() / 1000, 0.05);
    const controls = getControls();

    if (controls.reset && !previousReset) {
      reset();
    }
    previousReset = controls.reset;

    const throttle = -controls.leftJoystick.y;
    const yawInput = controls.leftJoystick.x;
    const pitch = -controls.rightJoystick.y;
    const roll = controls.rightJoystick.x;

    yaw += yawInput * 2.2 * deltaSeconds;
    const forward = new BABYLON.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new BABYLON.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const acceleration = forward.scale(pitch * 16).addInPlace(right.scale(roll * 16));
    acceleration.y = throttle * 18;

    velocity.addInPlace(acceleration.scale(deltaSeconds));
    velocity.scaleInPlace(controls.brake ? 0.86 : 0.985);
    velocity.y -= 2.6 * deltaSeconds;
    velocity.x = clamp(velocity.x, -18, 18);
    velocity.y = clamp(velocity.y, -12, 12);
    velocity.z = clamp(velocity.z, -18, 18);

    drone.position.addInPlace(velocity.scale(deltaSeconds));
    drone.position.y = clamp(drone.position.y, 0.8, 28);
    drone.position.x = clamp(drone.position.x, -42, 42);
    drone.position.z = clamp(drone.position.z, -42, 42);

    drone.rotation.y = yaw;
    drone.rotation.x = pitch * 0.35;
    drone.rotation.z = -roll * 0.35;
  });

  engine.runRenderLoop(() => scene.render());

  const handleResize = (): void => engine.resize();
  window.addEventListener('resize', handleResize);

  return {
    reset,
    dispose: () => {
      window.removeEventListener('resize', handleResize);
      engine.dispose();
    },
  };
};

export const renderGameRoute = (root: HTMLElement): void => {
  const roomId = generateRoomId();
  const remoteUrl = `${window.location.origin}/remote/${roomId}`;
  let status: ConnectionStatus = 'waiting';
  let controllerState = createDefaultControllerState();
  let droneRuntime: DroneRuntime | null = null;

  root.innerHTML = `
    <main class="page game-layout">
      <section class="card hero-card">
        <p class="eyebrow">Game screen</p>
        <h1>Room <span id="room-id"></span></h1>
        <p>Open this remote URL on your phone browser:</p>
        <a id="remote-url" class="remote-url"></a>
        <div class="status-row">Status: <strong id="status"></strong></div>
      </section>
      <section class="game-scene-card card">
        <canvas id="game-canvas" aria-label="3D drone game scene"></canvas>
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
  const canvas = root.querySelector<HTMLCanvasElement>('#game-canvas');

  if (!roomIdElement || !remoteUrlElement || !statusElement || !stateElement || !canvas) {
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

  createDroneScene(canvas, () => controllerState)
    .then((runtime) => {
      droneRuntime = runtime;
    })
    .catch((error: unknown) => {
      console.error('Failed to load Babylon.js scene', error);
      canvas.insertAdjacentHTML('afterend', '<p class="scene-error">Unable to load the 3D scene. Check your network connection and refresh.</p>');
    });

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
    if (nextState.reset) {
      droneRuntime?.reset();
    }
    render();
  });

  socket.on('disconnect', () => {
    status = 'disconnected';
    render();
  });
};
