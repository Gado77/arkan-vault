/**
 * lib/arkan/memory-gateway.ts
 *
 * Centralized Memory Gateway V1.
 * Acts as the sole entry point for Arkan memory operations (READ/WRITE).
 * Implements strict post-condition verification (Read-After-Write) and idempotency.
 */

import { ARKAN_BASE, ARKAN_PATHS, logDiagnostic, ArkanMemoryResult, isTimeoutError } from "@/lib/arkan-client";
import { getJournalEntry, setJournalEntry, ToolResult, createDeleteAction, getDeleteAction, confirmDeleteAction, findPendingDeleteActionForMemory, removeDeleteAction } from "./memory-state";
import { syncBootstrapCache } from "./bootstrap-cache";
import { getCapabilities } from "./capability-registry";
import { ARKAN_TIMEOUTS } from "./timeouts";

export async function arkanRecall(query: string, limit: number): Promise<ArkanMemoryResult[]> {
  const start = performance.now();
  const safeLimit = Math.max(1, Math.min(limit, 5));
  const params = new URLSearchParams({ q: query, limit: String(safeLimit) });
  const path = `${ARKAN_PATHS.search}?${params}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);

  try {
    const res = await fetch(`${ARKAN_BASE}${path}`, { signal: controller.signal });
    clearTimeout(timer);
    
    const elapsed = performance.now() - start;
    if (!res.ok) {
      logDiagnostic(ARKAN_PATHS.search, "GET", res.status, elapsed, "http_error");
      throw new Error(`Arkan HTTP Error: ${res.status}`);
    }

    const data = await res.json();
    logDiagnostic(ARKAN_PATHS.search, "GET", res.status, elapsed, "none");
    
    const results = data;
    if (!Array.isArray(results)) {
       throw new Error("Invalid payload from Arkan");
    }

    return results.map((r: any) => {
      const mem = r.memory || {};
      const score = typeof r.score === "number" ? r.score : 0;
      const content = typeof mem.content === "string" ? mem.content : "";
      
      return {
        id: mem.id ?? "",
        type: mem.type ?? "memory",
        title: mem.title ?? "",
        summary: mem.summary ?? null,
        content: content,
        project: mem.project ?? null,
        tags: Array.isArray(mem.tags) ? mem.tags : [],
        score
      };
    });
  } catch (err: any) {
    clearTimeout(timer);
    const elapsed = performance.now() - start;
    const errType = err.name === "AbortError" ? "timeout" : "network_error";
    logDiagnostic(ARKAN_PATHS.search, "GET", 0, elapsed, errType);
    throw new Error(`Arkan connection failed: ${errType}`);
  }
}

export async function arkanGet(id: string, options?: { timeoutMs?: number }): Promise<ArkanMemoryResult | null> {
  const start = performance.now();
  const path = `${ARKAN_PATHS.memories}/${id}`;
  const timeoutMs = options?.timeoutMs ?? ARKAN_TIMEOUTS.read;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${ARKAN_BASE}${path}`, { signal: controller.signal });
    clearTimeout(timer);
    
    const elapsed = performance.now() - start;
    
    if (res.status === 404) {
      logDiagnostic(path, "GET", 404, elapsed, "none");
      return null;
    }

    if (!res.ok) {
      logDiagnostic(path, "GET", res.status, elapsed, "http_error");
      throw new Error(`Arkan HTTP Error: ${res.status}`);
    }

    const data = await res.json();
    logDiagnostic(path, "GET", res.status, elapsed, "none");
    
    return {
      id: data.id ?? "",
      type: data.type ?? "memory",
      title: data.title ?? "",
      summary: data.summary ?? null,
      content: typeof data.content === "string" ? data.content : "",
      project: data.project ?? null,
      tags: Array.isArray(data.tags) ? data.tags : [],
      score: 1.0
    };
  } catch (err: any) {
    clearTimeout(timer);
    const elapsed = performance.now() - start;
    const errType = err.name === "AbortError" ? "timeout" : "network_error";
    logDiagnostic(path, "GET", 0, elapsed, errType);
    throw new Error(`Arkan GET connection failed: ${errType}`);
  }
}

export async function arkanList(filters: any, timeoutMs: number = ARKAN_TIMEOUTS.search): Promise<ArkanMemoryResult[]> {
  const start = performance.now();
  
  const params = new URLSearchParams();
  if (filters) {
    if (filters.project) params.set("project", filters.project);
    if (filters.type) params.set("type", filters.type);
    if (filters.limit) params.set("limit", String(filters.limit));
    if (filters.tags && Array.isArray(filters.tags) && filters.tags.length > 0) {
      filters.tags.forEach((t: string) => params.append("tags", t));
    }
  }

  const queryStr = params.toString();
  const path = `${ARKAN_PATHS.memories}${queryStr ? "?" + queryStr : ""}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${ARKAN_BASE}${path}`, { signal: controller.signal });
    clearTimeout(timer);
    
    const elapsed = performance.now() - start;
    
    if (!res.ok) {
      logDiagnostic(ARKAN_PATHS.memories, "GET LIST", res.status, elapsed, "http_error");
      return [];
    }

    const data = await res.json();
    logDiagnostic(ARKAN_PATHS.memories, "GET LIST", res.status, elapsed, "none");
    
    if (!Array.isArray(data)) {
      return [];
    }

    return data.map((mem: any) => ({
      id: mem.id ?? "",
      type: mem.type ?? "memory",
      title: mem.title ?? "",
      summary: mem.summary ?? null,
      content: typeof mem.content === "string" ? mem.content : "",
      project: mem.project ?? null,
      tags: Array.isArray(mem.tags) ? mem.tags : [],
      score: 1.0
    }));
  } catch (err: any) {
    clearTimeout(timer);
    const elapsed = performance.now() - start;
    const errType = err.name === "AbortError" ? "timeout" : "network_error";
    logDiagnostic(ARKAN_PATHS.memories, "GET LIST", 0, elapsed, errType);
    return [];
  }
}

export async function arkanCreate(memory: any, sessionId: string, callId: string): Promise<ToolResult> {
  // 1. Idempotency Check
  const cachedResult = getJournalEntry(sessionId, callId);
  if (cachedResult) return cachedResult;

  const start = performance.now();
  const path = ARKAN_PATHS.memories;
  const timeoutMs = ARKAN_TIMEOUTS.create;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(`${ARKAN_BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(memory),
      signal: controller.signal,
    });
    clearTimeout(timer);
    
    const elapsedMs = performance.now() - start;

    if (!res.ok) {
      logDiagnostic(path, "POST", res.status, elapsedMs, "http_error");
      return { ok: false, verified: false, operation: "create", error: { code: "memory_unavailable" } };
    }

    const data = await res.json();
    logDiagnostic(path, "POST", res.status, elapsedMs, "none");

    const newId = data.id;
    if (!newId) {
       return { ok: false, verified: false, operation: "create", error: { code: "create_failed_no_id" } };
    }

    // 2. Read-After-Write Verification
    const verification = await arkanGet(newId, { timeoutMs: ARKAN_TIMEOUTS.verificationRead });
    if (!verification) {
      const result: ToolResult = { 
        ok: false, 
        verified: false, 
        operation: "create", 
        error: { code: "create_verification_failed" } 
      };
      setJournalEntry(sessionId, callId, result);
      return result;
    }

    // Optional deeper verification: compare title
    if (memory.title && verification.title !== memory.title) {
       const result: ToolResult = { 
         ok: false, 
         verified: false, 
         operation: "create", 
         error: { code: "create_verification_failed" } 
       };
       setJournalEntry(sessionId, callId, result);
       return result;
    }

    const result: ToolResult = { 
      ok: true, 
      verified: true, 
      operation: "create", 
      data: { memory_id: newId, saved: true },
      diagnostics: { latencyMs: elapsedMs }
    };
    
    setJournalEntry(sessionId, callId, result);
    return result;

  } catch (err: any) {
    const elapsedMs = performance.now() - start;
    const isTimeout = isTimeoutError(err);
    logDiagnostic(path, "POST", 0, elapsedMs, isTimeout ? "timeout" : "network_error");
    
    const result: ToolResult = {
      ok: false,
      verified: false,
      operation: "create",
      error: { code: isTimeout ? "mutation_outcome_unknown" : "memory_unavailable" }
    };
    
    // For CREATE, we cache the unknown outcome to prevent retry
    setJournalEntry(sessionId, callId, result);
    return result;
  }
}

export async function arkanUpdate(id: string, patch: any, sessionId: string, callId: string): Promise<ToolResult> {
  // 1. Idempotency Check
  const cachedResult = getJournalEntry(sessionId, callId);
  if (cachedResult) return cachedResult;

  const caps = await getCapabilities();
  if (!caps.updateMethod) {
    return { ok: false, verified: false, operation: "update", error: { code: "operation_unsupported" } };
  }

  const start = performance.now();
  const path = `${ARKAN_PATHS.memories}/${id}`;
  const timeoutMs = ARKAN_TIMEOUTS.update;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(`${ARKAN_BASE}${path}`, {
      method: caps.updateMethod,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
      signal: controller.signal,
    });
    clearTimeout(timer);
    
    const elapsedMs = performance.now() - start;

    if (!res.ok) {
      logDiagnostic(path, caps.updateMethod, res.status, elapsedMs, "http_error");
      return { ok: false, verified: false, operation: "update", error: { code: "memory_unavailable" } };
    }
    
    logDiagnostic(path, caps.updateMethod, res.status, elapsedMs, "none");

    // 2. Read-After-Write Verification
    const verification = await arkanGet(id, { timeoutMs: ARKAN_TIMEOUTS.verificationRead });
    if (!verification) {
      const result: ToolResult = { 
        ok: false, 
        verified: false, 
        operation: "update", 
        error: { code: "mutation_not_applied" } 
      };
      setJournalEntry(sessionId, callId, result);
      return result;
    }

    let verified = true;
    if (patch.title !== undefined && patch.title !== verification.title) verified = false;
    if (patch.summary !== undefined && patch.summary !== verification.summary) verified = false;
    if (patch.content !== undefined && patch.content !== verification.content) verified = false;
    if (patch.project !== undefined && patch.project !== verification.project) verified = false;
    if (patch.tags !== undefined) {
      const pTags = [...patch.tags].sort();
      const uTags = [...verification.tags].sort();
      if (pTags.join(",") !== uTags.join(",")) verified = false;
    }

    if (!verified) {
      const result: ToolResult = { 
        ok: false, 
        verified: false, 
        operation: "update", 
        error: { code: "mutation_not_applied" } 
      };
      setJournalEntry(sessionId, callId, result);
      return result;
    }

    const result: ToolResult = { 
      ok: true, 
      verified: true, 
      operation: "update", 
      data: { memory_id: id, saved: true },
      diagnostics: { latencyMs: elapsedMs }
    };
    
    setJournalEntry(sessionId, callId, result);
    return result;

  } catch (err: any) {
    const elapsedMs = performance.now() - start;
    const isTimeout = isTimeoutError(err);
    logDiagnostic(path, caps.updateMethod, 0, elapsedMs, isTimeout ? "timeout" : "network_error");
    
    if (isTimeout) {
      // 3. Bounded reconciliation for UPDATE
      const checkMatch = (v: ArkanMemoryResult) => {
        if (patch.title !== undefined && patch.title !== v.title) return false;
        if (patch.summary !== undefined && patch.summary !== v.summary) return false;
        if (patch.content !== undefined && patch.content !== v.content) return false;
        if (patch.project !== undefined && patch.project !== v.project) return false;
        if (patch.tags !== undefined) {
          const pTags = [...patch.tags].sort();
          const uTags = [...v.tags].sort();
          if (pTags.join(",") !== uTags.join(",")) return false;
        }
        return true;
      };

      for (let i = 0; i < 3; i++) {
        try {
          const verification = await arkanGet(id, { timeoutMs: ARKAN_TIMEOUTS.verificationRead });
          if (verification && checkMatch(verification)) {
            const result: ToolResult = {
              ok: true,
              verified: true,
              operation: "update",
              data: { memory_id: id, saved: true, recoveredAfterTimeout: true },
              diagnostics: { latencyMs: elapsedMs }
            };
            setJournalEntry(sessionId, callId, result);
            return result;
          }
        } catch (e) {
          // ignore verification read error during reconciliation
        }
        const backoffMs = i === 0 ? 500 : (i === 1 ? 1000 : 0);
        if (backoffMs > 0) {
          await new Promise(r => setTimeout(r, backoffMs));
        }
      }

      const result: ToolResult = {
        ok: false,
        verified: false,
        operation: "update",
        error: { code: "mutation_outcome_unknown" }
      };
      setJournalEntry(sessionId, callId, result);
      return result;
    }

    return { ok: false, verified: false, operation: "update", error: { code: "memory_unavailable" } };
  }
}

export async function prepareDelete(memoryId: string, logicalSessionId: string): Promise<ToolResult> {
  // 1. Verify Memory Exists
  const memory = await arkanGet(memoryId);
  if (!memory) {
    return { ok: false, verified: false, operation: "delete_prepare", error: { code: "not_found" } };
  }

  // 2. Check for existing pending action to avoid duplication
  let pendingAction = findPendingDeleteActionForMemory(logicalSessionId, memoryId);
  if (!pendingAction) {
    pendingAction = createDeleteAction(logicalSessionId, memoryId, memory.title);
  }

  // ZERO DELETE EXECUTED. Only prepared.
  return {
    ok: false,
    verified: false,
    operation: "delete_prepare",
    data: {
      confirmation_required: true,
      action_id: pendingAction.actionId,
      memory_id: memoryId,
      title: memory.title
    }
  };
}

export async function commitDelete(actionId: string, logicalSessionId: string, callId: string): Promise<ToolResult> {
  // 1. Idempotency Check
  const cachedResult = getJournalEntry(logicalSessionId, callId);
  if (cachedResult) return cachedResult;

  const action = getDeleteAction(actionId);
  
  if (!action) {
    return { ok: false, verified: false, operation: "delete_commit", error: { code: "action_not_found" } };
  }
  
  if (action.logicalSessionId !== logicalSessionId) {
    return { ok: false, verified: false, operation: "delete_commit", error: { code: "action_session_mismatch" } };
  }


  const start = performance.now();
  const path = `${ARKAN_PATHS.memories}/${action.memoryId}`;
  
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ARKAN_TIMEOUTS.delete);

    const res = await fetch(`${ARKAN_BASE}${path}`, {
      method: "DELETE",
      signal: controller.signal,
    });
    clearTimeout(timer);
    
    const elapsedMs = performance.now() - start;

    if (!res.ok && res.status !== 404) {
      logDiagnostic(path, "DELETE", res.status, elapsedMs, "http_error");
      return { ok: false, verified: false, operation: "delete_commit", error: { code: "memory_unavailable" } };
    }

    logDiagnostic(path, "DELETE", res.status, elapsedMs, "none");

    // 2. Verify Post-Condition: memory should no longer exist
    const verification = await arkanGet(action.memoryId, { timeoutMs: ARKAN_TIMEOUTS.verificationRead });
    if (verification) {
      const result: ToolResult = { 
        ok: false, 
        verified: false, 
        operation: "delete_commit", 
        error: { code: "mutation_not_applied" } 
      };
      setJournalEntry(logicalSessionId, callId, result);
      return result;
    }

    // Successfully deleted
    removeDeleteAction(actionId);

    const result: ToolResult = { 
      ok: true, 
      verified: true, 
      operation: "delete_commit", 
      data: { memory_id: action.memoryId, deleted: true },
      diagnostics: { latencyMs: elapsedMs }
    };
    
    setJournalEntry(logicalSessionId, callId, result);
    return result;
  } catch (err: any) {
    const elapsedMs = performance.now() - start;
    const isTimeout = isTimeoutError(err);
    logDiagnostic(path, "DELETE", 0, elapsedMs, isTimeout ? "timeout" : "network_error");
    
    if (isTimeout) {
      // 3. Bounded reconciliation for DELETE
      for (let i = 0; i < 3; i++) {
        try {
          const verification = await arkanGet(action.memoryId, { timeoutMs: ARKAN_TIMEOUTS.verificationRead });
          if (verification === null) {
            removeDeleteAction(actionId);
            const result: ToolResult = {
              ok: true,
              verified: true,
              operation: "delete_commit",
              data: { memory_id: action.memoryId, deleted: true, recoveredAfterTimeout: true },
              diagnostics: { latencyMs: elapsedMs }
            };
            setJournalEntry(logicalSessionId, callId, result);
            return result;
          }
        } catch (e) {
          // ignore verification read error during reconciliation
        }
        const backoffMs = i === 0 ? 500 : (i === 1 ? 1000 : 0);
        if (backoffMs > 0) {
          await new Promise(r => setTimeout(r, backoffMs));
        }
      }

      const result: ToolResult = {
        ok: false,
        verified: false,
        operation: "delete_commit",
        error: { code: "mutation_outcome_unknown" }
      };
      setJournalEntry(logicalSessionId, callId, result);
      return result;
    }

    return { ok: false, verified: false, operation: "delete_commit", error: { code: "memory_unavailable" } };
  }
}

export async function resolveCanonicalProfile(): Promise<{ profile: ArkanMemoryResult | null, error: string | null }> {
  const memories = await arkanList({ project: "hermes-profile", tags: ["always-context"] }, ARKAN_TIMEOUTS.search);
  const profiles = memories.filter((m: any) => m.title === "Hermes — Perfil Base do Usuário" && m.tags.includes("profile-base"));
  
  if (profiles.length === 0) {
    return { profile: null, error: "profile_not_found" };
  }
  if (profiles.length > 1) {
    return { profile: null, error: "profile_conflict" };
  }
  return { profile: profiles[0], error: null };
}

export function parseProfileBase(content: string) {
  const v1Match = content.match(/<!-- HERMES_PROFILE_V1_START -->([\s\S]*?)<!-- HERMES_PROFILE_V1_END -->/);
  if (v1Match) {
    try {
      const parsed = JSON.parse(v1Match[1].trim());
      return {
        name: parsed.name || "",
        preferred_name: parsed.preferred_name || "",
        language: parsed.language || "",
        conversation_style: parsed.conversation_style || "",
        preferences: Array.isArray(parsed.preferences) ? parsed.preferences : []
      };
    } catch {
      // fallback
    }
  }

  const lines = content.split('\n');
  let name = "", preferred = "", lang = "", style = "";
  let prefs: string[] = [];

  for (const line of lines) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) {
      const key = match[1].trim();
      const val = match[2].trim();
      if (key === "Nome") name = val;
      else if (key === "Como chamar") preferred = val;
      else if (key === "Idioma") lang = val;
      else if (key === "Estilo") style = val;
    }
    if (line.trim().startsWith("- ")) {
      prefs.push(line.replace("- ", "").trim());
    }
  }

  return { name, preferred_name: preferred, language: lang, conversation_style: style, preferences: prefs };
}

export function renderProfileV1(profileData: any): string {
  const jsonStr = JSON.stringify({
    schema_version: 1,
    name: profileData.name || "",
    preferred_name: profileData.preferred_name || "",
    language: profileData.language || "",
    conversation_style: profileData.conversation_style || "",
    preferences: profileData.preferences || []
  }, null, 2);

  return `<!-- HERMES_PROFILE_V1_START -->\n${jsonStr}\n<!-- HERMES_PROFILE_V1_END -->`;
}

export async function updateProfile(patch: any, sessionId: string, callId: string): Promise<ToolResult> {
  const cachedResult = getJournalEntry(sessionId, callId);
  if (cachedResult) return cachedResult;

  const { profile: profileMem, error: resolveError } = await resolveCanonicalProfile();
  
  if (resolveError === "profile_conflict") {
    return { ok: false, verified: false, operation: "profile_update", error: { code: "profile_conflict" } };
  }

  let currentData = { name: "", preferred_name: "", language: "", conversation_style: "", preferences: [] as string[] };
  if (profileMem) {
    currentData = parseProfileBase(profileMem.content);
  }

  if (patch.name !== undefined) currentData.name = patch.name;
  if (patch.preferred_name !== undefined) currentData.preferred_name = patch.preferred_name;
  if (patch.language !== undefined) currentData.language = patch.language;
  if (patch.conversation_style !== undefined) currentData.conversation_style = patch.conversation_style;
  
  if (patch.preferences && Array.isArray(patch.preferences)) {
    for (const p of patch.preferences) {
      if (!currentData.preferences.includes(p)) currentData.preferences.push(p);
    }
  }

  const newContent = renderProfileV1(currentData);

  const payload = {
    title: "Hermes — Perfil Base do Usuário",
    summary: "Configurações persistentes de personalidade e identidade do usuário.",
    content: newContent,
    project: "hermes-profile",
    tags: ["always-context", "profile-base"]
  };

  let result: ToolResult;
  if (profileMem) {
    result = await arkanUpdate(profileMem.id, { content: payload.content }, sessionId, callId + "_upd");
  } else {
    result = await arkanCreate(payload, sessionId, callId + "_crt");
  }

  if (result.ok && result.verified) {
    await syncBootstrapCache();
    
    const finalResult = {
      ok: true,
      verified: true,
      operation: "profile_update",
      data: { updated: true, profile: currentData }
    };
    setJournalEntry(sessionId, callId, finalResult);
    return finalResult;
  }

  setJournalEntry(sessionId, callId, result);
  return result;
}
