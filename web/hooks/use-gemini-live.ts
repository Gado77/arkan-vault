"use client";

/**
 * hooks/use-gemini-live.ts
 *
 * Core Gemini Live session hook. Handles:
 *  - Ephemeral token acquisition (fresh token per WebSocket connection)
 *  - WebSocket lifecycle: open → setup → audio → tool calls → close
 *  - Session resumption: sessionId survives reconnects, new token per reconnect
 *  - Tool calls: multiple functionCalls per event, single toolResponse message
 *  - Barge-in: interrupt queue and reset state on serverContent.interrupted
 *  - Conversation persistence: only on real logical session end
 *  - goAway: reconnect with preserved resumptionHandle
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AudioPlaybackQueue, arrayBufferToBase64 } from "../lib/gemini-live/audio-queue";
import {
  LIVE_TOOL_DECLARATIONS,
  CMD_SLEEP,
  CMD_STOP,
  CMD_MIC_OFF,
  CMD_HARD_MIC_OFF,
  CMD_END_NATURAL,
  GEMINI_LIVE_WS,
  HERMES_SYSTEM_INSTRUCTION,
} from "../lib/gemini-live/constants";
import { audioCaptureEngine } from "../lib/audio/audio-capture-engine";
import type {
  FunctionCall,
  FunctionResponse,
  LogicalSession,
  MetricMark,
  Metrics,
  SessionState,
  TurnMetrics,
  UseGeminiLiveOptions,
} from "../lib/gemini-live/types";

const VOICE_IDLE_TIMEOUT_MS = 10000;

// ─── Public API surface ───────────────────────────────────────────────────────

export type WakeStatus = "offline" | "connecting" | "listening" | "error";

export interface GeminiLiveState {
  state: SessionState;
  micActive: boolean;
  micLevel: number;           // 0–1 RMS normalised
  inputTranscript: string;
  outputTranscript: string;
  metrics: Metrics;
  turnHistory: TurnMetrics[];
  lastError: string;
  wsCloseCode: number | null;
  sessionDurationSec: number;
  activeModel: string;
  interruptCount: number;
  errors429Count: number;
  reconnections: number;
  bytesSent: number;
  bytesReceived: number;
  silenceDurationMs: number;
  /** true only while a logical session is active AND setup is complete (survives reconnects). */
  isConnected: boolean;
  canToggleMic: boolean;

  // Wake Word Diagnostics
  wakeStatus: WakeStatus;
  wakeModel: string;
  wakeThreshold: number;
  wakeLastError: string;
  wakeScore: number;
  wakePeakScore: number;
  wakePcmFramesSent: number;
  wakePythonFramesProcessed: number;
  wakeCount: number;
  captureActive: boolean;
  diagnosticIds: Record<string, string | number | boolean>;
  bootstrapMetrics: { source: string, count: number, chars: number, ageMs: number } | null;
}

export interface GeminiLiveActions {
  connect(): void;
  disconnect(): void;
  toggleMic(): void;
  setSilenceDurationMs(ms: number): void;
}

export type UseGeminiLiveReturn = GeminiLiveState & GeminiLiveActions;

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useGeminiLive(options: UseGeminiLiveOptions = {}): UseGeminiLiveReturn {
  const {
    enableTools = true,
    systemInstruction = HERMES_SYSTEM_INSTRUCTION,
    silenceDurationMs: initialSilenceMs = 800,
  } = options;

  // ── State ──────────────────────────────────────────────────────────────────

  const [state, setState] = useState<SessionState>("sleeping");
  const [micActive, setMicActive] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [inputTranscript, setInputTranscript] = useState("");
  const [outputTranscript, setOutputTranscript] = useState("");
  const [metrics, setMetrics] = useState<Metrics>({});
  const [turnHistory, setTurnHistory] = useState<TurnMetrics[]>([]);
  const [lastError, setLastError] = useState("");
  const [wsCloseCode, setWsCloseCode] = useState<number | null>(null);
  const [sessionDurationSec, setSessionDurationSec] = useState(0);
  const [activeModel, setActiveModel] = useState("—");
  const [interruptCount, setInterruptCount] = useState(0);
  const [errors429Count, setErrors429Count] = useState(0);
  const [reconnections, setReconnections] = useState(0);
  const [bytesSent, setBytesSent] = useState(0);
  const [bytesReceived, setBytesReceived] = useState(0);
  const [silenceDurationMs, setSilenceDurationMsState] = useState(initialSilenceMs);

  const [wakeStatus, setWakeStatus] = useState<WakeStatus>("offline");
  const [wakeModel, setWakeModel] = useState("—");
  const [wakeThreshold, setWakeThreshold] = useState(0.5);
  const [wakeLastError, setWakeLastError] = useState("");
  const [wakeScore, setWakeScore] = useState(0);
  const [wakePeakScore, setWakePeakScore] = useState(0);
  const [wakePcmFramesSent, setWakePcmFramesSent] = useState(0);
  const [wakePythonFramesProcessed, setWakePythonFramesProcessed] = useState(0);
  const [wakeCount, setWakeCount] = useState(0);
  const [captureActive, setCaptureActive] = useState(false);
  
  const [bootstrapMetrics, setBootstrapMetrics] = useState<{ source: string, count: number, chars: number, ageMs: number } | null>(null);


  // ── Refs (mutable, no re-render) ───────────────────────────────────────────

  const stateRef = useRef<SessionState>("sleeping");
  const sessionRef = useRef<LogicalSession | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const audioQueueRef = useRef<AudioPlaybackQueue | null>(null);
  const setupCompleteRef = useRef(false);
  const pcmCallbackRef = useRef<((buffer: ArrayBuffer) => void) | null>(null);
  const metricsRef = useRef<Metrics>({});
  const bytesSentRef = useRef(0);
  const bytesReceivedRef = useRef(0);
  const micLevelRafRef = useRef<number | null>(null);
  const modelRef = useRef("—");
  const silenceDurationMsRef = useRef(initialSilenceMs);
  const reconnectAttemptRef = useRef(false);
  const inputTranscriptRef = useRef("");
  const outputTranscriptRef = useRef("");
  const memoryResultsCountRef = useRef(0);
  const wakeWsRef = useRef<WebSocket | null>(null);
  const wakePcmCallbackRef = useRef<((buffer: ArrayBuffer) => void) | null>(null);
  const wakePcmFramesSentRef = useRef(0);
  const wakePeakScoreRef = useRef(0);
  const wakeReconnectTimeoutRef = useRef<number | null>(null);
  const wakeActivationRef = useRef(false);
  const activationSourceRef = useRef<"manual" | "wake">("manual");
  const idleTimeoutRef = useRef<number | null>(null);
  const wakeTransitionTimeoutRef = useRef<number | null>(null);

  // ── Helpers ────────────────────────────────────────────────────────────────

  function setStateAndRef(s: SessionState) {
    stateRef.current = s;
    setState(s);
  }

  function mark(name: MetricMark) {
    const t = performance.now();
    metricsRef.current = { ...metricsRef.current, [name]: t };
    setMetrics({ ...metricsRef.current });
  }

  function gap(m: Metrics, a: MetricMark, b: MetricMark): number {
    const ta = m[a] ?? 0;
    const tb = m[b] ?? 0;
    if (!ta || !tb) return 0;
    return Math.max(0, Math.round(tb - ta));
  }

  function setSilenceDurationMs(ms: number) {
    silenceDurationMsRef.current = ms;
    setSilenceDurationMsState(ms);
  }

  // ── Idle Timeout 10s based purely on state = ready
  useEffect(() => {
    let timeout: number | null = null;
    if (state === "ready") {
      timeout = window.setTimeout(() => {
        if (stateRef.current === "ready") {
          console.log("[GeminiLive] Idle timeout (10s) reached.");
          void disconnect();
        }
      }, VOICE_IDLE_TIMEOUT_MS);
    }
    return () => {
      if (timeout) window.clearTimeout(timeout);
    };
  }, [state]);

  // ── Session timer ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!sessionRef.current) { setSessionDurationSec(0); return; }
    const startedAt = sessionRef.current.startedAt;
    const id = window.setInterval(() => {
      setSessionDurationSec(Math.round((performance.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [sessionRef.current?.sessionId]);

  // ── Mic level visualiser ───────────────────────────────────────────────────

  function startMicLevelLoop() {
    const analyser = audioCaptureEngine.getAnalyser();
    if (!analyser) return;
    const levels = new Uint8Array(analyser.fftSize);
    function loop() {
      analyser!.getByteTimeDomainData(levels);
      const rms = Math.sqrt(
        levels.reduce((s, v) => s + ((v - 128) / 128) ** 2, 0) / levels.length,
      );
      setMicLevel(Math.min(1, rms * 6));
      micLevelRafRef.current = requestAnimationFrame(loop);
    }
    micLevelRafRef.current = requestAnimationFrame(loop);
  }

  function stopMicLevelLoop() {
    if (micLevelRafRef.current !== null) {
      cancelAnimationFrame(micLevelRafRef.current);
      micLevelRafRef.current = null;
    }
    setMicLevel(0);
  }

  // ── Internal: open WebSocket for a session ─────────────────────────────────

  async function openConnection(
    logicalSession: LogicalSession,
    queue: AudioPlaybackQueue,
    isReconnect = false,
    bootstrapText = "",
  ): Promise<void> {
    // 1. Fresh ephemeral token for every WebSocket connection (uses: 1).
    let accessToken: string;
    let model: string;
    try {
      const res = await fetch("/api/gemini-live/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      if (res.status === 429) {
        setErrors429Count((n) => n + 1);
        throw new Error("Cota Gemini esgotada (429). Tente novamente mais tarde.");
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error((body.error as string) || `Falha ao obter token (${res.status})`);
      }
      const data = await res.json() as { accessToken: string; model: string };
      accessToken = data.accessToken;
      model = data.model;
      modelRef.current = model;
      setActiveModel(model);
    } catch (err) {
      throw err;
    }

    // 2. Open WebSocket with fresh token.
    const connectionId = crypto.randomUUID();
    logicalSession.connectionId = connectionId;
    const wsUrl = `${GEMINI_LIVE_WS}?access_token=${encodeURIComponent(accessToken)}`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      // 3. Send setup once per connection.
      const setupMsg: Record<string, unknown> = {
        setup: {
          model: `models/${model}`,
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } },
            },
            thinkingConfig: { thinkingBudget: 0 },
          },
          systemInstruction: { parts: [{ text: systemInstruction + (bootstrapText ? "\n\n" + bootstrapText : "") }] },
          ...(enableTools ? { tools: [LIVE_TOOL_DECLARATIONS] } : {}),
          realtimeInputConfig: {
            automaticActivityDetection: {
              disabled: false,
              silenceDurationMs: silenceDurationMsRef.current,
            },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          contextWindowCompression: { slidingWindow: {} },
          sessionResumption: logicalSession.resumptionHandle
            ? { handle: logicalSession.resumptionHandle }
            : {},
        },
      };
      if (enableTools && setupMsg.setup && (setupMsg.setup as any).tools) {
        const t = (setupMsg.setup as any).tools;
        if (!Array.isArray(t) || t.length < 1) {
          console.error("Invalid tools array");
        } else if (!Array.isArray(t[0].functionDeclarations)) {
          console.error("Invalid functionDeclarations array");
        } else if (t[0].name) {
          console.error("tools[0] cannot have a name property directly!");
        } else {
          console.log("Gemini tools wrapper: valid");
          console.log("Function declarations:", t[0].functionDeclarations.length);
          console.log("Names:", t[0].functionDeclarations.map((fd: any) => fd.name).join(", "));
        }
      }
      ws.send(JSON.stringify(setupMsg));
    };

    ws.onmessage = (event) => handleWsMessage(event, queue, logicalSession);

    ws.onerror = () => {
      setLastError("Erro na conexão WebSocket com a Gemini Live API");
    };

    ws.onclose = (ev) => {
      setWsCloseCode(ev.code);
      setupCompleteRef.current = false;
      stopMic();

      if (ev.code === 1000 || ev.code === 1001) {
        // Clean close — handled by the caller (disconnect or goAway reconnect).
        return;
      }
      if (reconnectAttemptRef.current) {
        // Already attempting reconnect (goAway flow) — don't override.
        return;
      }
      setLastError(`WebSocket fechou com código ${ev.code}: ${ev.reason || "sem motivo"}`);
      setStateAndRef("error");
    };
  }

  // ── Internal: handle incoming WS messages ─────────────────────────────────

  function handleWsMessage(
    event: MessageEvent,
    queue: AudioPlaybackQueue,
    logicalSession: LogicalSession,
  ) {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(
        typeof event.data === "string"
          ? event.data
          : new TextDecoder().decode(event.data as ArrayBuffer),
      ) as Record<string, unknown>;
    } catch { return; }

    const rawLen =
      typeof event.data === "string"
        ? new TextEncoder().encode(event.data).length
        : (event.data as ArrayBuffer).byteLength;
    bytesReceivedRef.current += rawLen;
    setBytesReceived(bytesReceivedRef.current);

    // setupComplete
    if (msg.setupComplete !== undefined) {
      setupCompleteRef.current = true;
      mark("session_setup_complete");
      
      if (activationSourceRef.current === "wake") {
        if (wakeTransitionTimeoutRef.current) {
          window.clearTimeout(wakeTransitionTimeoutRef.current);
          wakeTransitionTimeoutRef.current = null;
        }
        void startMic();
      } else {
        setStateAndRef("ready");
      }
      return;
    }

    // sessionResumptionUpdate — store latest handle
    if (msg.sessionResumptionUpdate) {
      const update = msg.sessionResumptionUpdate as Record<string, unknown>;
      const handle = update.newHandle as string | undefined;
      if (handle) logicalSession.resumptionHandle = handle;
      return;
    }

    // goAway — reconnect preserving handle
    if (msg.goAway) {
      void handleGoAway(queue, logicalSession);
      return;
    }

    // toolCall — multiple function calls, one response
    if (msg.toolCall) {
      const tc = msg.toolCall as Record<string, unknown>;
      const functionCalls = (tc.functionCalls as FunctionCall[] | undefined) ?? [];
      if (functionCalls.length > 0) {
        void handleToolCalls(functionCalls, logicalSession);
      }
      return;
    }

    // serverContent
    const serverContent = msg.serverContent as Record<string, unknown> | undefined;
    if (serverContent) {
      // interrupted (barge-in)
      if (serverContent.interrupted) {
        mark("turn_interrupted");
        mark("interruption_detected");
        setStateAndRef("interrupted");
        setInterruptCount((n) => n + 1);
        queue.interrupt();
        mark("playback_stopped");
        setStateAndRef("ready");
        return;
      }

      // modelTurn
      const modelTurn = serverContent.modelTurn as Record<string, unknown> | undefined;
      if (modelTurn) {
        const parts = (modelTurn.parts as Record<string, unknown>[]) ?? [];
        for (const part of parts) {
          const inlineData = part.inlineData as Record<string, unknown> | undefined;
          if (inlineData?.data) {
            const base64 = inlineData.data as string;
            const binary = atob(base64);
            const buf = new ArrayBuffer(binary.length);
            const view = new Uint8Array(buf);
            for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i);
            bytesReceivedRef.current += buf.byteLength;

            if (!metricsRef.current.first_output_audio_received) {
              mark("first_response_token_received");
              setStateAndRef("speaking");
            }
            const isFirst = !metricsRef.current.first_output_audio_played;
            queue.enqueue(buf, isFirst ? () => { mark("first_output_audio_played"); } : undefined);
            if (isFirst) setStateAndRef("speaking");
          }
          if (typeof part.text === "string") {
            setOutputTranscript((prev) => prev + part.text);
            outputTranscriptRef.current += part.text;
          }
        }
      }

      // inputTranscription
      const inputTranscription = serverContent.inputTranscription as Record<string, unknown> | undefined;
      if (inputTranscription) {
        const text = (inputTranscription.transcript as string) ?? "";
        if (text) {
          setInputTranscript((prev) => prev + text);
          inputTranscriptRef.current += text;
          mark("speech_end_detected");

          if (CMD_SLEEP.test(text) || CMD_END_NATURAL.test(text)) {
            void disconnect();
            return;
          }
          if (CMD_MIC_OFF.test(text) || CMD_HARD_MIC_OFF.test(text)) {
            stopMic();
            return;
          }
          if (CMD_STOP.test(text)) {
            queue.interrupt();
            mark("playback_stopped");
            setStateAndRef("ready");
          }
        }
      }

      // outputTranscription
      const outputTranscription = serverContent.outputTranscription as Record<string, unknown> | undefined;
      if (outputTranscription) {
        const text = (outputTranscription.transcript as string) ?? "";
        if (text) {
          setOutputTranscript((prev) => prev + text);
          outputTranscriptRef.current += text;
        }
      }
      // turnComplete
      if (serverContent.turnComplete) {
        mark("turn_completed");
        finalizeTurnMetrics();
        setStateAndRef("ready");
      }
    }

    if (msg.generationComplete) {
      mark("turn_complete");
      finalizeTurnMetrics();
      setStateAndRef("ready");
    }
  }

  // ── Internal: handle multiple tool calls in a single event ────────────────

  async function handleToolCalls(
    functionCalls: FunctionCall[],
    logicalSession: LogicalSession,
  ) {
    mark("tool_call_received");
    setStateAndRef("using_memory");

    const functionResponses: FunctionResponse[] = [];
    let memCount = 0;

    for (const fc of functionCalls) {
      mark("tool_backend_started");
      let output: unknown;
      try {
        const res = await fetch("/api/live-tools/execute", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sessionId: logicalSession.sessionId,
            callId: fc.id,
            name: fc.name,
            args: fc.args,
          }),
        });
        const data = await res.json();
        mark("tool_backend_finished");
        if (data.error) {
          output = { error: data.error };
        } else {
          output = data;
          if (Array.isArray(data.results)) memCount += data.results.length;
        }
      } catch {
        mark("tool_backend_finished");
        output = { error: "memory_unavailable" };
      }

      functionResponses.push({
        id: fc.id,        // MUST match the received id exactly
        name: fc.name,
        response: (output && typeof output === "object") ? (output as Record<string, unknown>) : ({ output } as Record<string, unknown>),
      });
    }

    memoryResultsCountRef.current += memCount;

    // Send a single toolResponse with all responses.
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ toolResponse: { functionResponses } }));
      mark("tool_response_sent");
    }

    setStateAndRef("thinking");
  }

  // ── Internal: goAway → reconnect ──────────────────────────────────────────

  async function handleGoAway(queue: AudioPlaybackQueue, logicalSession: LogicalSession) {
    reconnectAttemptRef.current = true;
    setStateAndRef("reconnecting");
    setReconnections((n) => n + 1);

    stopMic();
    queue.interrupt();   // never replay old audio after reconnect

    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close(1000, "goAway_reconnect");
    }
    wsRef.current = null;

    await new Promise<void>((r) => window.setTimeout(r, 300));

    // Re-use the same logical session and preserved handle; fresh token.
    try {
      await openConnection(logicalSession, queue, true);
      reconnectAttemptRef.current = false;
    } catch (err) {
      reconnectAttemptRef.current = false;
      setLastError(err instanceof Error ? err.message : "Falha ao reconectar");
      setStateAndRef("error");
    }
  }

  // ── Internal: finalise per-turn metrics ───────────────────────────────────

  function finalizeTurnMetrics() {
    const m = metricsRef.current;
    const sess = sessionRef.current;
    const turn: TurnMetrics = {
      connectionMs: gap(m, "session_connect_started", "session_setup_complete"),
      ttfaReceived: gap(m, "last_voice_activity", "first_output_audio_received"),
      ttfaPlayed: gap(m, "last_voice_activity", "first_output_audio_played"),
      speechEndMs: gap(m, "last_voice_activity", "speech_end_detected"),
      bargeInMs: gap(m, "interruption_detected", "playback_stopped"),
      toolCallMs: gap(m, "tool_call_received", "tool_response_sent"),
      bytesSent: bytesSentRef.current,
      bytesReceived: bytesReceivedRef.current,
      sessionDurationMs: sess ? Math.round(performance.now() - sess.startedAt) : 0,
      errors429: errors429Count,
      reconnections,
      memoryResultsCount: memoryResultsCountRef.current,
    };
    setTurnHistory((prev) => [...prev, turn]);
    metricsRef.current = {
      session_connect_started: metricsRef.current.session_connect_started,
      session_setup_complete: metricsRef.current.session_setup_complete,
    };
    setMetrics(metricsRef.current);
    memoryResultsCountRef.current = 0;
  }

  // ── Internal: microphone ──────────────────────────────────────────────────

  async function startMic() {
    if (!setupCompleteRef.current) return;
    if (pcmCallbackRef.current) return; // Already listening

    await audioCaptureEngine.initialize();
    audioCaptureEngine.addDestination("gemini-live");

    startMicLevelLoop();

    let firstSent = false;
    const cb = (buffer: ArrayBuffer) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (!setupCompleteRef.current) return;

      if (!firstSent) {
        firstSent = true;
        mark("first_audio_input_sent");
        mark("speech_started");
      }
      mark("last_voice_activity");
      mark("last_voice_activity");

      const b64 = arrayBufferToBase64(buffer);
      const msg = JSON.stringify({
        realtimeInput: { audio: { mimeType: "audio/pcm;rate=16000", data: b64 } },
      });
      ws.send(msg);
      bytesSentRef.current += msg.length;
      setBytesSent(bytesSentRef.current);
    };

    pcmCallbackRef.current = cb;
    audioCaptureEngine.onPcmData(cb);

    setMicActive(true);
    setStateAndRef("listening");
  }

  function stopMic() {
    stopMicLevelLoop();
    if (pcmCallbackRef.current) {
      audioCaptureEngine.offPcmData(pcmCallbackRef.current);
      pcmCallbackRef.current = null;
    }
    audioCaptureEngine.removeDestination("gemini-live");
    
    setMicActive(false);
    if (stateRef.current === "listening") setStateAndRef("ready");
  }

  const toggleMic = useCallback(async () => {
    if (micActive) {
      stopMic();
    } else {
      try { await startMic(); }
      catch (err) { setLastError(err instanceof Error ? err.message : "Falha ao acessar microfone"); }
    }
  }, [micActive]);

  // ── Internal: persist conversation (only on real logical session end) ──────

  async function persistConversation(logicalSession: LogicalSession) {
    // Idempotency: only persist once per sessionId.
    if (logicalSession.persisted) return;
    const input = inputTranscriptRef.current.trim();
    const output = outputTranscriptRef.current.trim();
    if (!input && !output) return; // empty session — don't save

    logicalSession.persisted = true;
    const body = JSON.stringify({
      sessionId: logicalSession.sessionId,
      inputTranscript: input,
      outputTranscript: output,
    });
    try {
      fetch("/api/live-session/persist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true,  // survives page close
      }).catch(() => undefined);
    } catch { /* fire and forget */ }
  }

  // ── Public: connect ────────────────────────────────────────────────────────

  const connect = useCallback(async () => {
    if (stateRef.current !== "sleeping" && stateRef.current !== "error") return;
    
    let bootstrapText = "";
    try {
      const bRes = await fetch("/api/live-session/bootstrap");
      const bData = await bRes.json();
      bootstrapText = bData.text || "";
      setBootstrapMetrics({
        source: bData.source || "unavailable",
        count: bData.count || 0,
        chars: bData.chars || 0,
        ageMs: Date.now() - (bData.loadedAt || Date.now())
      });
    } catch(err) {
      console.error("[GeminiLive] Bootstrap failed", err);
    }

    activationSourceRef.current = "manual";
    setStateAndRef("connecting");
    setLastError("");
    setWsCloseCode(null);
    metricsRef.current = {};
    setMetrics({});
    inputTranscriptRef.current = "";
    outputTranscriptRef.current = "";
    setInputTranscript("");
    setOutputTranscript("");
    bytesSentRef.current = 0;
    bytesReceivedRef.current = 0;
    setBytesSent(0);
    setBytesReceived(0);
    memoryResultsCountRef.current = 0;
    
    if (pendingDeleteRef.current?.resolve) pendingDeleteRef.current.resolve({ ok: false, verified: false, error: { code: "action_cancelled" }});
    pendingDeleteRef.current = null;
    deleteConfirmationTranscriptRef.current = "";
    if (confirmationDebounceRef.current) window.clearTimeout(confirmationDebounceRef.current);

    mark("session_connect_started");

    const logicalSession: LogicalSession = {
      sessionId: crypto.randomUUID(),
      connectionId: "",
      resumptionHandle: undefined,
      startedAt: performance.now(),
      persisted: false,
    };
    sessionRef.current = logicalSession;

    const queue = new AudioPlaybackQueue();
    audioQueueRef.current = queue;

    try {
      await openConnection(logicalSession, queue, false, bootstrapText);
    } catch (err) {
      setLastError(err instanceof Error ? err.message : "Falha ao conectar");
      setStateAndRef("error");
      sessionRef.current = null;
    }
  }, []);

  // ── Internal: Wake Activation ──────────────────────────────────────────────

  function rollbackWakeActivation() {
    if (wakeTransitionTimeoutRef.current) {
      window.clearTimeout(wakeTransitionTimeoutRef.current);
      wakeTransitionTimeoutRef.current = null;
    }
    audioCaptureEngine.cancelTransition();
    wakeActivationRef.current = false;
    activationSourceRef.current = "manual";
    
    const ws = wsRef.current;
    if (ws) ws.close();
    wsRef.current = null;
    sessionRef.current = null;
    
    // Rearm wake visually
    setStateAndRef("sleeping");
    setWakeStatus("listening");
  }

  const activateFromWake = useCallback(async () => {
    if (wakeActivationRef.current) return;
    wakeActivationRef.current = true;
    activationSourceRef.current = "wake";
    
    // Set up a 10-second global timeout for the transition
    wakeTransitionTimeoutRef.current = window.setTimeout(() => {
      console.error("[GeminiLive] Wake transition timed out (10s)");
      rollbackWakeActivation();
    }, 10000);

    setStateAndRef("wake_detected");
    mark("wake_detected_at");

    // Begin capturing transition buffer (preRoll: 350ms, maxPostWake: 10s)
    audioCaptureEngine.beginWakeTransition({ preRollMs: 350, maxPostWakeMs: 10000 });
    
    setStateAndRef("connecting");
    mark("session_connect_started");
    
    let bootstrapText = "";
    try {
      const bRes = await fetch("/api/live-session/bootstrap");
      const bData = await bRes.json();
      bootstrapText = bData.text || "";
      setBootstrapMetrics({
        source: bData.source || "unavailable",
        count: bData.count || 0,
        chars: bData.chars || 0,
        ageMs: Date.now() - (bData.loadedAt || Date.now())
      });
    } catch(err) {
      console.error("[GeminiLive] Bootstrap failed", err);
    }

    setLastError("");
    setWsCloseCode(null);
    metricsRef.current = { wake_detected_at: metricsRef.current.wake_detected_at, session_connect_started: metricsRef.current.session_connect_started };
    setMetrics({});
    inputTranscriptRef.current = "";
    outputTranscriptRef.current = "";
    setInputTranscript("");
    setOutputTranscript("");
    bytesSentRef.current = 0;
    bytesReceivedRef.current = 0;
    setBytesSent(0);
    setBytesReceived(0);
    memoryResultsCountRef.current = 0;
    


    const logicalSession: LogicalSession = {
      sessionId: crypto.randomUUID(),
      connectionId: "",
      resumptionHandle: undefined,
      startedAt: performance.now(),
      persisted: false,
    };
    sessionRef.current = logicalSession;

    const queue = new AudioPlaybackQueue();
    audioQueueRef.current = queue;

    try {
      await openConnection(logicalSession, queue, false, bootstrapText);
      // Wait for setupComplete (handled in handleWsMessage)
    } catch (err) {
      setLastError(err instanceof Error ? err.message : "Falha ao conectar Gemini via Wake");
      rollbackWakeActivation();
    }
  }, []);

  // ── Public: disconnect (logical session end) ───────────────────────────────

  const disconnect = useCallback(async () => {
    const logicalSession = sessionRef.current;

    stopMic();
    audioQueueRef.current?.close();
    audioQueueRef.current = null;

    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } })); } catch {}
      ws.close(1000, "user_disconnect");
    }
    wsRef.current = null;
    setupCompleteRef.current = false;
    reconnectAttemptRef.current = false;
    


    setStateAndRef("sleeping");

    // Persist conversation — real session end.
    if (logicalSession) {
      await persistConversation(logicalSession);
      sessionRef.current = null;
    }
  }, []);

  // ── Wake Word detector ────────────────────────────────────────────────────

  useEffect(() => {
    let isMounted = true;
    let reconnectDelay = 1000;
    
    // Check capture active status periodically
    const captureInterval = setInterval(() => {
      setCaptureActive(audioCaptureEngine.ready);
    }, 500);

    async function startWakeDetector() {
      if (!isMounted) return;
      const shouldWakeRun = stateRef.current === "sleeping" || stateRef.current === "wake_detected" || (!micActive && stateRef.current !== "error" && stateRef.current !== "connecting");
      if (!shouldWakeRun) {
        if (wakeReconnectTimeoutRef.current) {
          clearTimeout(wakeReconnectTimeoutRef.current);
          wakeReconnectTimeoutRef.current = null;
        }
        return;
      }

      setWakeStatus("connecting");
      setWakeLastError("");
      
      try {
        await audioCaptureEngine.initialize();
        if (!isMounted) return;

        audioCaptureEngine.addDestination("wake-detector");

        const getWakeWebSocketUrl = () => {
          if (process.env.NEXT_PUBLIC_WAKE_WS_URL) {
            return process.env.NEXT_PUBLIC_WAKE_WS_URL;
          }
          const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
          return `${protocol}//${window.location.host}/api/wake-stream`;
        };
        const wsUrl = getWakeWebSocketUrl();
        const ws = new WebSocket(wsUrl);
        ws.binaryType = "arraybuffer";
        wakeWsRef.current = ws;

        ws.onopen = () => {
          if (!isMounted) return;
          console.log("[WakeDetector] Connected to wake stream");
          reconnectDelay = 1000; // Reset backoff
          
          const cb = (buffer: ArrayBuffer) => {
            if (ws?.readyState === WebSocket.OPEN) {
              ws.send(buffer);
              wakePcmFramesSentRef.current += 1;
              setWakePcmFramesSent(wakePcmFramesSentRef.current);
            }
          };
          
          // Clear previous if any
          if (wakePcmCallbackRef.current) {
             audioCaptureEngine.offPcmData(wakePcmCallbackRef.current);
          }
          wakePcmCallbackRef.current = cb;
          audioCaptureEngine.onPcmData(cb);
        };

        ws.onmessage = (ev) => {
          if (typeof ev.data === "string") {
            try {
              const msg = JSON.parse(ev.data);
              if (msg.event === "ready") {
                 setWakeStatus("listening");
                 setWakeModel(msg.model || "—");
                 setWakeThreshold(msg.threshold || 0.5);
              }
              if (msg.event === "score") {
                 const s = msg.score || 0;
                 setWakeScore(s);
                 if (s > wakePeakScoreRef.current) {
                   wakePeakScoreRef.current = s;
                   setWakePeakScore(s);
                 }
              }
              if (msg.event === "wake") {
                console.log("[WakeDetector] Wake word detected!", msg);
                setWakeCount(c => c + 1);
                try {
                  const ctx = audioCaptureEngine.getAudioContext();
                  if (ctx) {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.type = "sine";
                    osc.frequency.setValueAtTime(880, ctx.currentTime);
                    osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.1);
                    gain.gain.setValueAtTime(0.3, ctx.currentTime);
                    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
                    osc.start();
                    osc.stop(ctx.currentTime + 0.2);
                  }
                } catch (e) {}

                if (sessionRef.current !== null && wsRef.current?.readyState === WebSocket.OPEN && setupCompleteRef.current) {
                  console.log("[GeminiLive] Waking up existing session.");
                  void startMic();
                } else {
                  void activateFromWake();
                }
              }
            } catch {}
          }
        };

        ws.onclose = () => {
          console.log("[WakeDetector] Disconnected");
          if (!isMounted) return;
          if (wakePcmCallbackRef.current) {
            audioCaptureEngine.offPcmData(wakePcmCallbackRef.current);
            wakePcmCallbackRef.current = null;
          }
          wakeWsRef.current = null;
          
          if (stateRef.current === "sleeping" || stateRef.current === "wake_detected") {
             setWakeStatus("offline");
             wakeReconnectTimeoutRef.current = window.setTimeout(startWakeDetector, reconnectDelay);
             reconnectDelay = Math.min(reconnectDelay * 2, 5000);
          }
        };
        
        ws.onerror = () => {
          setWakeLastError("WebSocket error");
        };
      } catch (err) {
        console.error("[WakeDetector] Failed to initialize", err);
        if (isMounted) {
          setWakeStatus("error");
          setWakeLastError(err instanceof Error ? err.message : "Initialization failed");
          wakeReconnectTimeoutRef.current = window.setTimeout(startWakeDetector, reconnectDelay);
          reconnectDelay = Math.min(reconnectDelay * 2, 5000);
        }
      }
    }

    const shouldWakeRun = state === "sleeping" || state === "wake_detected" || (!micActive && state !== "error" && state !== "connecting");
    if (shouldWakeRun) {
      if (!wakeWsRef.current || wakeWsRef.current.readyState === WebSocket.CLOSED) {
        startWakeDetector();
      }
    } else {
      // Clean up if state leaves sleeping/wake_detected
      if (wakeReconnectTimeoutRef.current) {
        clearTimeout(wakeReconnectTimeoutRef.current);
        wakeReconnectTimeoutRef.current = null;
      }
      if (wakePcmCallbackRef.current) {
        audioCaptureEngine.offPcmData(wakePcmCallbackRef.current);
        wakePcmCallbackRef.current = null;
      }
      audioCaptureEngine.removeDestination("wake-detector");
      if (wakeWsRef.current) {
        wakeWsRef.current.close();
        wakeWsRef.current = null;
      }
      // Delay to avoid setting state synchronously in an effect
      Promise.resolve().then(() => setWakeStatus("offline"));
    }

    return () => {
      isMounted = false;
      clearInterval(captureInterval);
      if (wakeReconnectTimeoutRef.current) {
        clearTimeout(wakeReconnectTimeoutRef.current);
      }
      if (wakePcmCallbackRef.current) {
        audioCaptureEngine.offPcmData(wakePcmCallbackRef.current);
        wakePcmCallbackRef.current = null;
      }
      audioCaptureEngine.removeDestination("wake-detector");
      if (wakeWsRef.current) {
        wakeWsRef.current.close();
        wakeWsRef.current = null;
      }
    };
  }, [state, connect]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      stopMic();
      audioQueueRef.current?.close();
      wsRef.current?.close(1000, "unmount");
    };
  }, []);

  // ── Derived state ──────────────────────────────────────────────────────────

  const isConnected = sessionRef.current !== null && wsRef.current?.readyState === WebSocket.OPEN && setupCompleteRef.current;
  const canToggleMic =
    state === "ready" || state === "listening" || state === "speaking" || state === "thinking";

  return {
    state,
    micActive,
    micLevel,
    inputTranscript,
    outputTranscript,
    metrics,
    turnHistory,
    lastError,
    wsCloseCode,
    sessionDurationSec,
    activeModel,
    interruptCount,
    errors429Count,
    reconnections,
    bytesSent,
    bytesReceived,
    silenceDurationMs,
    isConnected,
    canToggleMic,
    wakeStatus,
    wakeModel,
    wakeThreshold,
    wakeLastError,
    wakeScore,
    wakePeakScore,
    wakePcmFramesSent,
    wakePythonFramesProcessed,
    wakeCount,
    captureActive,
    diagnosticIds: audioCaptureEngine.getDiagnostics(),
    bootstrapMetrics,
    connect,
    disconnect,
    toggleMic,
    setSilenceDurationMs,
  };
}
