/**
 * lib/arkan/capability-registry.ts
 *
 * Fetches and caches the OpenAPI schema from Arkan Vault to enforce capabilities.
 * Prevents calling endpoints that the server does not support (e.g. PATCH/DELETE).
 */

import { ARKAN_BASE, ARKAN_PATHS, logDiagnostic } from "@/lib/arkan-client";

interface ArkanCapabilities {
  contractCompatible: boolean;
  searchAvailable: boolean;
  hasGet: boolean;
  hasPatch: boolean;
  hasDelete: boolean;
}

declare global {
  var arkanCapabilityCache: {
    caps: ArkanCapabilities;
    loadedAt: number;
  } | undefined;
}

const REGISTRY_TTL_MS = 60 * 1000; // 1 minute

const fallbackCaps: ArkanCapabilities = {
  contractCompatible: false,
  searchAvailable: false,
  hasGet: false,
  hasPatch: false,
  hasDelete: false
};

export async function getCapabilities(): Promise<ArkanCapabilities> {
  const now = Date.now();
  if (global.arkanCapabilityCache && (now - global.arkanCapabilityCache.loadedAt < REGISTRY_TTL_MS)) {
    return global.arkanCapabilityCache.caps;
  }

  try {
    const start = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${ARKAN_BASE}/openapi.json`, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) {
      return fallbackCaps;
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
    
    const caps: ArkanCapabilities = {
      contractCompatible: searchAvailable && memoriesAvailable,
      searchAvailable,
      hasGet,
      hasPatch,
      hasDelete
    };

    global.arkanCapabilityCache = {
      caps,
      loadedAt: now
    };

    return caps;
  } catch (err) {
    return fallbackCaps;
  }
}

export async function checkOpenApi(operation: "get" | "patch" | "delete") {
  const caps = await getCapabilities();
  if (operation === "get" && !caps.hasGet) throw new Error("operation_unsupported");
  if (operation === "patch" && !caps.hasPatch) throw new Error("operation_unsupported");
  if (operation === "delete" && !caps.hasDelete) throw new Error("operation_unsupported");
}
