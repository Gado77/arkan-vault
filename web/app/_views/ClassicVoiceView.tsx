"use client";

/**
 * app/_views/ClassicVoiceView.tsx
 *
 * The original Hermes pipeline (Groq Whisper + Hermes LLM + Edge TTS).
 * Moved here intact from app/page.tsx with minimal changes:
 *  - receives a `onSwitchToLive` prop for the mode-switching button.
 */

import { FormEvent, useEffect, useRef, useState } from "react";
import { ProgressiveTTSChunker } from "../../lib/progressive-tts-chunker";

type HermesState = "idle" | "listening" | "thinking" | "speaking";

type VoiceMark =
  | "listening_started" | "speech_started" | "last_voice_activity"
  | "speech_end_detected" | "recorder_stop_requested" | "audio_blob_ready"
  | "upload_started" | "upload_finished" | "first_text_token_received"
  | "first_tts_chunk_created" | "first_tts_request_started"
  | "playback_started" | "playback_finished";

type VoiceTrace = {
  traceId: string;
  generationId: string;
  marks: Partial<Record<VoiceMark, number>>;
  firstChunkWords: number;
  ttsChunks: number;
};

type VoiceMetrics = {
  endpointing: number; blob: number; upload: number; firstToken: number;
  firstChunkWait: number; pipelineTtfa: number; perceivedTtfa: number;
  firstChunkWords: number; ttsChunks: number;
};

const emptyVoiceMetrics: VoiceMetrics = {
  endpointing: 0, blob: 0, upload: 0, firstToken: 0,
  firstChunkWait: 0, pipelineTtfa: 0, perceivedTtfa: 0, firstChunkWords: 0, ttsChunks: 0,
};

const stateCopy: Record<HermesState, { label: string; hint: string }> = {
  idle: { label: "Pronta para conversar", hint: "Toque no microfone ou escreva uma mensagem" },
  listening: { label: "Estou ouvindo", hint: "Fale naturalmente. Toque novamente para terminar" },
  thinking: { label: "Pensando", hint: "Organizando sua pergunta com a memória Arkan" },
  speaking: { label: "Falando", hint: "Você pode me interromper a qualquer momento" },
};

interface ClassicVoiceViewProps {
  onSwitchToLive?: () => void;
}

export function ClassicVoiceView({ onSwitchToLive }: ClassicVoiceViewProps) {
  const [state, setState] = useState<HermesState>("idle");
  const [drawer, setDrawer] = useState(false);
  const [input, setInput] = useState("");
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [hermesStatus, setHermesStatus] = useState<"offline" | "warming" | "ready">("warming");
  const [warmupMs, setWarmupMs] = useState(0);
  const [stats, setStats] = useState({ memories: 7, files: 2 });
  const [latency, setLatency] = useState({ stt: 0, firstToken: 0, total: 0 });
  const [voiceMetrics, setVoiceMetrics] = useState<VoiceMetrics>(emptyVoiceMetrics);
  const [messages, setMessages] = useState([
    { role: "hermes", text: "Olá. Estou pronta. O que vamos fazer agora?" },
  ]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const vadTimerRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const speechQueueRef = useRef<Promise<void>>(Promise.resolve());
  const speechChunkerRef = useRef(new ProgressiveTTSChunker());
  const gatewayRef = useRef<WebSocket | null>(null);
  const gatewaySessionRef = useRef("");
  const rpcIdRef = useRef(0);
  const rpcPendingRef = useRef(new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>());
  const liveTurnRef = useRef<{ answer: string; started: number; resolve: () => void } | null>(null);
  const activeTraceRef = useRef<VoiceTrace | null>(null);

  function markTrace(name: VoiceMark) {
    const trace = activeTraceRef.current;
    if (trace) trace.marks[name] = performance.now();
  }

  function duration(trace: VoiceTrace, start: VoiceMark, end: VoiceMark) {
    const a = trace.marks[start];
    const b = trace.marks[end];
    return a === undefined || b === undefined ? 0 : Math.max(0, Math.round(b - a));
  }

  function publishTrace(trace: VoiceTrace) {
    const snapshot: VoiceTrace = { ...trace, marks: { ...trace.marks } };
    window.setTimeout(() => {
      const metrics: VoiceMetrics = {
        endpointing: duration(snapshot, "last_voice_activity", "speech_end_detected"),
        blob: duration(snapshot, "recorder_stop_requested", "audio_blob_ready"),
        upload: duration(snapshot, "upload_started", "upload_finished"),
        firstToken: duration(snapshot, "upload_finished", "first_text_token_received"),
        firstChunkWait: duration(snapshot, "first_text_token_received", "first_tts_chunk_created"),
        pipelineTtfa: duration(snapshot, "speech_end_detected", "playback_started"),
        perceivedTtfa: duration(snapshot, "last_voice_activity", "playback_started"),
        firstChunkWords: snapshot.firstChunkWords,
        ttsChunks: snapshot.ttsChunks,
      };
      setVoiceMetrics(metrics);
      void fetch("/api/hermes/voice/trace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trace_id: snapshot.traceId, generation_id: snapshot.generationId, source: "browser", marks: snapshot.marks, metrics }),
        keepalive: true,
      }).catch(() => undefined);
    }, 0);
  }

  function gatewayRequest(method: string, params: Record<string, unknown>) {
    const socket = gatewayRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error("Gateway persistente indisponível."));
    const id = `web-${++rpcIdRef.current}`;
    return new Promise<unknown>((resolve, reject) => {
      rpcPendingRef.current.set(id, { resolve, reject });
      socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
      window.setTimeout(() => {
        const pending = rpcPendingRef.current.get(id);
        if (pending) {
          rpcPendingRef.current.delete(id);
          pending.reject(new Error(`Tempo esgotado: ${method}`));
        }
      }, 120000);
    });
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording") {
      const trace = activeTraceRef.current;
      if (trace && !trace.marks.speech_end_detected) trace.marks.speech_end_detected = performance.now();
      if (trace && !trace.marks.recorder_stop_requested) trace.marks.recorder_stop_requested = performance.now();
      recorderRef.current.stop();
    }
  }

  function enqueueSpeech(text: string) {
    const phrase = text.trim();
    if (!phrase) return;
    const trace = activeTraceRef.current;
    if (trace) {
      trace.ttsChunks += 1;
      if (!trace.marks.first_tts_chunk_created) {
        trace.marks.first_tts_chunk_created = performance.now();
        trace.firstChunkWords = phrase.split(/\s+/).length;
      }
      if (!trace.marks.first_tts_request_started) trace.marks.first_tts_request_started = performance.now();
    }
    const sequence = trace?.ttsChunks ? trace.ttsChunks - 1 : 0;
    const traceQuery = trace
      ? `&trace_id=${encodeURIComponent(trace.traceId)}&generation_id=${encodeURIComponent(trace.generationId)}&sequence=${sequence}`
      : "";
    const audio = new Audio(`/api/hermes/voice/tts?text=${encodeURIComponent(phrase)}${traceQuery}`);
    audio.preload = "auto";
    audio.load();
    speechQueueRef.current = speechQueueRef.current.then(async () => {
      setState("speaking");
      await new Promise<void>((resolve, reject) => {
        audio.onplaying = () => {
          if (!trace || activeTraceRef.current?.generationId !== trace.generationId) return;
          if (!trace.marks.playback_started) {
            trace.marks.playback_started = performance.now();
            publishTrace(trace);
          }
        };
        audio.onended = () => {
          if (trace && activeTraceRef.current?.generationId === trace.generationId)
            trace.marks.playback_finished = performance.now();
          resolve();
        };
        audio.onerror = () => reject(new Error("Falha ao reproduzir a voz configurada."));
        if (trace && activeTraceRef.current?.generationId !== trace.generationId) return resolve();
        void audio.play().catch(reject);
      });
    }).catch((error) => {
      setMessages((current) => [...current, { role: "hermes", text: error instanceof Error ? error.message : "Falha na voz." }]);
    });
  }

  function feedSpeech(delta: string, flush = false) {
    for (const chunk of speechChunkerRef.current.feed(delta)) enqueueSpeech(chunk);
    if (flush) for (const chunk of speechChunkerRef.current.flush()) enqueueSpeech(chunk);
  }

  async function askHermes(text: string) {
    if (hermesStatus !== "ready") {
      setMessages((current) => [...current, { role: "hermes", text: "Ainda estou aquecendo. Tente novamente em alguns segundos." }]);
      return;
    }
    setMessages((current) => [...current, { role: "user", text }, { role: "hermes", text: "" }]);
    setState("thinking");
    speechChunkerRef.current = new ProgressiveTTSChunker();
    try {
      const requestStarted = performance.now();
      let firstTokenAt = 0;
      if (gatewayRef.current?.readyState === WebSocket.OPEN && gatewaySessionRef.current) {
        await new Promise<void>(async (resolve, reject) => {
          liveTurnRef.current = { answer: "", started: requestStarted, resolve };
          try {
            await gatewayRequest("prompt.submit", {
              session_id: gatewaySessionRef.current,
              text,
              voice_profile: true,
              trace_id: activeTraceRef.current?.traceId || crypto.randomUUID(),
            });
          } catch (error) {
            liveTurnRef.current = null;
            reject(error);
          }
        });
        feedSpeech("", true);
        await speechQueueRef.current;
        if (activeTraceRef.current) publishTrace(activeTraceRef.current);
        setLatency((current) => ({ ...current, total: Math.round(performance.now() - requestStarted) }));
        setState("idle");
        return;
      }
      const response = await fetch("/api/hermes/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "hermes-agent", stream: true, messages: [{ role: "user", content: text }] }),
      });
      if (!response.ok || !response.body) throw new Error("Falha ao conversar com o Hermes.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      let answer = "";
      while (true) {
        const { value, done } = await reader.read();
        pending += decoder.decode(value || new Uint8Array(), { stream: !done });
        const lines = pending.split("\n");
        pending = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          if (!raw || raw === "[DONE]") continue;
          const data = JSON.parse(raw);
          const delta = data?.choices?.[0]?.delta?.content || "";
          if (!delta) continue;
          if (!firstTokenAt) {
            firstTokenAt = performance.now();
            markTrace("first_text_token_received");
            setLatency((current) => ({ ...current, firstToken: Math.round(firstTokenAt - requestStarted) }));
          }
          answer += delta;
          feedSpeech(delta);
          setMessages((current) => current.map((message, index) => index === current.length - 1 ? { ...message, text: answer } : message));
        }
        if (done) break;
      }
      if (!answer.trim()) throw new Error("O Hermes respondeu sem texto.");
      feedSpeech("", true);
      await speechQueueRef.current;
      if (activeTraceRef.current) publishTrace(activeTraceRef.current);
      setLatency((current) => ({ ...current, total: Math.round(performance.now() - requestStarted) }));
      setState("idle");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não consegui conectar ao Hermes.";
      setMessages((current) => current.map((item, index) => index === current.length - 1 && !item.text ? { ...item, text: message } : item));
      setState("idle");
    }
  }

  useEffect(() => {
    fetch("/api/arkan/status")
      .then((response) => { if (!response.ok) throw new Error("offline"); return response.json(); })
      .then((data) => { setServerOnline(data.online !== false); setStats({ memories: data.memories ?? 7, files: data.files ?? 2 }); })
      .catch(() => setServerOnline(false));

    const gatewayToken = process.env.NEXT_PUBLIC_HERMES_GATEWAY_TOKEN || "";
    const query = gatewayToken ? `?token=${encodeURIComponent(gatewayToken)}` : "";
    const socket = new WebSocket(`ws://${window.location.hostname}:9119/api/ws${query}`);
    gatewayRef.current = socket;
    socket.onmessage = async (message) => {
      const frame = JSON.parse(String(message.data));
      if (frame.id != null) {
        const pending = rpcPendingRef.current.get(String(frame.id));
        if (pending) {
          rpcPendingRef.current.delete(String(frame.id));
          if (frame.error) pending.reject(new Error(frame.error.message || "Falha no Hermes."));
          else pending.resolve(frame.result);
        }
        return;
      }
      if (frame.method !== "event") return;
      const event = frame.params || {};
      if (event.type === "gateway.ready" && !gatewaySessionRef.current) {
        try {
          let warmSession = "";
          for (let attempt = 0; attempt < 120; attempt += 1) {
            const status = await fetch("/api/hermes/readiness", { cache: "no-store" }).then((r) => r.json());
            setHermesStatus(status.alive ? "warming" : "offline");
            if (status.ready && status.stored_session_id) {
              warmSession = status.stored_session_id;
              setWarmupMs(status.warmup_ms || 0);
              break;
            }
            await new Promise((resolve) => window.setTimeout(resolve, 1000));
          }
          let connected;
          if (warmSession) connected = await gatewayRequest("session.resume", { session_id: warmSession, cols: 100, source: "hermes-web", omit_messages: true });
          if (!connected) connected = await gatewayRequest("session.create", { cols: 100, source: "hermes-web" });
          gatewaySessionRef.current = (connected as { session_id: string }).session_id;
          setHermesStatus("ready");
        } catch { setHermesStatus("offline"); }
        return;
      }
      const turn = liveTurnRef.current;
      if (!turn || (event.session_id && event.session_id !== gatewaySessionRef.current)) return;
      if (event.type === "message.delta") {
        const delta = event.payload?.text || "";
        if (!delta) return;
        if (!turn.answer) {
          markTrace("first_text_token_received");
          setLatency((current) => ({ ...current, firstToken: Math.round(performance.now() - turn.started) }));
        }
        turn.answer += delta;
        feedSpeech(delta);
        const answer = turn.answer;
        setMessages((current) => current.map((item, index) => index === current.length - 1 ? { ...item, text: answer } : item));
      } else if (event.type === "message.complete") {
        if (!turn.answer && event.payload?.text) {
          turn.answer = event.payload.text;
          feedSpeech(turn.answer);
          setMessages((current) => current.map((item, index) => index === current.length - 1 ? { ...item, text: turn.answer } : item));
        }
        liveTurnRef.current = null;
        turn.resolve();
      } else if (event.type === "error") {
        liveTurnRef.current = null;
        setMessages((current) => current.map((item, index) => index === current.length - 1 ? { ...item, text: event.payload?.message || "Falha no Hermes." } : item));
        turn.resolve();
      }
    };
    socket.onclose = () => { gatewayRef.current = null; gatewaySessionRef.current = ""; setHermesStatus("offline"); };
    return () => socket.close();
  }, []);

  async function toggleListening() {
    if (hermesStatus !== "ready") return;
    if (state === "listening") { stopRecording(); return; }
    try {
      activeTraceRef.current = { traceId: crypto.randomUUID(), generationId: crypto.randomUUID(), marks: { listening_started: performance.now() }, firstChunkWords: 0, ttsChunks: 0 };
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm" });
      recorder.ondataavailable = (event) => { if (event.data.size) audioChunksRef.current.push(event.data); };
      recorder.onstop = async () => {
        if (vadTimerRef.current) window.clearInterval(vadTimerRef.current);
        await audioContextRef.current?.close();
        stream.getTracks().forEach((track) => track.stop());
        recorderRef.current = null;
        setState("thinking");
        markTrace("audio_blob_ready");
        const form = new FormData();
        form.append("audio", new Blob(audioChunksRef.current, { type: recorder.mimeType }), "recording.webm");
        try {
          const trace = activeTraceRef.current;
          markTrace("upload_started");
          const response = await fetch("/api/hermes/voice/transcribe", {
            method: "POST",
            headers: { "x-trace-id": trace?.traceId || "", "x-generation-id": trace?.generationId || "" },
            body: form,
          });
          markTrace("upload_finished");
          const data = await response.json();
          if (!response.ok || !data.success || !data.transcript?.trim()) throw new Error(data.error || "Não entendi o áudio.");
          setLatency((current) => ({ ...current, stt: data.timings?.total_ms || 0 }));
          setInput("");
          await askHermes(data.transcript.trim());
        } catch (error) {
          setMessages((current) => [...current, { role: "hermes", text: error instanceof Error ? error.message : "Falha na transcrição." }]);
          setState("idle");
        }
      };
      recorderRef.current = recorder;
      recorder.start(100);
      const context = new AudioContext();
      audioContextRef.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      const levels = new Uint8Array(analyser.fftSize);
      let heardSpeech = false;
      let lastSpeech = performance.now();
      vadTimerRef.current = window.setInterval(() => {
        analyser.getByteTimeDomainData(levels);
        const rms = Math.sqrt(levels.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / levels.length);
        if (rms > 0.025) {
          if (!heardSpeech) markTrace("speech_started");
          heardSpeech = true;
          lastSpeech = performance.now();
          markTrace("last_voice_activity");
        }
        if (heardSpeech && performance.now() - lastSpeech > 700) {
          markTrace("speech_end_detected");
          markTrace("recorder_stop_requested");
          stopRecording();
        }
      }, 80);
      setState("listening");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Verifique a permissão do navegador.";
      setMessages((current) => [...current, { role: "hermes", text: `Não consegui acessar o microfone. ${detail}` }]);
    }
  }

  function sendMessage(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text) return;
    const now = performance.now();
    activeTraceRef.current = { traceId: crypto.randomUUID(), generationId: crypto.randomUUID(), marks: { last_voice_activity: now, speech_end_detected: now, upload_finished: now }, firstChunkWords: 0, ttsChunks: 0 };
    setInput("");
    void askHermes(text);
  }

  const copy = hermesStatus === "ready" ? stateCopy[state]
    : hermesStatus === "warming"
    ? { label: "Aquecendo a Hermes", hint: "Preparando mente, ferramentas e memória antes da primeira conversa" }
    : { label: "Hermes offline", hint: "Tentando reconectar ao serviço local" };

  return (
    <main className={`app-shell state-${state}`}>
      <header className="topbar">
        <button className="brand" aria-label="Página inicial">
          <span className="brand-mark">H</span>
          <span><strong>Hermes</strong><small>pipeline clássico</small></span>
        </button>
        <div className="top-actions">
          <span className={`connection ${hermesStatus === "offline" ? "offline" : ""}`}>
            <i /> {hermesStatus === "ready" ? "Hermes pronta" : hermesStatus === "warming" ? "Hermes aquecendo" : "Hermes offline"}
          </span>
          <span className={`connection ${serverOnline === false ? "offline" : ""}`}>
            <i /> {serverOnline === null ? "Conectando" : serverOnline ? "Arkan online" : "Arkan offline"}
          </span>
          <button className="icon-button" onClick={() => setDrawer(true)} aria-label="Abrir painel">
            <span /><span /><span />
          </button>
        </div>
      </header>

      <section className="assistant-stage" aria-live="polite">
        <div className="ambient-ring ring-one" />
        <div className="ambient-ring ring-two" />
        <div className="hermes-face" aria-label={`Hermes está ${copy.label.toLowerCase()}`}>
          <div className="face-glow" />
          <div className="eyes"><i /><i /></div>
          <div className="mouth"><i /><i /><i /><i /><i /></div>
        </div>
        <div className="state-copy">
          <span className="eyebrow">{state === "idle" ? "HERMES" : state.toUpperCase()}</span>
          <h1>{copy.label}</h1>
          <p>{copy.hint}</p>
        </div>
        <button className="mic-button" disabled={hermesStatus !== "ready"} onClick={toggleListening} aria-label={state === "listening" ? "Parar de ouvir" : "Começar a ouvir"}>
          <span className="mic-glyph"><i /><b /></span>
          <em>{state === "listening" ? "Encerrar" : "Falar"}</em>
        </button>
      </section>

      <section className="conversation" aria-label="Conversa">
        <div className="message-list">
          {messages.slice(-4).map((message, index) => (
            <article className={`message ${message.role}`} key={`${message.role}-${index}`}>
              <span>{message.role === "hermes" ? "H" : "V"}</span>
              <p>{message.text}</p>
            </article>
          ))}
        </div>
        <form className="composer" onSubmit={sendMessage}>
          <input disabled={hermesStatus !== "ready"} value={input} onChange={(event) => setInput(event.target.value)} placeholder="Escreva para a Hermes..." aria-label="Mensagem" />
          <button disabled={hermesStatus !== "ready"} type="submit" aria-label="Enviar mensagem">↑</button>
        </form>
      </section>

      <aside className={`drawer ${drawer ? "open" : ""}`} aria-hidden={!drawer}>
        <div className="drawer-head">
          <div><span className="eyebrow">PIPELINE CLÁSSICO</span><h2>Sua Hermes</h2></div>
          <button onClick={() => setDrawer(false)} aria-label="Fechar painel">×</button>
        </div>
        <div className="status-card">
          <span className="status-orb" />
          <div>
            <strong>{hermesStatus === "ready" ? "Sistema disponível" : "Sistema inicializando"}</strong>
            <small>{hermesStatus === "ready" ? `Warm-up concluído em ${warmupMs || "–"} ms` : "Preparando ouvido, mente, voz e memória"}</small>
          </div>
        </div>
        <div className="stats-grid">
          <div><strong>{stats.memories}</strong><span>memórias</span></div>
          <div><strong>{stats.files}</strong><span>arquivos</span></div>
        </div>
        <div className="pipeline"><span>STT {latency.stt || "–"} ms</span><i /> <span>1º token {latency.firstToken || "–"} ms</span><i /> <span>Total {latency.total || "–"} ms</span></div>
        <section className="trace-card" aria-label="Latência da última fala">
          <strong>Última fala · Time to First Audio</strong>
          <dl>
            <div><dt>TTFA percebido</dt><dd>{voiceMetrics.perceivedTtfa || "–"} ms</dd></div>
            <div><dt>Endpointing</dt><dd>{voiceMetrics.endpointing || "–"} ms</dd></div>
            <div><dt>Blob</dt><dd>{voiceMetrics.blob || "–"} ms</dd></div>
            <div><dt>Upload + STT</dt><dd>{voiceMetrics.upload || "–"} ms</dd></div>
            <div><dt>Pipeline até áudio</dt><dd>{voiceMetrics.pipelineTtfa || "–"} ms</dd></div>
          </dl>
        </section>
        <nav className="drawer-menu">
          {onSwitchToLive && (
            <button id="switch-to-live" onClick={onSwitchToLive}>
              <span>◈</span>
              <div><strong>Gemini Live</strong><small>Mudar para modo principal</small></div>
              <b>›</b>
            </button>
          )}
          <a href="/live-test" className="drawer-menu-link">
            <span>⚡</span>
            <div><strong>Diagnóstico Live</strong><small>Benchmark de latência /live-test</small></div>
            <b>›</b>
          </a>
        </nav>
        <div className="pipeline"><span>Groq</span><i /> <span>GPT 5.6</span><i /> <span>Francisca</span></div>
      </aside>
      {drawer && <button className="scrim" onClick={() => setDrawer(false)} aria-label="Fechar painel" />}
    </main>
  );
}
