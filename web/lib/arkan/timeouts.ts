/**
 * lib/arkan/timeouts.ts
 *
 * Centralized timeout configurations for Arkan Vault communication.
 * Allows environment overrides to adapt to slower backends.
 */

function parseTimeout(envVar: string | undefined, defaultMs: number): number {
  if (!envVar) return defaultMs;
  const parsed = parseInt(envVar, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return defaultMs;
}

export const ARKAN_TIMEOUTS = {
  health: parseTimeout(process.env.ARKAN_TIMEOUT_HEALTH_MS, 3000),
  capabilities: parseTimeout(process.env.ARKAN_TIMEOUT_CAPABILITIES_MS, 8000),
  read: parseTimeout(process.env.ARKAN_TIMEOUT_READ_MS, 6000),
  search: parseTimeout(process.env.ARKAN_TIMEOUT_SEARCH_MS, 6000),
  create: parseTimeout(process.env.ARKAN_TIMEOUT_CREATE_MS, 20000),
  update: parseTimeout(process.env.ARKAN_TIMEOUT_UPDATE_MS, 20000),
  delete: parseTimeout(process.env.ARKAN_TIMEOUT_DELETE_MS, 20000),
  verificationRead: parseTimeout(process.env.ARKAN_TIMEOUT_VERIFY_MS, 8000),
} as const;
