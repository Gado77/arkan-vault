/**
 * app/api/live-session/persist/route.ts
 *
 * POST /api/live-session/persist
 *
 * Internal endpoint — NOT exposed as a Gemini Live tool.
 * Saves the voice conversation as a MemoryObject (type="conversation") in Arkan.
 *
 * Design decisions:
 *  - Idempotent by sessionId: in-memory dedup Map prevents double-saves.
 *  - keepalive: true on client → works even if browser navigates away.
 *  - Timeout 2000ms — longer than tool bridge since user isn't waiting for this.
 *  - Empty sessions (no transcripts) are not saved.
 *  - type="conversation" is always forced here; arkan_remember always forces "memory".
 */

import { NextRequest, NextResponse } from "next/server";
import { arkanCreate } from "@/lib/arkan/memory-gateway";

// In-memory dedup store (process-lifetime TTL; sufficient for MVP).
// Map<sessionId, timestamp>
const persistedSessions = new Map<string, number>();

// Clean entries older than 24h to avoid unbounded growth.
function cleanOldEntries() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, ts] of persistedSessions) {
    if (ts < cutoff) persistedSessions.delete(id);
  }
}

function isUUID(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f-]{8,}$/i.test(v);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { sessionId, inputTranscript, outputTranscript } = body as {
    sessionId: unknown;
    inputTranscript: unknown;
    outputTranscript: unknown;
  };

  if (!isUUID(sessionId))
    return NextResponse.json({ error: "Invalid sessionId" }, { status: 400 });

  const input = typeof inputTranscript === "string" ? inputTranscript.trim() : "";
  const output = typeof outputTranscript === "string" ? outputTranscript.trim() : "";

  // Don't save empty sessions.
  if (!input && !output) {
    return NextResponse.json({ skipped: true, reason: "empty_session" });
  }

  // Idempotency check.
  cleanOldEntries();
  if (persistedSessions.has(sessionId)) {
    return NextResponse.json({ skipped: true, reason: "already_persisted" });
  }
  persistedSessions.set(sessionId, Date.now());

  // Build conversation content in Markdown.
  const now = new Date();
  const dateLabel = now.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const timeLabel = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const firstWords = (input || output).split(/\s+/).slice(0, 6).join(" ");
  const title = `Conversa Hermes — ${dateLabel} ${timeLabel} · ${firstWords}`;

  const lines: string[] = ["# Conversa por voz — Hermes\n"];
  if (input) {
    lines.push("## Usuário (transcrição)\n");
    lines.push(input + "\n");
  }
  if (output) {
    lines.push("## Hermes (transcrição)\n");
    lines.push(output + "\n");
  }
  const content = lines.join("\n");

  const arkanBody = {
    type: "conversation",
    title,
    content,
    tags: ["voice", "gemini-live"],
    context: {
      source: "gemini-live",
      channel: "voice",
      session_id: sessionId,
    },
  };

  try {
    const result = await arkanCreate(arkanBody, sessionId as string, "persist_" + Date.now());
    if (!result.ok) throw new Error("Arkan unavailable");
    return NextResponse.json({ saved: true, id: result.data?.memory_id });
  } catch (err: unknown) {
    persistedSessions.delete(sessionId as string);
    return NextResponse.json({ error: "arkan_unavailable" }, { status: 502 });
  }
}
