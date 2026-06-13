export type ConnectionStatus = 'waiting' | 'connected' | 'disconnected';

export type JoystickAxes = {
  x: number;
  y: number;
};

export type ControllerState = {
  leftJoystick: JoystickAxes;
  rightJoystick: JoystickAxes;
  reset: boolean;
  brake: boolean;
  sequence: number;
  updatedAt: number;
};

export type ServerToClientEvents = {
  'room:status': (status: ConnectionStatus) => void;
  'remote:controlState': (state: ControllerState) => void;
};

export type ClientToServerEvents = {
  'game:createRoom': (roomId: string) => void;
  'remote:joinRoom': (roomId: string) => void;
  'remote:controlState': (payload: { roomId: string; state: ControllerState }) => void;
};

export const centeredAxes = (): JoystickAxes => ({ x: 0, y: 0 });

export const createDefaultControllerState = (): ControllerState => ({
  leftJoystick: centeredAxes(),
  rightJoystick: centeredAxes(),
  reset: false,
  brake: false,
  sequence: 0,
  updatedAt: Date.now(),
});
