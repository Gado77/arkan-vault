/**
 * lib/arkan-client.ts
 *
 * Centralized Arkan Vault API client.
 * Enforces strict timeouts and sanitizes errors for diagnostics.
 */

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

import { ARKAN_TIMEOUTS } from "./arkan/timeouts";

const rawUrl = process.env.ARKAN_VAULT_URL;
if (!rawUrl && process.env.NODE_ENV !== "development") {
  console.warn("[Arkan Vault] ARKAN_VAULT_URL is NOT set! Using localhost fallback in a non-development environment.");
}

export const ARKAN_BASE = normalizeBaseUrl(rawUrl ?? "http://127.0.0.1:8765");

export const ARKAN_PATHS = {
  health: "/health",
  search: "/api/v1/memories/search",
  memories: "/api/v1/memories",
} as const;

export interface ArkanMemoryResult {
  id: string;
  type: string;
  title: string;
  summary: string | null;
  content: string;
  project: string | null;
  tags: string[];
  score: number;
}

/**
 * Diagnostic logger.
 * Never logs raw memory content or credentials.
 */
export function logDiagnostic(path: string, method: string, status: number, elapsedMs: number, errorType: string) {
  console.log(
    `[Arkan Vault] ${method} ${path} | status=${status} | elapsed=${Math.round(elapsedMs)}ms | err=${errorType}`
  );
}

export function isTimeoutError(err: any): boolean {
  if (!err) return false;
  if (err.name === "AbortError" || err.name === "TimeoutError") return true;
  if (err.code === "ECONNRESET" || err.code === "ETIMEDOUT") return true;
  return false;
}

/**
 * Contract cache for /openapi.json
 */
let cachedContract: { 
  contractCompatible: boolean, 
  searchAvailable: boolean,
  hasGet: boolean,
  hasPatch: boolean,
  hasDelete: boolean 
} | null = null;

export async function arkanCheckContract() {
  if (cachedContract) return cachedContract;

  const fallback = { contractCompatible: false, searchAvailable: false, hasGet: false, hasPatch: false, hasDelete: false };

  try {
    const res = await fetch(`${ARKAN_BASE}/openapi.json`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) {
      cachedContract = fallback;
      return cachedContract;
    }
    const data = await res.json();
    const paths = data?.paths || {};
    
    const searchAvailable = !!paths[ARKAN_PATHS.search];
    const memoriesAvailable = !!paths[ARKAN_PATHS.memories];
    
    let hasGet = false, hasPatch = false, hasDelete = false;
    for (const p of Object.keys(paths)) {
      if (p.match(/^\/api\/v1\/memories\/\{[a-zA-Z0-9_-]+\}$/)) {
        hasGet = !!paths[p].get;
        hasPatch = !!paths[p].patch;
        hasDelete = !!paths[p].delete;
        break;
      }
    }
    
    cachedContract = {
      contractCompatible: searchAvailable && memoriesAvailable,
      searchAvailable,
      hasGet,
      hasPatch,
      hasDelete
    };
    return cachedContract;
  } catch (err) {
    return fallback;
  }
}

/**
 * GET /health
 */
export async function arkanHealth(): Promise<{ isOnline: boolean, latencyMs: number }> {
  const start = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ARKAN_TIMEOUTS.health);

  try {
    const res = await fetch(`${ARKAN_BASE}${ARKAN_PATHS.health}`, { signal: controller.signal });
    clearTimeout(timer);

    const elapsed = performance.now() - start;
    const ok = res.ok;
    
    if (!ok) {
      logDiagnostic(ARKAN_PATHS.health, "GET", res.status, elapsed, "http_error");
      return { isOnline: false, latencyMs: elapsed };
    }

    try {
      const data = await res.json();
      const statusOk = data?.status === "ok";
      logDiagnostic(ARKAN_PATHS.health, "GET", res.status, elapsed, statusOk ? "none" : "bad_payload");
      return { isOnline: statusOk, latencyMs: elapsed };
    } catch {
      logDiagnostic(ARKAN_PATHS.health, "GET", res.status, elapsed, "json_parse_error");
      return { isOnline: false, latencyMs: elapsed };
    }
  } catch (err: any) {
    clearTimeout(timer);
    const elapsed = performance.now() - start;
    const errType = err.name === "AbortError" ? "timeout" : "network_error";
    logDiagnostic(ARKAN_PATHS.health, "GET", 0, elapsed, errType);
    return { isOnline: false, latencyMs: elapsed };
  }
}

export async function arkanGetStatus() {
  const health = await arkanHealth();
  const contract = await arkanCheckContract();
  
  const isTailscale = ARKAN_BASE.includes("tailnet") || ARKAN_BASE.includes("ts.net");
  const isRemote = ARKAN_BASE !== "http://127.0.0.1:8765";
  const mode = isTailscale ? "Tailscale Serve" : (isRemote ? "Remote" : "Local Fallback");

  return {
    arkanOnline: health.isOnline,
    contractCompatible: contract.contractCompatible,
    searchAvailable: contract.searchAvailable,
    latencyMs: health.latencyMs,
    mode: mode
  };
}

export class ArkanClientError extends Error {
  constructor(
    message: string,
    public readonly errorType:
      | "arkan_timeout"
      | "arkan_network_error"
      | "arkan_http_error"
      | "arkan_bad_payload",
    public readonly httpStatus?: number,
    public readonly elapsedMs?: number,
  ) {
    super(message);
    this.name = "ArkanClientError";
  }
}

/**
 * // Legacy memory functions have been moved to memory-gateway.ts
 */

