import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer, request } from "node:http";
import { request as secureRequest } from "node:https";
import { homedir } from "node:os";
import { extname, join, normalize } from "node:path";
import { WebSocketServer } from "ws";
import { Socket } from "node:net";

// ── Gemini Live token helpers ─────────────────────────────────────────────────
// Read a variable from .env.local without leaking it to process.env.
function readEnvLocal(name) {
  try {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = readFileSync(join(webRoot, ".env.local"), "utf8").match(
      new RegExp(`^${escaped}=(.+)$`, "m"),
    );
    return match?.[1]?.trim() || "";
  } catch {
    return "";
  }
}

// geminiLiveToken() — calls the Gemini ephemeral-token API server-side.
// Returns { accessToken, model, newSessionExpireTime, expireTime } or throws.
// The permanent API key is NEVER returned to the caller; only the token name is.
async function geminiLiveToken() {
  const apiKey = readEnvLocal("GEMINI_API_KEY");
  if (!apiKey) throw Object.assign(new Error("GEMINI_API_KEY not configured on server"), { status: 503 });

  const model = readEnvLocal("GEMINI_LIVE_MODEL") || "gemini-3.1-flash-live-preview";
  const now = Date.now();
  const newSessionExpireTime = new Date(now + 60 * 1000).toISOString();
  const expireTime = new Date(now + 15 * 60 * 1000).toISOString();

  const body = JSON.stringify({
    uses: 1,
    newSessionExpireTime,
    expireTime,
  });

  return new Promise((resolve, reject) => {
    const req = secureRequest(
      {
        hostname: "generativelanguage.googleapis.com",
        path: `/v1beta/auth_tokens?key=${apiKey}`,
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { raw += c; });
        res.on("end", () => {
          if (res.statusCode === 429) {
            return reject(Object.assign(new Error("Gemini quota exceeded"), { status: 429 }));
          }
          if (res.statusCode !== 200) {
            console.error(`[gemini-live/token] Gemini API status=${res.statusCode} body=${raw.slice(0, 200)}`);
            return reject(Object.assign(new Error(`Gemini returned ${res.statusCode}`), { status: 502 }));
          }
          try {
            const data = JSON.parse(raw);
            const accessToken = data.name;
            if (!accessToken) return reject(Object.assign(new Error("Gemini response missing .name"), { status: 502 }));
            resolve({ accessToken, model, newSessionExpireTime, expireTime });
          } catch {
            console.error("[gemini-live/token] Invalid JSON:", raw.slice(0, 200));
            reject(Object.assign(new Error("Invalid JSON from Gemini"), { status: 502 }));
          }
        });
      },
    );
    req.on("error", (e) => {
      console.error("[gemini-live/token] network error:", e.message);
      reject(Object.assign(new Error("Failed to reach Gemini API"), { status: 502 }));
    });
    req.write(body);
    req.end();
  });
}
// ─────────────────────────────────────────────────────────────────────────────


const root = new URL("../dist/client/", import.meta.url).pathname.replace(/^\/(.:)/, "$1");

async function findUpstreamPort() {
  if (process.env.HERMES_UI_UPSTREAM_PORT) {
    return Number(process.env.HERMES_UI_UPSTREAM_PORT);
  }
  // Autodiscovery fallback (3000, then 3001)
  for (const p of [3000, 3001]) {
    try {
      const isHealthy = await new Promise((resolve) => {
        const req = request({ hostname: "127.0.0.1", port: p, path: "/api/live-tools/health", method: "GET" }, (res) => {
          if (res.statusCode !== 200) return resolve(false);
          let raw = "";
          res.on("data", (c) => { raw += c; });
          res.on("end", () => {
             try {
                const data = JSON.parse(raw);
                resolve(data.service === "hermes-live-tools");
             } catch {
                resolve(false);
             }
          });
        });
        req.on("error", () => resolve(false));
        req.end();
      });
      if (isHealthy) return p;
    } catch {
      continue;
    }
  }
  return 4173; // Default fallback
}

const upstreamPort = await findUpstreamPort();
const port = Number(process.env.PORT || 4174);

const arkanUrl = readEnvLocal("ARKAN_VAULT_URL") || "http://127.0.0.1:8765";
const isRemote = arkanUrl !== "http://127.0.0.1:8765";
const arkanMode = arkanUrl.includes("tailnet") || arkanUrl.includes("ts.net") 
  ? "tailscale-serve" 
  : (isRemote ? "remote" : "local-fallback");

let arkanHealth = "ERROR";
let arkanContract = "incompatible";
let arkanLatency = 0;

try {
  const start = performance.now();
  const res = await fetch(`${arkanUrl.replace(/\/+$/, "")}/openapi.json`, { signal: AbortSignal.timeout(3000) });
  arkanLatency = Math.round(performance.now() - start);
  
  if (res.ok) {
    arkanHealth = "OK";
    const data = await res.json();
    const paths = data?.paths || {};
    if (paths["/api/v1/memories/search"] && paths["/api/v1/memories"]) {
      arkanContract = "compatible";
    }
  }
} catch {
  // Arkan is offline
}

console.log("\n[Hermes Network Topology]");
console.log(`UI Proxy       : ${port}`);
console.log(`Vinext         : ${upstreamPort}`);
console.log(`Wake daemon    : ${process.env.WAKE_PORT || 8766}`);
console.log("");
console.log(`Arkan endpoint : ${arkanUrl}`);
console.log(`Arkan mode     : ${arkanMode}`);
console.log(`Arkan health   : ${arkanHealth}`);
console.log(`Arkan contract : ${arkanContract}`);
console.log(`Arkan latency  : ${arkanLatency} ms`);
console.log(`Gemini tools   : /api/live-tools/execute → :${upstreamPort}\n`);
const hermesHome = process.env.HERMES_HOME || (process.platform === "win32"
  ? join(process.env.LOCALAPPDATA || homedir(), "hermes")
  : join(homedir(), ".hermes"));
const webRoot = new URL("../", import.meta.url).pathname.replace(/^\/(.:)/, "$1");
const readiness = { alive: false, ready: false, warmup_ms: 0, session_id: "", stored_session_id: "", error: "" };
let warmupSocket;
let warmupRpcId = 0;
const warmupPending = new Map();

function hermesEnv(name) {
  try {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = readFileSync(join(hermesHome, ".env"), "utf8").match(new RegExp(`^${escaped}=(.+)$`, "m"));
    return match?.[1]?.trim() || "";
  } catch {
    return "";
  }
}

function hermesApiKey() {
  return hermesEnv("API_SERVER_KEY");
}

function gatewayToken() {
  try {
    return readFileSync(join(webRoot, ".env.local"), "utf8").match(/^NEXT_PUBLIC_HERMES_GATEWAY_TOKEN=(.+)$/m)?.[1]?.trim() || "";
  } catch {
    return "";
  }
}

function warmupRequest(method, params = {}) {
  const id = `warm-${++warmupRpcId}`;
  warmupSocket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  return new Promise((resolve, reject) => warmupPending.set(id, { resolve, reject }));
}

function startHermesWarmup() {
  const started = performance.now();
  readiness.alive = false;
  readiness.ready = false;
  readiness.error = "";
  const token = gatewayToken();
  warmupSocket = new WebSocket(`ws://127.0.0.1:9119/api/ws?token=${encodeURIComponent(token)}`);
  warmupSocket.onopen = () => { readiness.alive = true; };
  warmupSocket.onmessage = async ({ data }) => {
    const frame = JSON.parse(String(data));
    if (frame.id != null) {
      const pending = warmupPending.get(String(frame.id));
      if (!pending) return;
      warmupPending.delete(String(frame.id));
      frame.error ? pending.reject(new Error(frame.error.message || "Hermes RPC failed")) : pending.resolve(frame.result);
      return;
    }
    const event = frame.params || {};
    try {
      if (event.type === "gateway.ready" && !readiness.session_id) {
        const created = await warmupRequest("session.create", { cols: 100, source: "hermes-web-warmup" });
        readiness.session_id = created.session_id;
        readiness.stored_session_id = created.stored_session_id;
        await warmupRequest("prompt.submit", { session_id: created.session_id, text: "Responda somente: pronto." });
      } else if (event.type === "message.complete" && event.session_id === readiness.session_id) {
        readiness.ready = true;
        readiness.warmup_ms = Math.round(performance.now() - started);
      }
    } catch (error) {
      readiness.error = error instanceof Error ? error.message : String(error);
    }
  };
  warmupSocket.onerror = () => { readiness.error = "Gateway do Hermes indisponível"; };
  warmupSocket.onclose = () => {
    readiness.alive = false;
    readiness.ready = false;
    readiness.session_id = "";
    readiness.stored_session_id = "";
    for (const pending of warmupPending.values()) pending.reject(new Error("Gateway disconnected"));
    warmupPending.clear();
    setTimeout(startHermesWarmup, 2000);
  };
}
const mime = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".png": "image/png",
};

const wss = new WebSocketServer({ noServer: true });

const server = createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url || "/", "http://localhost").pathname);
  if (pathname === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (pathname === "/api/hermes/readiness") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(readiness));
    return;
  }
  if (pathname === "/api/gemini-live/token") {
    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }
    geminiLiveToken()
      .then((data) => {
        // Return only accessToken + expiry — the permanent API key is never included.
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        res.end(JSON.stringify(data));
      })
      .catch((err) => {
        const status = err.status || 500;
        res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        res.end(JSON.stringify({ error: err.message || "Internal error" }));
      });
    return;
  }
  // ── Pass-through Next.js Route Handlers to upstream (vinext start) ──────────
  // These paths are handled by the Next.js server (port 3000), not this proxy.
  if (
    pathname.startsWith("/api/live-tools/") ||
    pathname.startsWith("/api/live-session/")
  ) {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const payload = chunks.length ? Buffer.concat(chunks) : null;
      const upstreamReq = request(
        {
          hostname: "localhost",
          port: upstreamPort,
          path: req.url,
          method: req.method,
          headers: { ...req.headers, host: `localhost:${upstreamPort}` },
        },
        (upstreamRes) => {
          res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
          upstreamRes.pipe(res);
        },
      );
      upstreamReq.on("error", () => {
        if (res.writableEnded) return;
        res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "upstream_unavailable" }));
      });
      if (payload) upstreamReq.write(payload);
      upstreamReq.end();
    });
    return;
  }
  if (pathname === "/api/hermes/chat" && req.method === "POST") {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const payload = Buffer.concat(chunks);
      const key = hermesApiKey();
      const upstream = request({
        hostname: "127.0.0.1",
        port: 8642,
        path: "/v1/chat/completions",
        method: "POST",
        headers: {
          "authorization": `Bearer ${key}`,
          "content-type": "application/json",
          "content-length": payload.length,
          "x-hermes-session-id": "hermes-web-local",
          "x-hermes-session-key": "arkan-home-assistant",
        },
      }, (upstreamResponse) => {
        res.writeHead(upstreamResponse.statusCode || 502, {
          "content-type": upstreamResponse.headers["content-type"] || "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        upstreamResponse.pipe(res);
      });
      upstream.on("error", () => {
        res.writeHead(503, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: { message: "O serviço do Hermes está desligado." } }));
      });
      upstream.end(payload);
    });
    return;
  }
  if (pathname.startsWith("/api/hermes/voice/")) {
    const voicePath = pathname.endsWith("/transcribe") ? "/transcribe" : pathname.endsWith("/tts") ? "/tts" : pathname.endsWith("/trace") ? "/trace" : "/health";
    const query = new URL(req.url || "/", "http://localhost").search;
    const upstream = request({
      hostname: "127.0.0.1",
      port: 8643,
      path: voicePath + query,
      method: req.method,
      headers: { ...req.headers, host: "127.0.0.1:8643" },
    }, (upstreamResponse) => {
      res.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(res);
    });
    upstream.on("error", () => {
      res.writeHead(503, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "O serviço de voz do Hermes está desligado." }));
    });
    req.pipe(upstream);
    return;
  }
  const relative = pathname.replace(/^\/+/, "");
  const candidate = normalize(join(root, relative));
  if (candidate.startsWith(normalize(root)) && existsSync(candidate) && statSync(candidate).isFile()) {
    res.writeHead(200, {
      "content-type": mime[extname(candidate)] || "application/octet-stream",
      "cache-control": "no-cache",
    });
    createReadStream(candidate).pipe(res);
    return;
  }

  const proxy = request(
    { hostname: "localhost", port: upstreamPort, path: req.url, method: req.method, headers: req.headers },
    (upstream) => {
      res.writeHead(upstream.statusCode || 502, upstream.headers);
      upstream.pipe(res);
    },
  );
  proxy.on("error", () => {
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end("Hermes UI indisponível");
  });
  req.pipe(proxy);
});

server.on("upgrade", (req, socket, head) => {
  const pathname = decodeURIComponent(new URL(req.url || "/", "http://localhost").pathname);
  if (pathname === "/api/wake-stream") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      const tcpClient = new Socket();
      tcpClient.connect(8766, "127.0.0.1", () => {
        // Connected to Wake Word Python Daemon
      });

      ws.on("message", (msg) => {
        if (tcpClient.writable) tcpClient.write(msg);
      });

      let textBuffer = "";
      tcpClient.on("data", (data) => {
        textBuffer += data.toString("utf8");
        const lines = textBuffer.split("\n");
        textBuffer = lines.pop() || "";
        for (const line of lines) {
          if (line.trim()) {
            if (ws.readyState === ws.OPEN) ws.send(line);
          }
        }
      });

      ws.on("close", () => tcpClient.destroy());
      tcpClient.on("close", () => ws.close());
      tcpClient.on("error", () => ws.close());
    });
  } else {
    // Drop unexpected WS upgrades
    socket.destroy();
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Hermes UI local em http://127.0.0.1:${port}`);
  startHermesWarmup();
});
