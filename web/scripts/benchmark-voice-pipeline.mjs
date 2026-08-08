import { ProgressiveTTSChunker } from "../lib/progressive-tts-chunker.ts";

const mode = process.argv[2] || "progressive";
const token = process.env.HERMES_DASHBOARD_SESSION_TOKEN || "arkan-local-7f39c2aab64e48d9a970e2c6";
const questions = [
  "Explique em duas frases por que o céu parece azul.",
  "Dê duas dicas curtas para organizar tarefas hoje.",
  "Explique em duas frases o que é memória de longo prazo.",
  "Diga em duas frases como economizar energia em casa.",
  "Resuma em duas frases por que dormir bem é importante.",
  "Explique em duas frases a diferença entre internet e Wi-Fi.",
  "Dê duas sugestões curtas para manter o computador rápido.",
  "Explique em duas frases como funciona uma senha segura.",
  "Resuma em duas frases a utilidade de fazer backups.",
  "Diga em duas frases como manter uma conversa produtiva.",
];

class LegacyChunker {
  buffer = "";
  feed(delta) {
    this.buffer += delta;
    const chunks = [];
    while (true) {
      const match = [...this.buffer.matchAll(/[.!?](?:\s|$)/g)].find((item) => this.buffer.slice(0, item.index + item[0].length).trim().length >= 20);
      if (!match) break;
      const cut = match.index + match[0].length;
      chunks.push(this.buffer.slice(0, cut).trim());
      this.buffer = this.buffer.slice(cut);
    }
    return chunks;
  }
  flush() { const value = this.buffer.trim(); this.buffer = ""; return value ? [value] : []; }
}

const socket = new WebSocket(`ws://127.0.0.1:9119/api/ws?token=${encodeURIComponent(token)}`);
let rpcId = 0;
const pending = new Map();
let sessionId = "";
let activeTurn = null;
let warmComplete = false;

function request(method, params = {}) {
  const id = `pipeline-${++rpcId}`;
  socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function synthesizeFirstBytes(turn, text, sequence) {
  const started = performance.now();
  const url = `http://127.0.0.1:8643/tts?text=${encodeURIComponent(text)}&trace_id=${turn.traceId}&generation_id=${turn.generationId}&sequence=${sequence}`;
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`TTS ${response.status}`);
  await response.body.getReader().read();
  return { firstBytesAt: performance.now(), ttsFirstBytesMs: Math.round(performance.now() - started) };
}

function acceptChunks(turn, chunks) {
  for (const chunk of chunks) {
    const sequence = turn.sequence++;
    if (!turn.firstChunkAt) {
      turn.firstChunkAt = performance.now();
      turn.firstChunkWords = chunk.split(/\s+/).length;
      turn.firstAudioPromise = synthesizeFirstBytes(turn, chunk, sequence);
    } else {
      void fetch(`http://127.0.0.1:8643/tts?text=${encodeURIComponent(chunk)}&trace_id=${turn.traceId}&generation_id=${turn.generationId}&sequence=${sequence}`).catch(() => undefined);
    }
  }
}

socket.onmessage = async ({ data }) => {
  const frame = JSON.parse(String(data));
  if (frame.id != null) {
    const call = pending.get(String(frame.id));
    if (!call) return;
    pending.delete(String(frame.id));
    frame.error ? call.reject(new Error(frame.error.message)) : call.resolve(frame.result);
    return;
  }
  const event = frame.params || {};
  if (event.type === "gateway.ready") {
    const created = await request("session.create", { cols: 100, source: `voice-benchmark-${mode}` });
    sessionId = created.session_id;
    await request("prompt.submit", { session_id: sessionId, text: "Responda somente: aquecido." });
    return;
  }
  if (!activeTurn && event.session_id === sessionId && event.type === "message.complete") {
    warmComplete = true;
    return;
  }
  if (!activeTurn || event.session_id !== sessionId) return;
  if (event.type === "message.delta") {
    const delta = event.payload?.text || "";
    if (!delta) return;
    if (!activeTurn.firstTokenAt) activeTurn.firstTokenAt = performance.now();
    acceptChunks(activeTurn, activeTurn.chunker.feed(delta));
  } else if (event.type === "message.complete") {
    acceptChunks(activeTurn, activeTurn.chunker.flush());
    activeTurn.complete();
  }
};

await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("gateway warm-up timeout")), 120000);
  const check = setInterval(() => {
    if (warmComplete) {
      clearInterval(check); clearTimeout(timeout); resolve();
    }
  }, 100);
});

const results = [];
for (const question of questions) {
  const started = performance.now();
  let complete;
  const completePromise = new Promise((resolve) => { complete = resolve; });
  activeTurn = {
    traceId: crypto.randomUUID(), generationId: crypto.randomUUID(), started,
    firstTokenAt: 0, firstChunkAt: 0, firstChunkWords: 0, sequence: 0,
    firstAudioPromise: null, chunker: mode === "legacy" ? new LegacyChunker() : new ProgressiveTTSChunker(), complete,
  };
  await request("prompt.submit", { session_id: sessionId, text: question });
  await completePromise;
  const audio = await activeTurn.firstAudioPromise;
  results.push({
    question,
    hermes_first_token_ms: Math.round(activeTurn.firstTokenAt - started),
    first_token_to_first_tts_chunk_ms: Math.round(activeTurn.firstChunkAt - activeTurn.firstTokenAt),
    tts_first_bytes_ms: audio.ttsFirstBytesMs,
    pipeline_ttfa_ms: Math.round(audio.firstBytesAt - started),
    perceived_ttfa_ms: Math.round(audio.firstBytesAt - started + 1500),
    first_chunk_words: activeTurn.firstChunkWords,
  });
  activeTurn = null;
}

function summary(key) {
  const values = results.map((item) => item[key]).sort((a, b) => a - b);
  return { median: values[Math.floor(values.length / 2)], p95: values[Math.ceil(values.length * 0.95) - 1] };
}
process.stdout.write(JSON.stringify({ mode, note: "perceived_ttfa_ms adds a fixed 1500ms endpointing+STT baseline", summaries: {
  hermes_first_token_ms: summary("hermes_first_token_ms"),
  first_token_to_first_tts_chunk_ms: summary("first_token_to_first_tts_chunk_ms"),
  tts_first_bytes_ms: summary("tts_first_bytes_ms"),
  pipeline_ttfa_ms: summary("pipeline_ttfa_ms"),
  perceived_ttfa_ms: summary("perceived_ttfa_ms"),
}, results }, null, 2));
socket.close();
