// Central backend endpoint configuration.
//
// Local dev falls back to the backend on localhost:8000. Deployed builds read
// VITE_API_BASE (e.g. a Cloudflare Tunnel https URL); the WebSocket base is
// derived from it so http->ws and https->wss stay in sync automatically.

const DEFAULT_API_BASE = "http://localhost:8000";

const rawBase = (import.meta.env.VITE_API_BASE ?? DEFAULT_API_BASE).trim();

// Strip any trailing slash so callers can safely concatenate "/path".
export const API_BASE = rawBase.replace(/\/+$/, "");

export const WS_BASE = API_BASE.replace(/^http/, "ws");
