/**
 * app/api/live-tools/execute/route.ts
 *
 * POST /api/live-tools/execute
 *
 * Secure tool bridge between Gemini Live function calls and the Arkan Vault API.
 */

import { NextRequest, NextResponse } from "next/server";
import { arkanRecall, arkanGet, arkanList, arkanCreate, arkanUpdate, prepareDelete, commitDelete, updateProfile } from "@/lib/arkan/memory-gateway";

import { ARKAN_SERVER_TOOL_NAMES } from "@/lib/arkan/tool-names";

const TOOL_ALLOWLIST = new Set(ARKAN_SERVER_TOOL_NAMES);
const MAX_PAYLOAD_CHARS = 5000;
const RECALL_LIMIT_MAX = 5;
const RECALL_LIMIT_DEFAULT = 4;


// ── Validation helpers ────────────────────────────────────────────────────────

function isString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isUUID(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f-]{8,}$/i.test(v);
}

function triggerBootstrapRefresh(reqUrl: string) {
  // Fire and forget refresh to update the global cache
  const url = new URL("/api/live-session/bootstrap/refresh", reqUrl);
  fetch(url.toString(), { method: "POST" }).catch(() => {});
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { sessionId, callId, name, args } = body as {
    sessionId: unknown;
    callId: unknown;
    name: unknown;
    args: unknown;
  };

  // Validate envelope.
  if (!isUUID(sessionId)) return NextResponse.json({ error: "Invalid sessionId" }, { status: 400 });
  if (!isString(callId)) return NextResponse.json({ error: "Invalid callId" }, { status: 400 });
  if (!isString(name)) return NextResponse.json({ error: "Invalid name" }, { status: 400 });
  if (!TOOL_ALLOWLIST.has(name as any)) return NextResponse.json({ error: "Unknown tool" }, { status: 400 });
  if (typeof args !== "object" || args === null || Array.isArray(args))
    return NextResponse.json({ error: "Invalid args" }, { status: 400 });

  const safeArgs = args as Record<string, unknown>;

  if (name === "arkan_recall") return handleRecall(safeArgs, sessionId as string);
  if (name === "arkan_remember") return handleRemember(safeArgs, sessionId as string, callId as string, req.url);
  if (name === "arkan_get") return handleGet(safeArgs, sessionId as string);
  if (name === "arkan_list") return handleList(safeArgs, sessionId as string);
  if (name === "arkan_update") return handleUpdate(safeArgs, sessionId as string, callId as string, req.url);
  if (name === "arkan_delete") return handleDeletePrepare(safeArgs, sessionId as string);
  if (name === "arkan_delete_commit") return handleDeleteCommit(safeArgs, sessionId as string, callId as string, req.url);
  if (name === "arkan_profile_update") return handleProfileUpdate(safeArgs, sessionId as string, callId as string, req.url);

  return NextResponse.json({ error: "Unknown tool" }, { status: 400 });
}

// ── arkan_recall ──────────────────────────────────────────────────────────────

async function handleRecall(
  args: Record<string, unknown>,
  _sessionId: string,
): Promise<NextResponse> {
  const query = args.query;
  if (!isString(query)) return NextResponse.json({ error: "query is required" }, { status: 400 });

  const rawLimit = typeof args.limit === "number" ? Math.min(args.limit, RECALL_LIMIT_MAX) : RECALL_LIMIT_DEFAULT;
  const limit = Math.max(1, Math.min(rawLimit, RECALL_LIMIT_MAX));

  try {
    const results = await arkanRecall(query, limit);

    let combined = JSON.stringify(results);
    if (combined.length > MAX_PAYLOAD_CHARS) {
      while (results.length > 1 && combined.length > MAX_PAYLOAD_CHARS) {
        results.pop();
        combined = JSON.stringify(results);
      }
      if (combined.length > MAX_PAYLOAD_CHARS && results.length > 0) {
        const last = results[results.length - 1];
        const excess = combined.length - MAX_PAYLOAD_CHARS;
        last.content = last.content.slice(0, Math.max(0, last.content.length - excess));
      }
    }

    return NextResponse.json({ ok: true, count: results.length, results });
  } catch (err: any) {
    if (err.name === "ArkanClientError") {
      return NextResponse.json({ 
        error: "memory_unavailable", 
        errorType: err.errorType, 
        status: err.httpStatus || 502, 
        elapsedMs: err.elapsedMs || 0 
      }, { status: 502 });
    }
    return NextResponse.json({ error: "memory_unavailable" }, { status: 502 });
  }
}

// ── arkan_remember ────────────────────────────────────────────────────────────

async function handleRemember(
  args: Record<string, unknown>,
  sessionId: string,
  callId: string,
  reqUrl: string
): Promise<NextResponse> {
  const title = args.title;
  const content = args.content;

  if (!isString(title)) return NextResponse.json({ error: "title is required" }, { status: 400 });
  if (!isString(content)) return NextResponse.json({ error: "content is required" }, { status: 400 });

  const project = typeof args.project === "string" ? args.project : undefined;
  const tags = Array.isArray(args.tags)
    ? (args.tags as unknown[]).filter((t): t is string => typeof t === "string")
    : [];

  const arkanBody = {
    type: "memory",
    title,
    content,
    ...(project ? { project } : {}),
    tags,
    context: {
      source: "gemini-live",
      channel: "voice",
      session_id: sessionId,
    },
  };

  try {
    const result = await arkanCreate(arkanBody, sessionId, callId);
    
    if (result.ok && result.verified) {
      triggerBootstrapRefresh(reqUrl);
      return NextResponse.json({ 
        ok: true,
        verified: true,
        id: result.data.memory_id, 
        saved: true,
        profileContextChanged: true,
        profileUpdate: { action: "created", title, project, tags } 
      });
    }

    return NextResponse.json(result);
  } catch (err: unknown) {
    return NextResponse.json({ ok: false, verified: false, error: "memory_unavailable" });
  }
}

// ── arkan_get ─────────────────────────────────────────────────────────────────

async function handleGet(args: Record<string, unknown>, _sessionId: string): Promise<NextResponse> {
  const memoryId = args.memory_id;
  if (!isString(memoryId)) return NextResponse.json({ error: "memory_id is required" }, { status: 400 });

  try {
    const result = await arkanGet(memoryId);
    if (!result) return NextResponse.json({ error: "not_found" });
    return NextResponse.json({ ok: true, memory: result });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "memory_unavailable" }, { status: 502 });
  }
}

// ── arkan_list ────────────────────────────────────────────────────────────────

async function handleList(args: Record<string, unknown>, _sessionId: string): Promise<NextResponse> {
  const project = typeof args.project === "string" ? args.project : undefined;
  const type = typeof args.type === "string" ? args.type : undefined;
  const tags = Array.isArray(args.tags) ? (args.tags as string[]) : undefined;
  const limit = typeof args.limit === "number" ? args.limit : 20;

  try {
    const results = await arkanList({ project, type, tags, limit });
    return NextResponse.json({ ok: true, count: results.length, results });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "memory_unavailable" }, { status: 502 });
  }
}

// ── arkan_update ──────────────────────────────────────────────────────────────

async function handleUpdate(args: Record<string, unknown>, sessionId: string, callId: string, reqUrl: string): Promise<NextResponse> {
  const memoryId = args.memory_id;
  if (!isString(memoryId)) return NextResponse.json({ error: "memory_id is required" }, { status: 400 });

  const rawPatch = args.patch as Record<string, any>;
  if (typeof rawPatch !== "object" || rawPatch === null) return NextResponse.json({ error: "patch is required" }, { status: 400 });

  const patch: Record<string, any> = {};
  if (typeof rawPatch.title === "string") patch.title = rawPatch.title;
  if (typeof rawPatch.summary === "string") patch.summary = rawPatch.summary;
  if (typeof rawPatch.content === "string") patch.content = rawPatch.content;
  if (typeof rawPatch.project === "string") patch.project = rawPatch.project;
  if (Array.isArray(rawPatch.tags)) patch.tags = rawPatch.tags.filter((t: any) => typeof t === "string");

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "empty_patch" }, { status: 400 });
  }

  try {
    const result = await arkanUpdate(memoryId, patch, sessionId, callId);
    
    if (result.ok && result.verified) {
      triggerBootstrapRefresh(reqUrl);
      return NextResponse.json({ 
        ok: true,
        verified: true,
        profileContextChanged: true,
        profileUpdate: { action: "updated", memoryId, patch }
      });
    }

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ ok: false, verified: false, error: err.message || "memory_unavailable" });
  }
}

// ── arkan_delete ──────────────────────────────────────────────────────────────

async function handleDeletePrepare(args: Record<string, unknown>, sessionId: string): Promise<NextResponse> {
  const memoryId = args.memory_id;
  if (typeof memoryId !== "string") return NextResponse.json({ error: "memory_id is required" }, { status: 400 });

  const result = await prepareDelete(memoryId, sessionId);
  return NextResponse.json(result);
}

// ── arkan_delete_commit ───────────────────────────────────────────────────────

async function handleDeleteCommit(args: Record<string, unknown>, sessionId: string, callId: string, reqUrl: string): Promise<NextResponse> {
  const actionId = args.action_id;
  if (typeof actionId !== "string") return NextResponse.json({ error: "action_id is required" }, { status: 400 });

  try {
    const result = await commitDelete(actionId, sessionId, callId);
    
    if (result.ok && result.verified) {
      triggerBootstrapRefresh(reqUrl);
      return NextResponse.json({
        ...result,
        profileContextChanged: true,
        profileUpdate: { action: "deleted", memoryId: result.data.memory_id }
      });
    }

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ ok: false, verified: false, error: "memory_unavailable" });
  }
}

// ── arkan_profile_update ──────────────────────────────────────────────────────

async function handleProfileUpdate(args: Record<string, unknown>, sessionId: string, callId: string, reqUrl: string): Promise<NextResponse> {
  const patch = args.patch;
  if (!patch || typeof patch !== "object") return NextResponse.json({ error: "patch object is required" }, { status: 400 });

  try {
    const result = await updateProfile(patch, sessionId, callId);
    
    if (result.ok && result.verified) {
      triggerBootstrapRefresh(reqUrl);
      return NextResponse.json(result);
    }
    
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "memory_unavailable" }, { status: 502 });
  }
}
