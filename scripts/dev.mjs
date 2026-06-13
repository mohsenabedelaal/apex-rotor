import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { extname, join, normalize } from 'node:path';

const HOST = '0.0.0.0';
const PORT = Number(process.env.PORT ?? 5173);
const root = process.cwd();

const clients = new Map();
const gameSocketsByRoom = new Map();
const remoteSocketsByRoom = new Map();

const send = (id, event, ...args) => {
  const client = clients.get(id);
  if (!client) {
    return;
  }

  client.response.write(`event: message\ndata: ${JSON.stringify({ event, args })}\n\n`);
};

const emitStatus = (roomId) => {
  const status = (remoteSocketsByRoom.get(roomId)?.size ?? 0) > 0 ? 'connected' : 'waiting';

  for (const [id, client] of clients) {
    if (client.roomId === roomId) {
      send(id, 'room:status', status);
    }
  }
};

const removeClient = (id) => {
  const client = clients.get(id);
  clients.delete(id);

  if (!client?.roomId || !client.role) {
    return;
  }

  if (client.role === 'game') {
    gameSocketsByRoom.delete(client.roomId);
    return;
  }

  const remotes = remoteSocketsByRoom.get(client.roomId);
  remotes?.delete(id);

  if (!remotes?.size) {
    remoteSocketsByRoom.delete(client.roomId);
  }

  emitStatus(client.roomId);
};

const handleSocketEmit = (id, event, args) => {
  const client = clients.get(id);
  if (!client) {
    return;
  }

  if (event === 'game:createRoom') {
    const [roomId] = args;
    client.roomId = roomId;
    client.role = 'game';
    gameSocketsByRoom.set(roomId, id);
    emitStatus(roomId);
    return;
  }

  if (event === 'remote:joinRoom') {
    const [roomId] = args;
    client.roomId = roomId;
    client.role = 'remote';

    const remotes = remoteSocketsByRoom.get(roomId) ?? new Set();
    remotes.add(id);
    remoteSocketsByRoom.set(roomId, remotes);
    emitStatus(roomId);
    return;
  }

  if (event === 'remote:controlState') {
    const [{ roomId, state }] = args;
    const gameSocketId = gameSocketsByRoom.get(roomId);

    if (gameSocketId) {
      send(gameSocketId, 'remote:controlState', state);
    }
  }
};

const socketClientShim = `
export const io = () => {
  const id = crypto.randomUUID();
  const handlers = new Map();

  const callHandlers = (event, ...args) => {
    for (const handler of handlers.get(event) ?? []) {
      handler(...args);
    }
  };

  const socket = {
    on(event, handler) {
      const eventHandlers = handlers.get(event) ?? [];
      eventHandlers.push(handler);
      handlers.set(event, eventHandlers);
      return this;
    },
    emit(event, ...args) {
      fetch('/__socket_emit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, event, args }),
      });
      return this;
    },
  };

  const events = new EventSource('/__socket_events?id=' + encodeURIComponent(id));
  events.addEventListener('open', () => callHandlers('connect'));
  events.addEventListener('message', (message) => {
    const payload = JSON.parse(message.data);
    callHandlers(payload.event, ...payload.args);
  });
  events.addEventListener('error', () => {
    if (events.readyState === EventSource.CLOSED) {
      callHandlers('disconnect');
    }
  });

  return socket;
};
`;

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8',
};

const getContentType = (path) => contentTypes[extname(path)] ?? 'application/octet-stream';

const rewriteBrowserImports = (source) => source
  .replace(/import ['"]\.\/client\/styles\.css['"];?\n?/g, '')
  .replace(/from ['"]socket\.io-client['"]/g, "from '/__socket_client.js'")
  .replace(/from ['"](\.{1,2}\/[^'"]+)(?<!\.(?:css|js|ts))['"]/g, "from '$1.ts'");

const isSafeSourcePath = (path) => path.startsWith('/src/') && !path.includes('..');

const serveSourceFile = async (urlPath, response) => {
  const filePath = join(root, normalize(urlPath).replace(/^\/+/, ''));
  let source = await readFile(filePath, 'utf8');

  if (filePath.endsWith('.ts')) {
    source = stripTypeScriptTypes(source, { mode: 'transform' });
    source = rewriteBrowserImports(source);
  }

  response.writeHead(200, { 'content-type': getContentType(filePath) });
  response.end(source);
};

const serveHtmlShell = async (response) => {
  const html = (await readFile(join(root, 'index.html'), 'utf8'))
    .replace('</head>', '<link rel="stylesheet" href="/src/client/styles.css"></head>');

  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(html);
};

const readRequestBody = (request) => new Promise((resolve, reject) => {
  let body = '';
  request.on('data', (chunk) => {
    body += chunk;
  });
  request.on('end', () => resolve(body));
  request.on('error', reject);
});

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${request.headers.host}`);

    if (url.pathname === '/__socket_client.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      response.end(socketClientShim);
      return;
    }

    if (url.pathname === '/__socket_events') {
      const id = url.searchParams.get('id');

      if (!id) {
        response.writeHead(400).end('Missing socket id.');
        return;
      }

      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      response.write(': connected\n\n');
      clients.set(id, { id, response });
      request.on('close', () => removeClient(id));
      return;
    }

    if (url.pathname === '/__socket_emit' && request.method === 'POST') {
      const body = await readRequestBody(request);
      const { id, event, args } = JSON.parse(body);
      handleSocketEmit(id, event, args);
      response.writeHead(204).end();
      return;
    }

    if (url.pathname === '/' || url.pathname === '/game' || url.pathname.startsWith('/remote/')) {
      await serveHtmlShell(response);
      return;
    }

    if (isSafeSourcePath(url.pathname)) {
      await serveSourceFile(url.pathname, response);
      return;
    }

    response.writeHead(404).end('Not found');
  } catch (error) {
    console.error(error);
    response.writeHead(500).end(error instanceof Error ? error.message : String(error));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Apex Rotor dev server listening on http://localhost:${PORT}`);
  console.log(`Open http://localhost:${PORT}/game to start a room.`);
});
