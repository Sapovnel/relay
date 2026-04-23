# Relay — Real-Time Collaborative Code Editor

A browser-based code editor where multiple users edit **and run** code together in real time. Google Docs for code, with a hardened sandbox for execution and a horizontally-scalable sync tier.

## Features

**Collaboration**
- **CRDT-based editing** (Yjs) — conflict-free, offline-tolerant
- **Multi-file rooms** — per-file Y.Text in a shared Y.Map, file tree sidebar, language inferred per file
- **Presence cursors** with a deterministic color per user
- **Follow mode** — click a peer's avatar and your viewport tracks their cursor
- **Chat sidebar** with unread counter, author colors match their cursor
- **Shareable join links** (`/join/:id`), fork-a-room, rename, delete

**Execution**
- **Docker-per-run sandbox** — fresh container per call, `NetworkDisabled`, `CapDrop: ALL`, `ReadonlyRootfs`, `no-new-privileges`, non-root user, memory + CPU + PID caps, tmpfs `/tmp`, 5-second `SIGKILL`, containers force-removed in `finally`
- **Streaming output** — NDJSON from executor, progressively mirrored into a Y.Map so every peer sees output as the container produces it
- **Stdin input** — pipe text to the running program (via a second hijacked attach call to force EOF correctly)
- **Pre-installed packages** — curated runner images bake a small library set so user code can `require('lodash')` / `import numpy` without per-run network access. JS: lodash, date-fns, uuid, ramda, zod, big.js, nanoid. Python: numpy, sympy, regex, more-itertools, pyyaml. Build with `npm run runners:build`. Falls back to vanilla node:alpine / python:alpine if the custom images aren't built yet.
- **Built-in `check` / `checkEq` assertions** — runner prepends language-specific helpers; the client parses `PASS:` / `FAIL:` lines into a test panel
- **Expected-output diff** — set an expected string; ✓/✗ banner shows after each run

**Platform**
- **GitHub OAuth** (plus a dev-login bypass for local work)
- **Rooms API** with JWT + cookie auth, membership-gated WebSocket upgrade
- **Horizontal scaling via Redis pub/sub** — any number of collab-server instances behind a sticky-session LB share Yjs updates on a per-room channel
- **Sliding-window rate limiting** on `/run` via a Redis Lua script (atomic ZADD/ZREMRANGE)
- **Prometheus `/metrics`** — HTTP latency, run counts by language + outcome, WS connections, rate-limit denials
- **Structured JSON logs** with per-request `X-Request-ID` (pino-http)
- **Server-side snapshots** to MongoDB on a 5-second debounce + last-client-leave

**UX polish**
- Command palette (**Ctrl+Shift+P**) — search any action or jump to a file
- **Ctrl+Enter** to run, **?** for keyboard shortcuts help
- Download the active file as its canonical extension
- Dark mesh-gradient theme with per-language color chips

## Architecture

```
┌──────────────┐   WebSocket (Yjs + awareness)    ┌──────────────────┐
│   Browser    │ ◄────────────────────────────── ►│   Collab Server  │
│ React +      │                                   │ Express + ws +   │
│ Monaco + Yjs │     HTTP (auth, rooms, run)       │ y-websocket +    │
│              │ ◄────────────────────────────── ►│ Mongo + Redis    │
└──────┬───────┘                                   └──┬────────────┬─┘
       │                                              │            │
       │ (dev only)                                   │ mongo      │ NDJSON (stream)
       │ Vite proxies /auth, /rooms, /ws → :4000      │ redis      ▼
       │                                              ▼            ┌──────────────┐
       │                             ┌────────────────────┐        │  Executor    │
       │                             │  MongoDB   Redis   │        │ Express +    │
       │                             │  users,    pub/sub │        │ dockerode    │
       │                             │  rooms,    ratelim │        └──────┬───────┘
       │                             │  snapshots         │               │
       │                             └────────────────────┘               │ Docker API
       │                                                                  ▼
       │                                                          ┌───────────────┐
       │                                                          │ Throw-away    │
       │                                                          │ container per │
       │                                                          │ run request   │
       │                                                          └───────────────┘
```

| Service         | Port  | Responsibility                                           |
| --------------- | ----- | -------------------------------------------------------- |
| `apps/web`      | 5173  | Vite + React + Monaco + Yjs (dev); nginx in prod         |
| `apps/server`   | 4000  | Auth, rooms REST, y-websocket, Mongo + Redis, metrics    |
| `apps/executor` | 4100  | Docker-per-run sandbox (mounts the host Docker socket)   |
| MongoDB         | 27017 | Users, rooms, Yjs snapshots                              |
| Redis           | 6379  | Cross-instance Yjs fan-out + sliding-window rate limits  |

Horizontal scaling: each `apps/server` instance subscribes to `relay:sync:<roomId>` and publishes local Y.Doc updates tagged with its instance id. Other instances apply incoming updates with an `origin` marker so they're not re-published. With Mongo + Redis as shared state, the tier scales behind a sticky-session (IP-hash or cookie-pinned) load balancer.

## Tech stack

**Frontend:** React 18, Vite, Monaco, Yjs + y-websocket + y-monaco, Tailwind v4, react-router
**Server:** Express, ws, y-websocket, MongoDB, ioredis, jsonwebtoken, prom-client, pino, pino-http
**Executor:** Express, dockerode
**Infra:** Docker, Docker Compose, nginx (prod tier), TypeScript throughout (npm workspaces monorepo)
**Testing:** Playwright E2E

## Local setup

Prerequisites: **Node 20+**, **Docker Desktop** running.

```bash
npm install

# Infra: MongoDB + Redis in Docker
npm run infra:up

# Pre-pull runner images (one-time)
docker pull node:20-alpine
docker pull python:3.12-alpine

# Build custom runner images with pre-installed packages (optional, ~2 min)
npm run runners:build

# Three terminals:
npm run dev:server     # :4000
npm run dev:executor   # :4100
npm run dev:web        # :5173
```

Open http://localhost:5173 → **Dev login** → create a room → type code → **Run ▶**.

### Sharing the dev stack on your LAN

Vite binds to `0.0.0.0` by default in this repo, so other devices on the same Wi-Fi can hit your machine. On boot Vite prints something like:

```
  ➜  Local:   http://localhost:5173/
  ➜  Network: http://192.168.1.40:5173/
```

Open the **Network** URL on your phone / second laptop. Caveats:
- Windows Firewall will prompt the first time Node binds outside localhost — allow it for *Private networks*.
- GitHub OAuth doesn't work cross-host (the callback URL is registered against `localhost:5173`). Use **Dev login** instead, or register a second OAuth app pointing at your LAN IP.

### GitHub OAuth (optional)

1. Register an app at https://github.com/settings/applications/new
   - Homepage URL: `http://localhost:5173`
   - Callback URL: `http://localhost:5173/auth/github/callback`
2. `cp apps/server/.env.example apps/server/.env` and fill in `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `JWT_SECRET`.
3. Restart the server.

### Production stack

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build
# hit http://localhost (nginx) — the SPA + reverse proxy for /auth, /rooms, /ws
```

Sets up isolated bridge network; the executor is not reachable from outside.

## Security — the executor

Every `POST /run` spawns a fresh container with all of:

- `NetworkDisabled: true` + `NetworkMode: 'none'`
- `CapDrop: ['ALL']` + `SecurityOpt: ['no-new-privileges']`
- `ReadonlyRootfs: true`, only `/tmp` writable via tmpfs (`mode=1777,nosuid,nodev`)
- `User: 'nobody'`
- `Memory: 128 MB`, `NanoCpus: 0.5`, `PidsLimit: 64`
- 5-second wall-clock timer → `container.kill('SIGKILL')`
- 64 KB stdout + 64 KB stderr caps
- `container.remove({ force: true })` in a `finally` block

**The collab server reads the code from its own in-memory Y.Doc**, not from the client's `/run` request body. A malicious client cannot substitute different code than what's actually in the shared editor.

## Observability

- **`GET /metrics`** — Prometheus text format
  - `relay_http_requests_total{method,path,status}`, `relay_http_request_duration_seconds` histogram
  - `relay_runs_total{language,outcome}` where outcome ∈ {success, failure, timeout, oom, executor_error}
  - `relay_run_duration_seconds{language}` histogram
  - `relay_ws_connections` gauge, `relay_rate_limit_denied_total{bucket}` counter
  - Plus default node.js metrics via `prom-client`
- **Structured logs** (pino) with `x-request-id` echoed back to callers and attached to every log line inside a request.

## Verification

### Unit/integration by hand

1. Dev login → create room → two tabs → type → both tabs converge instantly
2. `while(true){}` → Run → `[timed out]` after 5 s, no leaked containers (`docker ps -a --filter name=relay-run` is empty)
3. `require('fs').readFileSync('/etc/passwd')` → read-only or permission error from the sandbox
4. Stop server → restart → reload → code is still there (Yjs snapshot)
5. Rate limiting: 11 runs in 60 s → 11th returns HTTP 429 with `Retry-After`
6. Multiple server instances: start two on different ports (different `PORT` + same `REDIS_URL`) → verify a change in one instance's room appears in a client connected to the other instance

### E2E

```bash
npm run test:e2e
```

Two Playwright tests:
- Chat messages propagate between two browser contexts via Yjs
- Running code shows streamed stdout in both peers simultaneously

## Repo layout

```
apps/
  web/                 Vite React app, nginx.conf for prod
  server/              auth + rooms + y-websocket + Redis sync + metrics
    src/auth.ts        GitHub OAuth + JWT
    src/rooms.ts       REST + Y.Doc <-> executor bridge (streaming)
    src/persistence.ts setPersistence + attachRedisSync in bindState
    src/sync.ts        Yjs update pub/sub across instances
    src/redis.ts       ioredis clients + sliding-window rate limit
    src/metrics.ts     prom-client registry + counters/histograms
    src/logger.ts      pino + pino-http with request IDs
  executor/            Docker-per-run sandbox
    src/run.ts         dockerode lifecycle, hijacked stdin, streaming logs
tests/e2e/             Playwright collab + run smoke tests
docker-compose.yml         dev: Mongo + Redis
docker-compose.prod.yml    prod: + server + executor + web (behind nginx)
```

## Known limitations

- Single-row database: no cross-region replication story yet. Mongo and Redis run as single containers; production would use managed clusters.
- The executor mounts the host Docker socket — that's root-equivalent. Real-world isolation would add a second layer (gVisor, Kata, or Firecracker-managed microVMs).
- Go is scaffolded but disabled: `go run` on half a CPU compiles hello-world in ~40 s, and Docker Desktop/WSL2 mounts tmpfs with `noexec` so the linker output can't fork/exec. Real fix would be a warm compile-cache container pool and an exec-allowed writable volume.
- LSP integration (real autocomplete for Python) is not done — Monaco's built-in TypeScript support handles JS/TS; Python/Go only get syntax highlighting.
