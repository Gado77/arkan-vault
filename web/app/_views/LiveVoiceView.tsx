"use client";

/**
 * app/_views/LiveVoiceView.tsx
 *
 * Voice-first Hermes interface powered by Gemini Live.
 * Uses useGeminiLive() hook — no session logic duplicated here.
 *
 * Visual states for the VisualOrb:
 *   sleeping, connecting, ready, listening, thinking,
 *   using_memory, speaking, interrupted, reconnecting, offline, error
 */

import { useGeminiLive, WakeStatus } from "../../hooks/use-gemini-live";
import type { SessionState } from "../../lib/gemini-live/types";
import { useEffect, useRef, useState } from "react";

interface LiveVoiceViewProps {
  onSwitchToClassic?: () => void;
}

// ── State metadata ─────────────────────────────────────────────────────────────

function getVisualStateCopy(state: SessionState, captureActive: boolean, wakeStatus: WakeStatus): { label: string; hint: string } {
  if (!captureActive) return { label: "Microfone Desligado", hint: "Captura pausada para privacidade" };
  if (state === "ready" && wakeStatus === "listening") return { label: "Pronta", hint: "Diga “Hey Jarvis” ou toque no microfone" };
  if (state === "disconnected" || state === "sleeping") return { label: "Dormindo", hint: "Diga “Hey Jarvis”" };

  // Gemini modes
  switch (state) {
    case "connecting":   return { label: "Conectando", hint: "Abrindo sessão com Gemini Live…" };
    case "listening":    return { label: "Ouvindo", hint: "Fale naturalmente" };
    case "thinking":     return { label: "Pensando", hint: "" };
    case "using_memory": return { label: "Consultando memória", hint: "Buscando no Arkan Vault…" };
    case "speaking":     return { label: "Falando", hint: "Você pode interromper a qualquer momento" };
    case "interrupted":  return { label: "Interrompido", hint: "" };
    case "reconnecting": return { label: "Reconectando", hint: "Retomando sessão…" };
    case "wake_detected": return { label: "Hey Jarvis detectado", hint: "Aguarde..." };
    case "error":        return { label: "Erro", hint: "Tente reconectar" };
    default:             return { label: "Desconectado", hint: "" };
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

export function LiveVoiceView({ onSwitchToClassic }: LiveVoiceViewProps) {
  const live = useGeminiLive({ enableTools: true });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const prevInputRef = useRef("");

  const copy = getVisualStateCopy(live.state, live.captureActive, live.wakeStatus);

  // Arkan diagnostics
  const [arkanStatus, setArkanStatus] = useState<any>(null);
  useEffect(() => {
    const fetchArkan = async () => {
      try {
        const res = await fetch("/api/arkan/status");
        if (res.ok) {
          const data = await res.json();
          setArkanStatus(data);
        } else {
          setArkanStatus(null);
        }
      } catch {
        setArkanStatus(null);
      }
    };
    fetchArkan();
    const interval = setInterval(fetchArkan, 10000);
    return () => clearInterval(interval);
  }, []);

  // Accumulate full transcript history for the side panel.
  const [history, setHistory] = useState<{ user: string; hermes: string; ts: number }[]>([]);
  useEffect(() => {
    // Add a turn entry whenever inputTranscript changes after ready.
    if (live.inputTranscript && live.inputTranscript !== prevInputRef.current) {
      prevInputRef.current = live.inputTranscript;
    }
  }, [live.inputTranscript]);

  // Snapshot a turn when a turn completes (turnHistory grows).
  const prevTurnCount = useRef(0);
  useEffect(() => {
    if (live.turnHistory.length > prevTurnCount.current) {
      prevTurnCount.current = live.turnHistory.length;
      const user = live.inputTranscript.trim();
      const hermes = live.outputTranscript.trim();
      if (user || hermes) {
        setHistory((prev) => [...prev, { user, hermes, ts: Date.now() }]);
      }
    }
  }, [live.turnHistory.length]);

  function formatDuration(sec: number) {
    const m = Math.floor(sec / 60).toString().padStart(2, "0");
    const s = (sec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  return (
    <main className={`lv-shell lv-state-${live.state}`} aria-label="Hermes — Assistente de voz">

      {/* Header */}
      <header className="lv-header">
        <div className="lv-brand">
          <span className="lv-logo" aria-hidden="true">H</span>
          <div>
            <strong>Hermes</strong>
            <small>
              <span className={`lv-dot lv-dot-${live.state}`} aria-hidden="true" />
              {live.state === "sleeping" ? "Gemini Live" : live.activeModel}
            </small>
          </div>
        </div>
        <button
          id="lv-btn-menu"
          className="lv-icon-btn"
          onClick={() => setDrawerOpen(true)}
          aria-label="Abrir painel de configurações"
        >
          <span /><span /><span />
        </button>
      </header>

      {/* Status line */}
      <div className="lv-status-line" role="status" aria-live="polite">
        <span className="lv-status-chip" title="Gemini Live">
          <span className={`lv-dot lv-dot-${live.isConnected ? "ready" : "sleeping"}`} />
          Live
        </span>
        <span className="lv-status-chip" title="Microfone">
          <span className={`lv-dot ${live.micActive ? "lv-dot-listening" : "lv-dot-sleeping"}`} />
          Mic
        </span>
        <span className="lv-status-chip" title="Arkan Vault">
          <span className={`lv-dot ${live.state === "using_memory" ? "lv-dot-using_memory" : "lv-dot-ready"}`} />
          Arkan
        </span>
        {live.sessionDurationSec > 0 && (
          <span className="lv-status-chip" title="Duração da sessão">
            ⏱ {formatDuration(live.sessionDurationSec)}
          </span>
        )}
      </div>

      {/* Central visual orb + state */}
      <section className="lv-stage" aria-live="polite">
        <VisualOrb state={live.state} micLevel={live.micLevel} />

        <div className="lv-state-copy">
          <span className="lv-eyebrow">{live.state.toUpperCase().replace("_", " ")}</span>
          <h1 className="lv-state-label">{copy.label}</h1>
          {copy.hint && <p className="lv-state-hint">{copy.hint}</p>}
        </div>
      </section>

      {/* Transcripts */}
      <div className="lv-transcripts" aria-live="polite" aria-atomic="false">
        {live.inputTranscript && (
          <p className="lv-transcript-user" aria-label="Transcrição do usuário">
            {live.inputTranscript}
          </p>
        )}
        {live.outputTranscript && (
          <p className="lv-transcript-hermes" aria-label="Transcrição da Hermes">
            <em>{live.outputTranscript}</em>
          </p>
        )}
      </div>

      {/* Error */}
      {live.lastError && (
        <div className="lv-error" role="alert">
          {live.lastError}
        </div>
      )}

      {/* Controls */}
      <div className="lv-controls">
        {live.state === "error" ? (
          <button
            id="lv-btn-connect"
            className="lv-connect-btn"
            onClick={live.connect}
            aria-label="Conectar ao Gemini Live"
          >
            <span className="lv-connect-icon" aria-hidden="true">◉</span>
            Reconectar
          </button>
        ) : live.state === "disconnected" || live.state === "sleeping" || live.state === "wake_detected" ? (
          <div className="lv-placeholder" />
        ) : (
          <>
            <button
              id="lv-btn-mic"
              className={`lv-mic-btn ${live.micActive ? "lv-mic-active" : ""}`}
              onClick={live.toggleMic}
              disabled={!live.canToggleMic}
              aria-label={live.micActive ? "Desativar microfone" : "Ativar microfone"}
              aria-pressed={live.micActive}
            >
              <span className="lv-mic-icon" aria-hidden="true">
                {live.micActive ? "🔴" : "🎙"}
              </span>
              <span>{live.micActive ? "Parar" : "Falar"}</span>
            </button>

            <button
              id="lv-btn-end"
              className="lv-end-btn"
              onClick={live.disconnect}
              aria-label="Encerrar sessão"
            >
              Encerrar
            </button>
          </>
        )}
      </div>



      {/* Conversation history button */}
      {history.length > 0 && (
        <button
          className="lv-history-toggle"
          onClick={() => setHistoryOpen((v) => !v)}
          aria-label={historyOpen ? "Fechar histórico" : "Ver histórico da conversa"}
          aria-expanded={historyOpen}
        >
          {historyOpen ? "↑ Fechar histórico" : `↓ Histórico (${history.length} turnos)`}
        </button>
      )}

      {historyOpen && (
        <section className="lv-history" aria-label="Histórico da conversa">
          {history.map((turn, i) => (
            <div key={i} className="lv-history-turn">
              {turn.user && <p className="lv-history-user">{turn.user}</p>}
              {turn.hermes && <p className="lv-history-hermes"><em>{turn.hermes}</em></p>}
            </div>
          ))}
        </section>
      )}

      {/* Side drawer */}
      <aside className={`lv-drawer ${drawerOpen ? "lv-drawer-open" : ""}`} aria-hidden={!drawerOpen}>
        <div className="lv-drawer-head">
          <div>
            <span className="lv-eyebrow">CONFIGURAÇÕES</span>
            <h2>Hermes</h2>
          </div>
          <button onClick={() => setDrawerOpen(false)} aria-label="Fechar painel">×</button>
        </div>

        {/* Session stats */}
        {live.turnHistory.length > 0 && (
          <div className="lv-drawer-section">
            <strong className="lv-drawer-title">Sessão atual</strong>
            <dl className="lv-drawer-dl">
              <div><dt>Turnos</dt><dd>{live.turnHistory.length}</dd></div>
              <div>
                <dt>TTFA mediano</dt>
                <dd>{
                  (() => {
                    const v = live.turnHistory.map((t) => t.ttfaReceived).filter((v) => v > 0).sort((a, b) => a - b);
                    return v.length ? `${v[Math.floor(v.length / 2)]} ms` : "—";
                  })()
                }</dd>
              </div>
              <div><dt>Interrupções</dt><dd>{live.interruptCount}</dd></div>
              <div><dt>Erros 429</dt><dd>{live.errors429Count}</dd></div>
              <div><dt>Reconexões</dt><dd>{live.reconnections}</dd></div>
            </dl>
          </div>
        )}

        {/* Silence VAD — only when disconnected */}
        {!live.isConnected && (
          <div className="lv-drawer-section">
            <strong className="lv-drawer-title">Detecção de silêncio</strong>
            <label htmlFor="lv-silence-slider" className="lv-drawer-label">
              {live.silenceDurationMs} ms
            </label>
            <input
              id="lv-silence-slider"
              type="range"
              min={500} max={2000} step={50}
              value={live.silenceDurationMs}
              onChange={(e) => live.setSilenceDurationMs(Number(e.target.value))}
              className="lv-slider"
              aria-label="Duração do silêncio em milissegundos"
            />
          </div>
        )}

        {/* Navigation */}
        <nav className="lv-drawer-nav">
          <a href="/diagnostics" className="lv-drawer-link">
            <span>📊</span>
            <div><strong>Diagnóstico Arkan</strong><small>Status e Saúde do Vault</small></div>
            <b>›</b>
          </a>
          <a href="/live-test" className="lv-drawer-link">
            <span>⚡</span>
            <div><strong>Benchmark Local</strong><small>/live-test</small></div>
            <b>›</b>
          </a>
          {onSwitchToClassic && (
            <button id="lv-switch-classic" className="lv-drawer-link" onClick={onSwitchToClassic}>
              <span>↩</span>
              <div><strong>Pipeline clássico</strong><small>Groq + Edge TTS</small></div>
              <b>›</b>
            </button>
          )}
        </nav>
      </aside>
      {drawerOpen && <button className="lv-scrim" onClick={() => setDrawerOpen(false)} aria-label="Fechar painel" />}
    </main>
  );
}

// ── VisualOrb ──────────────────────────────────────────────────────────────────

function VisualOrb({ state, micLevel }: { state: SessionState; micLevel: number }) {
  const scale = state === "listening" ? 1 + micLevel * 0.35 : 1;

  return (
    <div className="lv-orb-wrapper" aria-hidden="true">
      <div
        className={`lv-orb lv-orb-${state}`}
        style={{ transform: `scale(${scale.toFixed(3)})` }}
      >
        <div className="lv-orb-inner" />
        <div className="lv-orb-ring lv-orb-ring-1" />
        <div className="lv-orb-ring lv-orb-ring-2" />
      </div>
    </div>
  );
}
