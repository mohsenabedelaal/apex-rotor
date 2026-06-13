# Apex Rotor

A simple TypeScript browser demo that turns a phone browser into a touch controller for a game screen.

## Local setup

Install dependencies:

```bash
npm install
```

Start the local development server:

```bash
npm run dev
```

Open the game screen in a desktop browser:

```text
http://localhost:5173/game
```

The game screen creates a room and shows a phone-friendly remote URL, for example:

```text
http://localhost:5173/remote/ABC123
```

Open that remote URL on a phone browser connected to the same network as the dev machine. If you are using a phone, replace `localhost` with your computer's LAN IP address, such as `http://192.168.1.20:5173/remote/ABC123`.

## Scripts

- `npm run dev` - starts the local development server, serves the browser app, and relays remote control state between `/game` and `/remote/:roomId`.
- `npm run build` - type-checks the app and creates the Vite production build.
- `npm run typecheck` - runs TypeScript without emitting files.

## How it works

- `/game` generates a room ID, connects to the local dev server, and waits for a remote.
- `/remote/:roomId` joins that room, displays two touch joysticks plus reset and brake buttons, and streams controller state to the game.
- The dev server forwards controller state within a single room and sends `waiting`, `connected`, and `disconnected` status updates.
- The 3D game scene loads Babylon.js in the browser, so an internet connection is required the first time the scene opens.
