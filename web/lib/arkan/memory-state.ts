/**
 * lib/arkan/memory-state.ts
 *
 * Ephemeral memory state for the Arkan Gateway.
 * Stores ExecutionJournal (idempotency) and DeleteActions (Two-Phase commit).
 * Uses globalThis to survive module reloads in Next.js development.
 * Restarts clear the state.
 */

export interface ToolResult<T = any> {
  ok: boolean;
  verified: boolean;
  operation: string;
  data?: T;
  error?: { code: string };
  diagnostics?: any;
}

export interface DeletePrepareData {
  confirmation_required: true;
  action_id: string;
  memory_id: string;
  title: string;
}

export interface DeleteAction {
  actionId: string;
  logicalSessionId: string;
  memoryId: string;
  title: string;
  requestedAt: number;
  expiresAt: number;
}

declare global {
  var arkanExecutionJournal: Map<string, { result: ToolResult; expiresAt: number }>;
  var arkanDeleteActions: Map<string, DeleteAction>; // Keyed by actionId
}

if (!global.arkanExecutionJournal) {
  global.arkanExecutionJournal = new Map();
}
if (!global.arkanDeleteActions) {
  global.arkanDeleteActions = new Map();
}

// ── Idempotency (Execution Journal) ──────────────────────────────────────────

export const JOURNAL_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function getJournalEntry(sessionId: string, callId: string): ToolResult | null {
  const key = `${sessionId}:${callId}`;
  const entry = global.arkanExecutionJournal.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    global.arkanExecutionJournal.delete(key);
    return null;
  }
  return entry.result;
}

export function setJournalEntry(sessionId: string, callId: string, result: ToolResult): void {
  const key = `${sessionId}:${callId}`;
  global.arkanExecutionJournal.set(key, {
    result,
    expiresAt: Date.now() + JOURNAL_TTL_MS
  });
}

// ── Two-Phase Delete Actions ────────────────────────────────────────────────

export function createDeleteAction(logicalSessionId: string, memoryId: string, title: string, ttlMs: number = 60000): DeleteAction {
  const actionId = crypto.randomUUID();
  const action: DeleteAction = {
    actionId,
    logicalSessionId,
    memoryId,
    title,
    requestedAt: Date.now(),
    expiresAt: Date.now() + ttlMs,
  };
  global.arkanDeleteActions.set(actionId, action);
  return action;
}

export function getDeleteAction(actionId: string): DeleteAction | null {
  const action = global.arkanDeleteActions.get(actionId);
  if (!action) return null;
  if (Date.now() > action.expiresAt) {
    global.arkanDeleteActions.delete(actionId);
    return null;
  }
  return action;
}

/** 
 * Returns an existing pending action for the exact same session + memory, 
 * to prevent duplicating actions on function call retries.
 */
export function findPendingDeleteActionForMemory(logicalSessionId: string, memoryId: string): DeleteAction | null {
  for (const action of global.arkanDeleteActions.values()) {
    if (action.logicalSessionId === logicalSessionId && action.memoryId === memoryId) {
       if (Date.now() <= action.expiresAt) {
         return action;
       } else {
         global.arkanDeleteActions.delete(action.actionId);
       }
    }
  }
  return null;
}



export function removeDeleteAction(actionId: string): void {
  global.arkanDeleteActions.delete(actionId);
}
