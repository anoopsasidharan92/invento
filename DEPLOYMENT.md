# Deployment — Vercel frontend + local backend

The frontend is a static Vite/React SPA and deploys to Vercel for free. The
backend stays on this machine: it runs long-lived agent subprocesses, holds
process state in memory, writes to the local filesystem, and talks to Ollama —
none of which survive a serverless or free-tier host.

A Cloudflare Tunnel bridges the two, since a HTTPS page cannot call
`http://localhost` (browser mixed-content blocking).

```
Browser ──► Vercel (static SPA) ──► Cloudflare Tunnel ──► localhost:8000
```

## One-time setup

### 1. Deploy the frontend

```bash
cd frontend
vercel            # first run links the project
vercel --prod
```

Note the deployed URL, e.g. `https://your-app.vercel.app`.

### 2. Allow that origin on the backend

```bash
cp backend/.env.example backend/.env
```

Set in `backend/.env`:

```
ALLOWED_ORIGINS=https://your-app.vercel.app
```

Preview deployments get a new subdomain per build; to allow them all:

```
ALLOWED_ORIGIN_REGEX=https://.*-yourteam\.vercel\.app
```

## Running it

Three processes, each in its own terminal.

**1. Backend**

```bash
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

**2. Tunnel**

```bash
./scripts/start-tunnel.sh
```

Prints a URL like `https://random-words.trycloudflare.com`.

**3. Point the frontend at the tunnel**

```bash
cd frontend
vercel env add VITE_API_BASE production   # paste the tunnel URL
vercel --prod
```

Ollama must also be running (`ollama serve`) since the backend uses
`llama3.2` locally.

## The quick-tunnel caveat

`trycloudflare.com` URLs are **regenerated every restart**, so step 3 has to be
repeated each time. To get a stable URL, use a named tunnel with a domain you
own on Cloudflare:

```bash
cloudflared tunnel login
cloudflared tunnel create inventory-backend
cloudflared tunnel route dns inventory-backend api.yourdomain.com
cloudflared tunnel run --url http://localhost:8000 inventory-backend
```

Then set `VITE_API_BASE=https://api.yourdomain.com` once and leave it.

## Local-only development

No tunnel or Vercel needed — `VITE_API_BASE` defaults to `localhost:8000`:

```bash
cd backend && uvicorn main:app --port 8000 --reload
cd frontend && npm run dev
```

## Security notes

- The tunnel makes your backend **publicly reachable** while running. It has no
  authentication, spawns subprocesses, and reads local files. Stop the tunnel
  (Ctrl-C) when you are not using it, and don't share the URL.
- CORS is an explicit allowlist, not `*`, so other websites can't call your
  backend from a browser. This does not stop direct (non-browser) requests to
  the tunnel URL.
- `.env` files are gitignored; only `.env.example` templates are tracked.

## Configuration reference

| Variable | Where | Purpose |
|---|---|---|
| `VITE_API_BASE` | Vercel env / `frontend/.env` | Backend base URL. WebSocket URL derived automatically (`https`→`wss`). |
| `ALLOWED_ORIGINS` | `backend/.env` | Comma-separated extra origins. Localhost always allowed. |
| `ALLOWED_ORIGIN_REGEX` | `backend/.env` | Regex for Vercel preview domains. |
