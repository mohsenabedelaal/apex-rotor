import { createDefaultControllerState, type ConnectionStatus, type ControllerState } from '../../shared/controller';
import { createSocket } from '../socket';

type BabylonModule = Record<string, any>;

type GameSnapshot = {
  phase: 'lobby' | 'playing' | 'finished';
  pilotName: string;
  courseName: string;
  score: number;
  ringsCleared: number;
  totalRings: number;
  timeRemaining: number;
  lastMessage: string;
};

type DroneRuntime = {
  start: (pilotName: string) => void;
  reset: () => void;
  dispose: () => void;
};

type BabylonWindow = Window & {
  BABYLON?: BabylonModule;
  webkitAudioContext?: typeof AudioContext;
};

const COURSE_DURATION_SECONDS = 90;
const COURSE_NAME = 'Sky Garden Sprint';

const generateRoomId = (): string => Math.random().toString(36).slice(2, 8).toUpperCase();

const getRoomId = (): string => {
  const roomFromUrl = new URLSearchParams(window.location.search).get('room');

  if (roomFromUrl?.match(/^[A-Za-z0-9-]+$/)) {
    return roomFromUrl.toUpperCase();
  }

  const roomId = generateRoomId();
  window.history.replaceState(null, '', `/game?room=${roomId}`);
  return roomId;
};

const formatState = (state: ControllerState): string => JSON.stringify(state, null, 2);

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const loadBabylon = async (): Promise<BabylonModule> => {
  const existingBabylon = (window as BabylonWindow).BABYLON;
  if (existingBabylon) {
    return existingBabylon;
  }

  const timeout = new Promise<never>((_, reject) => {
    window.setTimeout(() => reject(new Error('Babylon.js CDN load timed out.')), 12000);
  });

  const loadScript = new Promise<BabylonModule>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.babylonjs.com/babylon.js';
    script.async = true;
    script.onload = () => {
      const babylon = (window as BabylonWindow).BABYLON;

      if (babylon) {
        resolve(babylon);
        return;
      }

      reject(new Error('Babylon.js loaded without exposing the BABYLON global.'));
    };
    script.onerror = () => reject(new Error('Babylon.js CDN request failed.'));
    document.head.append(script);
  });

  return Promise.race([loadScript, timeout]);
};

const createRingSound = (): (() => void) => {
  let context: AudioContext | null = null;

  return () => {
    const AudioContextCtor = window.AudioContext ?? (window as BabylonWindow).webkitAudioContext;
    if (!AudioContextCtor) {
      return;
    }

    const audioContext = context ?? new AudioContextCtor();
    context = audioContext;
    void audioContext.resume();

    const now = audioContext.currentTime;
    const gain = audioContext.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);
    gain.connect(audioContext.destination);

    [523.25, 783.99, 1046.5].forEach((frequency, index) => {
      const oscillator = audioContext.createOscillator();
      oscillator.type = index === 2 ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(frequency, now + index * 0.035);
      oscillator.connect(gain);
      oscillator.start(now + index * 0.035);
      oscillator.stop(now + 0.34 + index * 0.035);
    });
  };
};

const createDroneScene = async (
  canvas: HTMLCanvasElement,
  getControls: () => ControllerState,
  onSnapshot: (snapshot: GameSnapshot) => void,
): Promise<DroneRuntime> => {
  const BABYLON = await loadBabylon();
  const engine = new BABYLON.Engine(canvas, true);
  const scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.5, 0.76, 0.98, 1);
  scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.012;
  scene.fogColor = new BABYLON.Color3(0.63, 0.82, 0.96);

  const camera = new BABYLON.FollowCamera('follow-camera', new BABYLON.Vector3(0, 6, -14), scene);
  camera.radius = 15;
  camera.heightOffset = 5.4;
  camera.rotationOffset = 180;
  camera.cameraAcceleration = 0.045;
  camera.maxCameraSpeed = 22;
  camera.attachControl(canvas, true);

  const sun = new BABYLON.DirectionalLight('golden-sun', new BABYLON.Vector3(-0.4, -1, 0.55), scene);
  sun.intensity = 1.2;
  const skyLight = new BABYLON.HemisphericLight('sky-bounce', new BABYLON.Vector3(0.2, 1, 0.4), scene);
  skyLight.intensity = 0.82;

  const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 150, height: 150, subdivisions: 40 }, scene);
  const groundMaterial = new BABYLON.StandardMaterial('garden-grass', scene);
  groundMaterial.diffuseColor = new BABYLON.Color3(0.13, 0.5, 0.29);
  groundMaterial.specularColor = new BABYLON.Color3(0.05, 0.14, 0.09);
  ground.material = groundMaterial;

  const makeMaterial = (name: string, color: [number, number, number], emissive: [number, number, number] = [0, 0, 0]) => {
    const material = new BABYLON.StandardMaterial(name, scene);
    material.diffuseColor = new BABYLON.Color3(...color);
    material.emissiveColor = new BABYLON.Color3(...emissive);
    return material;
  };

  const trunkMaterial = makeMaterial('soft-trunks', [0.45, 0.25, 0.12]);
  const leafMaterials = [makeMaterial('leaf-mint', [0.21, 0.68, 0.38]), makeMaterial('leaf-lime', [0.42, 0.78, 0.28]), makeMaterial('leaf-teal', [0.15, 0.62, 0.5])];
  const rockMaterial = makeMaterial('warm-rock', [0.55, 0.5, 0.44]);

  for (let i = 0; i < 48; i += 1) {
    const angle = i * 1.618;
    const radius = 25 + (i % 8) * 6;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const trunk = BABYLON.MeshBuilder.CreateCylinder(`tree-trunk-${i}`, { diameter: 0.8, height: 4 + (i % 3) }, scene);
    trunk.position = new BABYLON.Vector3(x, trunk.getBoundingInfo().boundingBox.extendSize.y, z);
    trunk.material = trunkMaterial;
    const crown = BABYLON.MeshBuilder.CreateSphere(`tree-crown-${i}`, { diameter: 5 + (i % 4) }, scene);
    crown.position = new BABYLON.Vector3(x, 5.5 + (i % 3), z);
    crown.scaling.y = 0.8;
    crown.material = leafMaterials[i % leafMaterials.length];
  }

  for (let i = 0; i < 18; i += 1) {
    const rock = BABYLON.MeshBuilder.CreateSphere(`rock-${i}`, { diameter: 1.8 + (i % 4) * 0.4 }, scene);
    rock.position = new BABYLON.Vector3(Math.sin(i * 2.3) * 34, 0.55, Math.cos(i * 1.7) * 34);
    rock.scaling.y = 0.35;
    rock.material = rockMaterial;
  }

  const drone = new BABYLON.TransformNode('drone-root', scene);
  const droneMaterial = makeMaterial('glossy-blue-drone', [0.05, 0.54, 1], [0.02, 0.08, 0.14]);
  const darkMaterial = makeMaterial('dark-frame', [0.02, 0.03, 0.05]);
  const accentMaterial = makeMaterial('neon-gold-accent', [1, 0.76, 0.16], [0.28, 0.18, 0.02]);
  const rotorMaterial = makeMaterial('transparent-rotor-glow', [0.68, 0.95, 1], [0.08, 0.25, 0.35]);
  rotorMaterial.alpha = 0.48;

  const body = BABYLON.MeshBuilder.CreateSphere('sleek-drone-body', { diameterX: 2.15, diameterY: 0.62, diameterZ: 1.32, segments: 32 }, scene);
  body.parent = drone;
  body.material = droneMaterial;
  const cockpit = BABYLON.MeshBuilder.CreateSphere('gold-cockpit', { diameterX: 0.72, diameterY: 0.32, diameterZ: 0.5, segments: 24 }, scene);
  cockpit.parent = drone;
  cockpit.position.z = 0.55;
  cockpit.position.y = 0.17;
  cockpit.material = accentMaterial;

  [-1, 1].forEach((xSign) => {
    [-1, 1].forEach((zSign) => {
      const arm = BABYLON.MeshBuilder.CreateCylinder(`carbon-arm-${xSign}-${zSign}`, { diameter: 0.13, height: 2.5 }, scene);
      arm.parent = drone;
      arm.position = new BABYLON.Vector3(xSign * 0.9, 0, zSign * 0.62);
      arm.rotation.z = Math.PI / 2;
      arm.rotation.y = zSign * 0.52;
      arm.material = darkMaterial;

      const nacelle = BABYLON.MeshBuilder.CreateCylinder(`motor-${xSign}-${zSign}`, { diameter: 0.38, height: 0.25, tessellation: 24 }, scene);
      nacelle.parent = drone;
      nacelle.position = new BABYLON.Vector3(xSign * 1.75, 0.03, zSign * 1.2);
      nacelle.material = darkMaterial;

      const rotor = BABYLON.MeshBuilder.CreateCylinder(`rotor-disc-${xSign}-${zSign}`, { diameter: 1.05, height: 0.035, tessellation: 48 }, scene);
      rotor.parent = drone;
      rotor.position = new BABYLON.Vector3(xSign * 1.75, 0.2, zSign * 1.2);
      rotor.material = rotorMaterial;
    });
  });

  const ringMaterial = makeMaterial('ring-neon', [0.1, 0.86, 1], [0, 0.45, 0.7]);
  const clearedRingMaterial = makeMaterial('ring-cleared', [0.52, 1, 0.38], [0.14, 0.55, 0.08]);
  const gatePositions = [
    [0, 4, 12], [8, 5, 24], [-9, 4.8, 36], [-18, 7, 20], [-7, 5, 3],
    [12, 6, -10], [23, 7.5, -2], [17, 5, 18], [3, 8, 34], [-14, 6, 48],
  ];
  const rings = gatePositions.map(([x, y, z], index) => {
    const torus = BABYLON.MeshBuilder.CreateTorus(`course-ring-${index + 1}`, { diameter: 5, thickness: 0.28, tessellation: 80 }, scene);
    torus.position = new BABYLON.Vector3(x, y, z);
    const next = gatePositions[index + 1] ?? [x, y, z + 12];
    torus.rotation.y = Math.atan2((next as number[])[0] - x, (next as number[])[2] - z);
    torus.material = ringMaterial;
    return { mesh: torus, cleared: false };
  });

  camera.lockedTarget = drone;

  const startPosition = new BABYLON.Vector3(0, 3.4, -4);
  const velocity = new BABYLON.Vector3(0, 0, 0);
  const playRingSound = createRingSound();
  let yaw = 0;
  let previousReset = false;
  let phase: GameSnapshot['phase'] = 'lobby';
  let pilotName = '';
  let score = 0;
  let ringsCleared = 0;
  let timeRemaining = COURSE_DURATION_SECONDS;
  let lastMessage = 'Enter your pilot name and launch the course.';

  const publishSnapshot = (): void => onSnapshot({ phase, pilotName, courseName: COURSE_NAME, score, ringsCleared, totalRings: rings.length, timeRemaining, lastMessage });

  const reset = (): void => {
    drone.position.copyFrom(startPosition);
    drone.rotation = new BABYLON.Vector3(0, 0, 0);
    velocity.set(0, 0, 0);
    yaw = 0;
    rings.forEach((ring) => {
      ring.cleared = false;
      ring.mesh.material = ringMaterial;
      ring.mesh.scaling.set(1, 1, 1);
    });
    score = 0;
    ringsCleared = 0;
    timeRemaining = COURSE_DURATION_SECONDS;
    lastMessage = phase === 'lobby' ? 'Enter your pilot name and launch the course.' : 'Fresh run started. Chase the glowing rings!';
    publishSnapshot();
  };

  const start = (nextPilotName: string): void => {
    pilotName = nextPilotName.trim() || 'Rookie Pilot';
    phase = 'playing';
    reset();
    lastMessage = `Go, ${pilotName}! Fly through every ring before time runs out.`;
    publishSnapshot();
    void canvas.requestPointerLock?.();
  };

  reset();

  scene.onBeforeRenderObservable.add(() => {
    const deltaSeconds = Math.min(engine.getDeltaTime() / 1000, 0.05);
    const controls = getControls();

    rings.forEach((ring, index) => {
      ring.mesh.rotation.z += deltaSeconds * (0.35 + index * 0.03);
      if (!ring.cleared) {
        const pulse = 1 + Math.sin(performance.now() * 0.004 + index) * 0.045;
        ring.mesh.scaling.set(pulse, pulse, pulse);
      }
    });

    if (controls.reset && !previousReset) {
      phase = phase === 'lobby' ? 'lobby' : 'playing';
      reset();
    }
    previousReset = controls.reset;

    if (phase !== 'playing') {
      drone.rotation.y += deltaSeconds * 0.35;
      return;
    }

    timeRemaining = Math.max(0, timeRemaining - deltaSeconds);
    if (timeRemaining <= 0) {
      phase = 'finished';
      lastMessage = `Time! ${pilotName} cleared ${ringsCleared}/${rings.length} rings.`;
      publishSnapshot();
      return;
    }

    const throttle = -controls.leftJoystick.y;
    const yawInput = controls.leftJoystick.x;
    const pitch = -controls.rightJoystick.y;
    const roll = controls.rightJoystick.x;

    yaw += yawInput * 2.5 * deltaSeconds;
    const forward = new BABYLON.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new BABYLON.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const acceleration = forward.scale(pitch * 22).addInPlace(right.scale(roll * 20));
    acceleration.y = throttle * 20;

    velocity.addInPlace(acceleration.scale(deltaSeconds));
    velocity.scaleInPlace(controls.brake ? 0.82 : 0.988);
    velocity.y -= 2.2 * deltaSeconds;
    velocity.x = clamp(velocity.x, -23, 23);
    velocity.y = clamp(velocity.y, -14, 14);
    velocity.z = clamp(velocity.z, -23, 23);

    drone.position.addInPlace(velocity.scale(deltaSeconds));
    drone.position.y = clamp(drone.position.y, 0.9, 32);
    drone.position.x = clamp(drone.position.x, -68, 68);
    drone.position.z = clamp(drone.position.z, -68, 68);

    drone.rotation.y = yaw;
    drone.rotation.x = pitch * 0.42;
    drone.rotation.z = -roll * 0.42;

    const nextRing = rings.find((ring) => !ring.cleared);
    if (nextRing && BABYLON.Vector3.Distance(drone.position, nextRing.mesh.position) < 2.25) {
      nextRing.cleared = true;
      nextRing.mesh.material = clearedRingMaterial;
      nextRing.mesh.scaling.set(0.78, 0.78, 0.78);
      ringsCleared += 1;
      score += 100 + Math.round(timeRemaining * 2);
      lastMessage = ringsCleared === rings.length ? 'Perfect run! Every ring is cleared.' : `Ring ${ringsCleared} cleared! Line up the next gate.`;
      playRingSound();
      if (ringsCleared === rings.length) {
        phase = 'finished';
        score += Math.round(timeRemaining * 10);
      }
      publishSnapshot();
    } else if (Math.floor(timeRemaining * 10) % 5 === 0) {
      publishSnapshot();
    }
  });

  engine.runRenderLoop(() => scene.render());

  const handleResize = (): void => engine.resize();
  window.addEventListener('resize', handleResize);

  return {
    start,
    reset,
    dispose: () => {
      window.removeEventListener('resize', handleResize);
      engine.dispose();
    },
  };
};

const resolveRemoteBaseUrl = async (): Promise<string> => {
  const { hostname, origin } = window.location;

  if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
    return origin;
  }

  try {
    const response = await fetch('/__network_info');
    const data = await response.json() as { urls?: string[] };
    return data.urls?.[0] ?? origin;
  } catch {
    return origin;
  }
};

export const renderGameRoute = (root: HTMLElement): void => {
  const roomId = getRoomId();
  let remoteUrl = `${window.location.origin}/remote/${roomId}`;
  let status: ConnectionStatus = 'waiting';
  let controllerState = createDefaultControllerState();
  let droneRuntime: DroneRuntime | null = null;
  let gameSnapshot: GameSnapshot = {
    phase: 'lobby',
    pilotName: '',
    courseName: COURSE_NAME,
    score: 0,
    ringsCleared: 0,
    totalRings: 10,
    timeRemaining: COURSE_DURATION_SECONDS,
    lastMessage: 'Enter your pilot name and launch the course.',
  };

  root.innerHTML = `
    <main class="page game-layout">
      <section class="card hero-card game-hero">
        <div>
          <p class="eyebrow">Apex Rotor</p>
          <h1>Neon drone ring sprint</h1>
          <p class="hero-copy">Pick your pilot name, connect your phone as a remote, and fly a polished garden course full of glowing rings.</p>
        </div>
        <div class="room-panel">
          <span>Room <strong id="room-id"></strong></span>
          <div class="status-row">Status: <strong id="status"></strong></div>
        </div>
      </section>

      <section class="card setup-card">
        <div>
          <p class="eyebrow">Default place</p>
          <h2>${COURSE_NAME}</h2>
          <p class="hint">One course is available for now. More places can plug into this selection later.</p>
        </div>
        <label class="pilot-field">Pilot name
          <input id="pilot-name" maxlength="24" placeholder="Rookie Pilot" autocomplete="name" />
        </label>
        <button id="start-game" class="primary-action" type="button">Start game</button>
      </section>

      <section class="hud-grid" aria-live="polite">
        <div class="hud-card"><span>Score</span><strong id="score">0</strong></div>
        <div class="hud-card"><span>Rings</span><strong id="rings">0/10</strong></div>
        <div class="hud-card"><span>Timer</span><strong id="timer">90.0s</strong></div>
        <div class="hud-card"><span>Pilot</span><strong id="pilot">—</strong></div>
      </section>

      <section class="game-scene-card card">
        <div class="scene-banner"><span id="game-phase">Lobby</span><strong id="game-message">Enter your pilot name and launch the course.</strong></div>
        <canvas id="game-canvas" aria-label="3D drone game scene"></canvas>
      </section>

      <section class="card remote-card">
        <h2>Phone remote</h2>
        <p>Open this URL on your phone browser:</p>
        <a id="remote-url" class="remote-url"></a>
        <p class="hint">Left stick controls throttle and yaw. Right stick controls forward/back and strafe. Brake slows the drone; Reset restarts the run.</p>
      </section>

      <details class="card debug-card">
        <summary>Latest controller state</summary>
        <pre id="controller-state"></pre>
      </details>
    </main>
  `;

  const roomIdElement = root.querySelector<HTMLSpanElement>('#room-id');
  const remoteUrlElement = root.querySelector<HTMLAnchorElement>('#remote-url');
  const statusElement = root.querySelector<HTMLElement>('#status');
  const stateElement = root.querySelector<HTMLPreElement>('#controller-state');
  const canvas = root.querySelector<HTMLCanvasElement>('#game-canvas');
  const pilotInput = root.querySelector<HTMLInputElement>('#pilot-name');
  const startButton = root.querySelector<HTMLButtonElement>('#start-game');
  const scoreElement = root.querySelector<HTMLElement>('#score');
  const ringsElement = root.querySelector<HTMLElement>('#rings');
  const timerElement = root.querySelector<HTMLElement>('#timer');
  const pilotElement = root.querySelector<HTMLElement>('#pilot');
  const phaseElement = root.querySelector<HTMLElement>('#game-phase');
  const messageElement = root.querySelector<HTMLElement>('#game-message');

  if (!roomIdElement || !remoteUrlElement || !statusElement || !stateElement || !canvas || !pilotInput || !startButton || !scoreElement || !ringsElement || !timerElement || !pilotElement || !phaseElement || !messageElement) {
    throw new Error('Game route failed to render required elements.');
  }

  const render = (): void => {
    roomIdElement.textContent = roomId;
    remoteUrlElement.textContent = remoteUrl;
    remoteUrlElement.href = remoteUrl;
    statusElement.textContent = status;
    statusElement.dataset.status = status;
    stateElement.textContent = formatState(controllerState);
    scoreElement.textContent = String(gameSnapshot.score);
    ringsElement.textContent = `${gameSnapshot.ringsCleared}/${gameSnapshot.totalRings}`;
    timerElement.textContent = `${gameSnapshot.timeRemaining.toFixed(1)}s`;
    pilotElement.textContent = gameSnapshot.pilotName || '—';
    phaseElement.textContent = gameSnapshot.phase;
    phaseElement.dataset.phase = gameSnapshot.phase;
    messageElement.textContent = gameSnapshot.lastMessage;
    startButton.textContent = gameSnapshot.phase === 'playing' ? 'Restart run' : 'Start game';
  };

  render();

  void resolveRemoteBaseUrl().then((baseUrl) => {
    remoteUrl = `${baseUrl}/remote/${roomId}`;
    render();
  });

  createDroneScene(canvas, () => controllerState, (snapshot) => {
    gameSnapshot = snapshot;
    render();
  })
    .then((runtime) => {
      droneRuntime = runtime;
    })
    .catch((error: unknown) => {
      console.error('Failed to load Babylon.js scene', error);
      canvas.insertAdjacentHTML('afterend', '<p class="scene-error">3D engine unavailable. Check your internet connection and reload the game.</p>');
    });

  startButton.addEventListener('click', () => {
    droneRuntime?.start(pilotInput.value);
  });

  pilotInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      droneRuntime?.start(pilotInput.value);
    }
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
