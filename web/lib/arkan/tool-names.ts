/**
 * lib/arkan/tool-names.ts
 *
 * Source of truth for server-side allowed tools.
 */
export const ARKAN_SERVER_TOOL_NAMES = [
  "arkan_recall",
  "arkan_get",
  "arkan_list",
  "arkan_remember",
  "arkan_update",
  "arkan_delete",
  "arkan_delete_commit",
  "arkan_profile_update"
] as const;

export type ArkanToolName = typeof ARKAN_SERVER_TOOL_NAMES[number];
