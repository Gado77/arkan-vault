import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { Socket } from 'node:net';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = join(__dirname, '..');

// Helper para ler .env.local sem dependência externa
function readEnvLocal(name) {
  try {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = readFileSync(join(webRoot, ".env.local"), "utf8").match(
      new RegExp(`^${escaped}=(.+)$`, "m")
    );
    return match?.[1]?.trim() || "";
  } catch {
    return "";
  }
}

console.log("Iniciando Hermes Local Appliance...\n");

function checkPort(port) {
  return new Promise((resolve) => {
    const s = new Socket();
    s.once('error', () => { s.destroy(); resolve(false); });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.connect(port, '127.0.0.1');
  });
}

async function checkVinext() {
  return new Promise((resolve) => {
    const req = request({ hostname: '127.0.0.1', port: 3000, path: '/', method: 'GET' }, (res) => {
      resolve(true);
    });
    req.once('error', () => resolve(false));
    req.end();
  });
}

function spawnProcess(name, cmd, args, cwd, env = {}) {
  const p = spawn(cmd, args, { 
    cwd, 
    shell: true, 
    stdio: 'inherit',
    env: { ...process.env, ...env }
  });
  console.log(`[${name}] Iniciado (PID: ${p.pid})`);
  return p;
}

async function startAll() {
  // 1. Iniciar Wake Daemon
  const isWakeUp = await checkPort(8766);
  if (!isWakeUp) {
    spawnProcess('wake-daemon', 'powershell', ['-ExecutionPolicy', 'Bypass', '-File', 'scripts\\start-wake.ps1'], webRoot);
  } else {
    console.log('[wake-daemon] Já está rodando na porta 8766');
  }

  // 2. Iniciar Vinext
  const isVinextUp = await checkVinext();
  if (!isVinextUp) {
    spawnProcess('vinext', 'powershell', ['-ExecutionPolicy', 'Bypass', '-Command', '$env:WRANGLER_LOG_PATH = \'.wrangler/wrangler.log\'; npx vinext dev'], webRoot);
  } else {
    console.log('[vinext] Já está rodando na porta 3000');
  }

  // 3. Iniciar Proxy Local
  const isProxyUp = await checkPort(4174);
  if (!isProxyUp) {
    spawnProcess('proxy', 'node', ['scripts/local-preview.mjs'], webRoot, {
      HERMES_UI_UPSTREAM_PORT: '3000'
    });
  } else {
    console.log('[proxy] Já está rodando na porta 4174');
  }

  console.log("\nAguardando serviços ficarem READY...\n");
  
  let ready = false;
  let attempts = 0;
  
  while (!ready && attempts < 30) {
    await new Promise(r => setTimeout(r, 2000));
    attempts++;
    
    const wakeReady = await checkPort(8766);
    const vinextReady = await checkVinext();
    const proxyReady = await checkPort(4174);
    
    // Check wake bridge
    const bridgeReady = await new Promise((resolve) => {
      if (!proxyReady || !wakeReady) return resolve(false);
      const req = request({
        hostname: '127.0.0.1',
        port: 4174,
        path: '/api/wake-stream',
        method: 'GET',
        headers: { 'Connection': 'Upgrade', 'Upgrade': 'websocket' }
      });
      req.on('upgrade', (res, socket) => {
        socket.destroy();
        resolve(true);
      });
      req.on('error', () => resolve(false));
      req.end();
    });

    const geminiKey = readEnvLocal("GEMINI_API_KEY");
    const geminiReady = !!geminiKey;
    const arkanBase = readEnvLocal("ARKAN_VAULT_URL") || "unknown";

    if (wakeReady && vinextReady && proxyReady && bridgeReady) {
      console.log("\n----------------------------");
      console.log("Hermes Local");
      console.log("----------------------------");
      console.log(`Vinext        : READY :3000`);
      console.log(`UI Proxy      : READY :4174`);
      console.log(`Wake daemon   : READY :8766`);
      console.log(`Wake bridge   : READY`);
      console.log(`Gemini config : ${geminiReady ? 'READY' : 'MISSING'}`);
      console.log(`Arkan         : READY | ${arkanBase}`);
      console.log("\nOpen: http://127.0.0.1:4174");
      console.log("----------------------------\n");
      ready = true;
    }
  }

  if (!ready) {
    console.log("Timeout aguardando serviços. O Wake Daemon pode não estar rodando.");
  }
}

startAll().catch(console.error);
