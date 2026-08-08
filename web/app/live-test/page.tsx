"use client";

/**
 * /live-test — Gemini Live API Benchmark
 *
 * Isolated latency benchmark page using the shared useGeminiLive hook.
 * Uses NO Hermes, Arkan tools, Groq, Edge TTS, or wake word.
 *
 * Security: The permanent Gemini API key never reaches the browser. A
 * single-use ephemeral token is fetched from /api/gemini-live/token.
 */

import { useGeminiLive } from "../../hooks/use-gemini-live";
import type { SessionState, TurnMetrics } from "../../lib/gemini-live/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMs(n: number): string {
  return n ? `${n} ms` : "—";
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function p95(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
}

// ── State colour ──────────────────────────────────────────────────────────────

const stateColor: Record<SessionState, string> = {
  sleeping:     "#9ba69f",
  disconnected: "#787774",
  connecting:   "#e8a325",
  ready:        "#42aa78",
  listening:    "#3b9eff",
  wake_detected: "#3b9eff",
  thinking:     "#818cf8",
  using_memory: "#a855f7",
  speaking:     "#4ade80",
  interrupted:  "#ff775f",
  reconnecting: "#e8a325",
  error:        "#ef4444",
};

// ── Component ──────────────────────────────────────────────────────────────────

export default function LiveTestPage() {
  // No Arkan tools in benchmark mode — pure latency measurement.
  const live = useGeminiLive({ enableTools: false });

  const ttfaValues = live.turnHistory.map((t) => t.ttfaReceived).filter((v) => v > 0);
  const bargeInValues = live.turnHistory.map((t) => t.bargeInMs).filter((v) => v > 0);

  return (
    <main className="lt-shell">
      <header className="lt-header">
        <div className="lt-brand">
          <span className="lt-logo">G</span>
          <div>
            <strong>Gemini Live PoC</strong>
            <small>Benchmark de latência — sem Hermes, Arkan ou ferramentas</small>
          </div>
        </div>
        <a href="/" className="lt-back-link">← Interface principal</a>
      </header>

      {/* State Badge */}
      <div className="lt-state-row">
        <span className="lt-state-dot" style={{ background: stateColor[live.state] }} />
        <span className="lt-state-label">{live.state.toUpperCase().replace("_", " ")}</span>
        {live.activeModel !== "—" && <span className="lt-model-badge">{live.activeModel}</span>}
        {live.sessionDurationSec > 0 && (
          <span className="lt-session-dur">Sessão: {live.sessionDurationSec}s</span>
        )}
      </div>

      {/* Controls */}
      <section className="lt-controls" aria-label="Controles da sessão">
        <button
          id="btn-connect"
          className="lt-btn lt-btn-primary"
          onClick={live.connect}
          disabled={live.isConnected}
          aria-label="Conectar à Gemini Live API"
        >
          Conectar
        </button>
        <button
          id="btn-mic"
          className={`lt-btn ${live.micActive ? "lt-btn-danger" : "lt-btn-secondary"}`}
          onClick={live.toggleMic}
          disabled={!live.canToggleMic}
          aria-label={live.micActive ? "Desativar microfone" : "Ativar microfone"}
        >
          {live.micActive ? "🎙 Desativar mic" : "🎙 Ativar mic"}
        </button>
        <button
          id="btn-disconnect"
          className="lt-btn lt-btn-ghost"
          onClick={live.disconnect}
          disabled={!live.isConnected}
          aria-label="Encerrar sessão"
        >
          Encerrar
        </button>
      </section>

      {/* Mic Level */}
      <div className="lt-mic-level" aria-label="Nível do microfone">
        <div className="lt-mic-bar" style={{ width: `${live.micLevel * 100}%` }} />
      </div>

      {/* Transcripts */}
      <section className="lt-transcripts">
        <div className="lt-transcript-box">
          <label className="lt-transcript-label">Entrada (transcrição)</label>
          <div id="transcript-input" className="lt-transcript-text" aria-live="polite">
            {live.inputTranscript || <span className="lt-placeholder">aguardando fala…</span>}
          </div>
        </div>
        <div className="lt-transcript-box">
          <label className="lt-transcript-label">Saída (transcrição)</label>
          <div id="transcript-output" className="lt-transcript-text" aria-live="polite">
            {live.outputTranscript || <span className="lt-placeholder">aguardando resposta…</span>}
          </div>
        </div>
      </section>

      {/* Audio indicator */}
      <div
        className={`lt-audio-indicator ${live.state === "speaking" ? "lt-audio-active" : ""}`}
        aria-label="Indicador de áudio recebido"
      >
        <span /><span /><span /><span /><span />
      </div>

      {/* Silence VAD slider — only when disconnected */}
      <section className="lt-vad-section">
        <label htmlFor="silence-slider" className="lt-vad-label">
          silenceDurationMs:{" "}
          <strong>{live.silenceDurationMs} ms</strong>
          {live.isConnected && (
            <span className="lt-vad-locked"> (alterável somente desconectado)</span>
          )}
        </label>
        <input
          id="silence-slider"
          type="range"
          min={500} max={2000} step={50}
          value={live.silenceDurationMs}
          disabled={live.isConnected}
          onChange={(e) => {
            if (!live.isConnected) live.setSilenceDurationMs(Number(e.target.value));
          }}
          className="lt-slider"
          aria-label="Duração do silêncio em milissegundos"
        />
        <div className="lt-slider-range"><span>500 ms</span><span>2000 ms</span></div>
      </section>

      {/* Info row */}
      <div className="lt-info-row">
        <span className="lt-info-chip">Interrupções: <strong>{live.interruptCount}</strong></span>
        <span className="lt-info-chip">429: <strong>{live.errors429Count}</strong></span>
        <span className="lt-info-chip">Reconexões: <strong>{live.reconnections}</strong></span>
        {live.wsCloseCode !== null && (
          <span className="lt-info-chip">WS close: <strong>{live.wsCloseCode}</strong></span>
        )}
      </div>

      {live.lastError && (
        <div className="lt-error-box" role="alert">
          <strong>Erro:</strong> {live.lastError}
          <div className="lt-error-actions">
            <a href="/" className="lt-btn lt-btn-ghost lt-btn-sm">← Interface principal</a>
            {live.state === "error" && (
              <button className="lt-btn lt-btn-secondary lt-btn-sm" onClick={live.connect}>
                Tentar novamente
              </button>
            )}
          </div>
        </div>
      )}

      {/* Metrics — current turn */}
      <section className="lt-metrics-card" aria-label="Métricas da sessão atual">
        <h2 className="lt-card-title">Métricas — turno atual</h2>
        <dl className="lt-dl">
          <div><dt>Bytes enviados</dt><dd>{live.bytesSent.toLocaleString("pt-BR")} B</dd></div>
          <div><dt>Bytes recebidos</dt><dd>{live.bytesReceived.toLocaleString("pt-BR")} B</dd></div>
        </dl>
      </section>

      {/* Aggregate report */}
      {live.turnHistory.length > 0 && (
        <section className="lt-metrics-card" aria-label="Relatório agregado">
          <h2 className="lt-card-title">Relatório — {live.turnHistory.length} turnos</h2>
          <dl className="lt-dl">
            <div><dt>TTFA mediano</dt><dd id="report-ttfa-median">{fmtMs(median(ttfaValues))}</dd></div>
            <div><dt>TTFA p95</dt><dd id="report-ttfa-p95">{fmtMs(p95(ttfaValues))}</dd></div>
            <div><dt>Barge-in mediano</dt><dd id="report-bargein-median">{fmtMs(median(bargeInValues))}</dd></div>
            <div><dt>Barge-in p95</dt><dd id="report-bargein-p95">{fmtMs(p95(bargeInValues))}</dd></div>
          </dl>
          <details className="lt-history">
            <summary>Histórico de turnos</summary>
            <table className="lt-table">
              <thead>
                <tr>
                  <th>#</th><th>TTFA recebido</th><th>TTFA reproduzido</th><th>Barge-in</th>
                </tr>
              </thead>
              <tbody>
                {live.turnHistory.map((t: TurnMetrics, i: number) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>{fmtMs(t.ttfaReceived)}</td>
                    <td>{fmtMs(t.ttfaPlayed)}</td>
                    <td>{fmtMs(t.bargeInMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </section>
      )}

      <style>{`
        .lt-shell { min-height:100vh; background: radial-gradient(circle at 60% 10%, rgba(168,85,247,.12), transparent 40%), linear-gradient(135deg,#0f0f14 0%,#18181f 100%); color:#e8e8f0; font-family: Inter, ui-sans-serif, system-ui, sans-serif; padding: 0 0 80px; }
        .lt-header { display:flex; align-items:center; justify-content:space-between; padding: 28px 40px; border-bottom: 1px solid rgba(255,255,255,.07); }
        .lt-brand { display:flex; align-items:center; gap:14px; }
        .lt-logo { width:44px; height:44px; border-radius:14px; background:linear-gradient(135deg,#a855f7,#6366f1); display:grid; place-items:center; font-weight:800; font-size:20px; }
        .lt-brand strong { display:block; font-size:18px; letter-spacing:-.03em; }
        .lt-brand small { color:#888; font-size:12px; }
        .lt-back-link { font-size:13px; color:#888; text-decoration:none; border:1px solid rgba(255,255,255,.1); padding:8px 16px; border-radius:10px; transition:.2s; }
        .lt-back-link:hover { color:#e8e8f0; border-color:rgba(255,255,255,.25); }
        .lt-state-row { display:flex; align-items:center; gap:10px; padding: 20px 40px 0; }
        .lt-state-dot { width:10px; height:10px; border-radius:50%; flex-shrink:0; box-shadow: 0 0 0 4px rgba(255,255,255,.08); }
        .lt-state-label { font-size:12px; font-family: "Cascadia Code", Consolas, monospace; letter-spacing:.15em; color:#aaa; }
        .lt-model-badge { font-size:11px; background:rgba(168,85,247,.2); color:#c084fc; padding:3px 10px; border-radius:20px; border:1px solid rgba(168,85,247,.3); }
        .lt-session-dur { font-size:11px; color:#666; margin-left:auto; font-family: monospace; }
        .lt-controls { display:flex; gap:10px; padding: 24px 40px 0; flex-wrap:wrap; }
        .lt-btn { border:0; border-radius:12px; padding:10px 22px; font-size:14px; font-weight:600; cursor:pointer; transition:.2s; }
        .lt-btn:disabled { opacity:.35; cursor:not-allowed; }
        .lt-btn-primary { background:linear-gradient(135deg,#a855f7,#6366f1); color:#fff; box-shadow: 0 8px 24px rgba(168,85,247,.3); }
        .lt-btn-primary:not(:disabled):hover { transform:translateY(-2px); box-shadow: 0 12px 32px rgba(168,85,247,.4); }
        .lt-btn-secondary { background:rgba(255,255,255,.08); color:#e8e8f0; border:1px solid rgba(255,255,255,.12); }
        .lt-btn-secondary:not(:disabled):hover { background:rgba(255,255,255,.14); }
        .lt-btn-danger { background:rgba(255,119,95,.18); color:#ff775f; border:1px solid rgba(255,119,95,.3); }
        .lt-btn-danger:not(:disabled):hover { background:rgba(255,119,95,.28); }
        .lt-btn-ghost { background:transparent; color:#888; border:1px solid rgba(255,255,255,.1); }
        .lt-btn-ghost:not(:disabled):hover { color:#e8e8f0; border-color:rgba(255,255,255,.2); }
        .lt-btn-sm { padding:6px 14px; font-size:12px; }
        .lt-mic-level { height:4px; background:rgba(255,255,255,.06); margin: 16px 40px 0; border-radius:4px; overflow:hidden; }
        .lt-mic-bar { height:100%; background:linear-gradient(90deg,#42aa78,#3b9eff); border-radius:4px; transition:width .05s; }
        .lt-transcripts { display:grid; grid-template-columns:1fr 1fr; gap:16px; padding: 24px 40px 0; }
        @media(max-width:700px){ .lt-transcripts { grid-template-columns:1fr; } }
        .lt-transcript-box { background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08); border-radius:16px; padding:16px; min-height:80px; }
        .lt-transcript-label { font-size:10px; letter-spacing:.12em; color:#666; font-family:monospace; text-transform:uppercase; display:block; margin-bottom:8px; }
        .lt-transcript-text { font-size:14px; line-height:1.6; color:#d0d0e0; }
        .lt-placeholder { color:#444; font-style:italic; }
        .lt-audio-indicator { display:flex; align-items:flex-end; gap:4px; height:40px; padding: 16px 40px 0; }
        .lt-audio-indicator span { width:4px; background:rgba(168,85,247,.25); border-radius:4px; transition:.2s; height:8px; }
        .lt-audio-active span { animation: lt-audio-wave .6s ease-in-out infinite alternate; background:rgba(168,85,247,.8); }
        .lt-audio-active span:nth-child(1){ animation-delay:0s; }
        .lt-audio-active span:nth-child(2){ animation-delay:.1s; }
        .lt-audio-active span:nth-child(3){ animation-delay:.2s; }
        .lt-audio-active span:nth-child(4){ animation-delay:.3s; }
        .lt-audio-active span:nth-child(5){ animation-delay:.4s; }
        @keyframes lt-audio-wave { to { height:32px; } }
        .lt-vad-section { padding: 20px 40px 0; }
        .lt-vad-label { font-size:13px; color:#aaa; display:block; margin-bottom:10px; }
        .lt-vad-locked { font-size:11px; color:#666; margin-left:8px; }
        .lt-slider { width:100%; max-width:420px; accent-color:#a855f7; display:block; }
        .lt-slider-range { display:flex; justify-content:space-between; font-size:11px; color:#555; max-width:420px; margin-top:4px; }
        .lt-info-row { display:flex; flex-wrap:wrap; gap:8px; padding: 16px 40px 0; }
        .lt-info-chip { font-size:12px; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.08); padding:4px 12px; border-radius:20px; color:#aaa; }
        .lt-info-chip strong { color:#e8e8f0; }
        .lt-error-box { margin: 16px 40px 0; background:rgba(239,68,68,.1); border:1px solid rgba(239,68,68,.3); color:#fca5a5; border-radius:14px; padding:16px; font-size:14px; }
        .lt-error-actions { display:flex; gap:8px; margin-top:12px; }
        .lt-metrics-card { margin: 20px 40px 0; background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08); border-radius:20px; padding:24px; }
        .lt-card-title { margin:0 0 16px; font-size:14px; font-weight:700; letter-spacing:-.02em; color:#c084fc; }
        .lt-dl { display:grid; gap:8px; }
        .lt-dl div { display:flex; justify-content:space-between; align-items:center; font-size:13px; font-family:"Cascadia Code",Consolas,monospace; }
        .lt-dl dt { color:#666; }
        .lt-dl dd { margin:0; font-weight:700; color:#e8e8f0; }
        .lt-history { margin-top:16px; }
        .lt-history summary { font-size:12px; color:#888; cursor:pointer; }
        .lt-table { width:100%; border-collapse:collapse; font-size:12px; margin-top:12px; }
        .lt-table th { color:#666; text-align:left; padding:4px 8px; border-bottom:1px solid rgba(255,255,255,.08); }
        .lt-table td { color:#aaa; padding:4px 8px; }
        .lt-table tr:nth-child(even) td { background:rgba(255,255,255,.02); }
      `}</style>
    </main>
  );
}
