const token = process.env.HERMES_DASHBOARD_SESSION_TOKEN || "arkan-local-7f39c2aab64e48d9a970e2c6";
const socket = new WebSocket(`ws://127.0.0.1:9119/api/ws?token=${encodeURIComponent(token)}`);
let nextId = 0;
const pending = new Map();
let sessionId = "";
let started = 0;
let firstToken = 0;
let phase = "connecting";
const turns = [];
let turnNumber = 1;

function request(method, params = {}) {
  const id = `bench-${++nextId}`;
  socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
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
    phase = "creating session";
    const created = await request("session.create", { cols: 100, source: "latency-benchmark" });
    sessionId = created.session_id;
    phase = `submitting prompt to ${sessionId}`;
    started = performance.now();
    await request("prompt.submit", { session_id: sessionId, text: "Responda somente: pronto." });
  } else if (event.session_id === sessionId && event.type === "message.delta") {
    phase = "receiving deltas";
    if (!firstToken) firstToken = performance.now();
  } else if (event.session_id === sessionId && event.type === "message.complete") {
    const total = performance.now();
    turns.push({ turn: turnNumber, first_token_ms: Math.round(firstToken - started), total_ms: Math.round(total - started), answer: event.payload?.text });
    if (turnNumber < 3) {
      turnNumber += 1;
      firstToken = 0;
      started = performance.now();
      phase = "submitting warm prompt";
      await request("prompt.submit", { session_id: sessionId, text: turnNumber === 2 ? "Responda somente: dois." : "Responda somente: três." });
    } else {
      clearTimeout(timeout);
      process.stdout.write(JSON.stringify(turns, null, 2));
      socket.close();
    }
  }
};

socket.onerror = () => { phase = "websocket error"; };
socket.onclose = ({ code, reason }) => { phase = `closed ${code} ${reason}`; };

const timeout = setTimeout(() => {
  process.stderr.write(`benchmark timeout (${phase})\n`);
  process.exit(1);
}, 90000);
