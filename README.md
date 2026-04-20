# codeE — Real-Time Collaborative Code Editor

A browser-based code editor where multiple users edit **and run** code together in real time. Think Google Docs for code, with a hardened sandbox for execution.

## Features

- **CRDT-based collaborative editing** (Yjs) — conflict-free, offline-tolerant, broadcasts at mouse-move latency
- **Monaco editor** (same engine as VS Code), with shared syntax highlighting per room
- **Presence cursors** — see who is editing, with a color per user derived from their identity
- **Sandboxed code execution** — click Run, code executes inside a fresh Docker container with network disabled, memory/CPU/PID limits, read-only rootfs, capability dropping, and a hard 5-second SIGKILL
- **GitHub OAuth** (with a dev-login bypass for local work)
- **Room membership** — shareable `/join/:id` links; WebSocket upgrade checks membership before any sync happens
- **Server-side persistence** — Yjs binary state snapshots flushed to MongoDB on a 5-second debounce and on last-client-leave, so code survives server restarts

## Architecture

```
┌──────────────┐    WebSocket (Yjs + awareness)   ┌────────────────────┐
│   Browser    │ ◄────────────────────────────── ►│   Collab Server    │
│ React +      │                                   │ Express + ws +     │
│ Monaco + Yjs │     HTTP (auth, rooms, run)       │ y-websocket +      │
│              │ ◄────────────────────────────── ►│ Mongo + JWT        │
└──────┬───────┘                                   └─────┬─────────────┬┘
       │                                                 │             │
       │                                                 │ mongo       │ HTTP (run)
       │                                                 ▼             ▼
       │                                         ┌─────────────┐  ┌──────────────┐
       │                                         │  MongoDB    │  │  Executor    │
       │                                         │  users,     │  │  Express +   │
       │                                         │  rooms,     │  │  dockerode   │
       │                                         │  snapshots  │  └──────┬───────┘
       │                                         └─────────────┘         │
       │                                                                 │ Docker API
       │                                                                 ▼
       │                                                         ┌───────────────┐
       │                                                         │ Throw-away    │
       │                                                         │ container per │
       │                                                         │ run request   │
       │                                                         └───────────────┘
       │
       │ (dev only) Vite dev server on :5173 proxies /auth, /rooms, /ws → :4000
```

Three services so untrusted code never shares a process with session keys or the DB:

| Service                | Port   | Responsibility                                           |
| ---------------------- | ------ | -------------------------------------------------------- |
| `apps/web`             | 5173   | React + Monaco + Yjs client (Vite dev server)            |
| `apps/server`          | 4000   | Auth, rooms REST, y-websocket, Mongo snapshots           |
| `apps/executor`        | 4100   | Docker-per-run sandbox (talks to the host Docker daemon) |
| MongoDB (Docker)       | 27017  | Users, rooms, Yjs snapshots                              |

## Tech stack

**Frontend:** React 18, Vite, Monaco, Yjs + y-websocket + y-monaco, Tailwind v4, react-router
**Server:** Express, ws, y-websocket, MongoDB driver, jsonwebtoken, cookie-parser
**Executor:** Express, dockerode
**Infra:** Docker, Docker Compose, TypeScript throughout (npm workspaces monorepo)

## Local setup

Prerequisites: **Node 20+**, **Docker Desktop** running (the executor needs the Docker daemon).

```bash
# Install all workspaces
npm install

# Start MongoDB (in Docker)
npm run mongo:up

# Pre-pull runner images (one-time, ~200 MB)
docker pull node:20-alpine
docker pull python:3.12-alpine

# Start the three services in three terminals:
npm run dev:server    # :4000
npm run dev:executor  # :4100
npm run dev:web       # :5173
```

Open http://localhost:5173 → click **Dev login** (skips GitHub OAuth).

### Optional: real GitHub OAuth

1. Register an OAuth app at https://github.com/settings/applications/new
   - Homepage URL: `http://localhost:5173`
   - Authorization callback URL: `http://localhost:5173/auth/github/callback`
2. Copy `apps/server/.env.example` to `apps/server/.env` and fill in `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` / `JWT_SECRET`.
3. Restart the server. `Sign in with GitHub` button will appear on the home page.

## Security — the executor

The executor is the interesting engineering piece. Every `POST /run` creates a **fresh container**, and every container has:

- `NetworkDisabled: true` + `NetworkMode: 'none'` — no outbound network, no DNS
- `CapDrop: ['ALL']` — zero Linux capabilities (no `CAP_NET_RAW`, no `CAP_SYS_ADMIN`, nothing)
- `SecurityOpt: ['no-new-privileges']` — setuid binaries cannot gain privileges
- `ReadonlyRootfs: true` + `Tmpfs: { '/tmp': 'rw,size=16m,nosuid,nodev' }` — nothing outside `/tmp` is writable
- `User: 'nobody'` — uid 65534, not root
- `Memory: 128 MB`, `NanoCpus: 0.5`, `PidsLimit: 64` — no resource exhaustion
- 5-second wall-clock timer → `container.kill('SIGKILL')`; runaway `while(true){}` is cut
- 64 KB stdout + 64 KB stderr caps — no log-flood DoS
- `container.remove({ force: true })` in a `finally` block — no leaked containers even on executor crash

**The collab server reads the code from its own in-memory Y.Doc**, not from the client's `/run` request. A malicious client cannot substitute different code than what is actually in the shared editor.

## Verification (end-to-end)

1. Sign in as `devuser` (or via GitHub if configured)
2. Create a room → appears in your rooms list
3. Open the room in two different browser windows → typing in one appears in the other < 100 ms; presence cursors of both users are visible with distinct colors
4. Type `console.log("hi", 1 + 1)` → click **Run ▶** → output appears in the bottom panel for **both** windows
5. Type `while(true){}` → click Run → panel shows `[timed out at 5s]` after ~5 seconds
6. Type `require("fs").readFileSync("/etc/passwd")` → exit with a `read-only file system` or `EACCES` error from the sandbox
7. `docker ps -a --filter name=codee-run` → empty (no leaked containers)
8. Stop the server process, restart it, reload the browser → your code is still there (persisted snapshot)
9. In an incognito window, open `http://localhost:5173/room/<some-id>` without signing in → redirected to the home page (protected route + 401 at the WebSocket upgrade)

## Repo layout

```
apps/
  web/                   Vite React app
  server/                collab + rooms + auth
    src/auth.ts          OAuth + JWT + cookie-parser middleware
    src/rooms.ts         REST routes + Yjs doc -> executor bridge
    src/persistence.ts   y-websocket setPersistence bindState/writeState
    src/mongo.ts         Mongo client + index setup
  executor/              Docker-per-run sandbox
    src/run.ts           dockerode container lifecycle + demuxed streams
packages/                (reserved)
docker-compose.yml       MongoDB service
```

## Known limitations / future work

- Horizontal scaling of the collab server would require sticky sessions + Redis pub/sub to broadcast Yjs updates across instances. Single-node only today.
- The executor talks to the host Docker daemon directly. Production would run the executor inside its own VM or use gVisor/Firecracker for a second isolation layer.
- Language support is JS / TS / Python. Adding more is a matter of listing them in `apps/executor/src/run.ts` and `apps/server/src/rooms.ts`.
- No chat, file tree, or voice. All would slot naturally into the existing Y.Doc as additional shared types.
