/**
 * lib/gemini-live/types.ts
 *
 * Shared types for the Gemini Live engine.
 * Consumed by: hooks/use-gemini-live.ts, /live-test, /
 */

// ─── Capture mode ─────────────────────────────────────────────────────────────

export type CaptureMode =
  | "wake"         // waiting for Hey Jarvis
  | "transition"   // wake word detected, processing greeting/buffer
  | "gemini"       // actively sending PCM to Gemini
  | "hard_off";    // microphone physically stopped, total privacy

// ─── Session state ────────────────────────────────────────────────────────────

export type SessionState =
  | "disconnected"  // no WebSocket open
  | "sleeping"      // wake listening, Gemini off
  | "connecting"    // fetching token + opening WS
  | "ready"         // setupComplete received, mic off (gemini capture mode off)
  | "listening"     // mic active, receiving PCM
  | "thinking"      // model processing (after speech_end)
  | "using_memory"  // arkan_recall or arkan_remember in flight
  | "speaking"      // audio arriving / playing
  | "interrupted"   // barge-in handled
  | "reconnecting"  // goAway/error → trying to resume
  | "wake_detected" // wake word detected, waking up
  | "error";        // unrecoverable, shows error message

// ─── Metric marks ─────────────────────────────────────────────────────────────


export type MetricMark =
  // Session lifecycle
  | "session_connect_started"
  | "session_setup_complete"
  | "wake_detected_at"
  // Audio input
  | "first_audio_input_sent"
  | "speech_started"
  | "last_voice_activity"
  | "speech_end_detected"
  // Audio output
  | "first_output_audio_received"
  | "first_output_audio_played"
  // Interruption
  | "interruption_detected"
  | "playback_stopped"
  // Turn
  | "turn_complete"
  // Tool calls
  | "tool_call_received"
  | "tool_backend_started"
  | "tool_backend_finished"
  | "tool_response_sent";

export type Metrics = Partial<Record<MetricMark, number>>;

// ─── Per-turn summary ─────────────────────────────────────────────────────────

export interface TurnMetrics {
  connectionMs: number;
  ttfaReceived: number;   // last_voice_activity → first_output_audio_received
  ttfaPlayed: number;     // last_voice_activity → first_output_audio_played
  speechEndMs: number;    // last_voice_activity → speech_end_detected
  bargeInMs: number;      // interruption_detected → playback_stopped
  toolCallMs: number;     // tool_call_received → tool_response_sent (0 if no tool call)
  bytesSent: number;
  bytesReceived: number;
  sessionDurationMs: number;
  errors429: number;
  reconnections: number;
  memoryResultsCount: number;
}

// ─── Logical session vs WebSocket connection ──────────────────────────────────

/**
 * A logical session survives reconnects.
 * sessionId: created once at connect(), cleared only on real disconnect.
 * connectionId: created for every new WebSocket.
 * resumptionHandle: latest handle from sessionResumptionUpdate; used on reconnect.
 */
export interface LogicalSession {
  sessionId: string;
  connectionId: string;
  resumptionHandle: string | undefined;
  startedAt: number;      // performance.now()
  persisted: boolean;     // idempotency guard for /api/live-session/persist
}

// ─── Tool call types ──────────────────────────────────────────────────────────

export interface FunctionCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface FunctionResponse {
  id: string;
  name: string;
  response: Record<string, unknown>;
}

export interface ToolCallEvent {
  functionCalls: FunctionCall[];
}

// ─── Arkan tool argument shapes ───────────────────────────────────────────────

export interface ArkanRecallArgs {
  query: string;
  limit?: number;    // default 4, max 5
  project?: string;
}

export interface ArkanRememberArgs {
  title: string;
  content: string;
  project?: string;
  tags?: string[];
}

// ─── Tool bridge request/response ────────────────────────────────────────────

export interface LiveToolRequest {
  sessionId: string;
  callId: string;
  name: "arkan_recall" | "arkan_remember";
  args: ArkanRecallArgs | ArkanRememberArgs;
}

export interface LiveToolResponse {
  results?: ArkanMemoryResult[];   // arkan_recall
  id?: string;                     // arkan_remember
  error?: string;
}

// ─── Arkan API response shape (subset) ───────────────────────────────────────

export interface ArkanMemoryResult {
  id: string;
  title: string;
  summary: string | null;
  excerpt: string;   // first 200 chars of content
  project: string | null;
  tags: string[];
  created_at: string;
}

// ─── Hook options ─────────────────────────────────────────────────────────────

export interface UseGeminiLiveOptions {
  /** Whether to include arkan_recall/arkan_remember tools in the setup. */
  enableTools?: boolean;
  /** Custom system instruction. Defaults to the Hermes identity instruction. */
  systemInstruction?: string;
  /** Silence duration in ms for VAD (default 800). Only applied before connecting. */
  silenceDurationMs?: number;
}
