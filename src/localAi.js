const fs = require('node:fs');
const fsp = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const MODEL_FILE = 'qwen2.5-1.5b-instruct-q4_k_m.gguf';
const MODEL_ALIAS = 'telesales-qwen';

let serverProcess;
let serverPort;
let startPromise;
let status = { state: 'offline', detail: 'AI bawaan belum dimulai.' };
let statusListener = () => {};

function setStatus(next) {
  status = next;
  statusListener(status);
}

function getStatus() { return status; }

function getPaths({ packaged, projectRoot, resourcesPath }) {
  const root = packaged ? resourcesPath : path.join(projectRoot, 'build');
  return {
    executable: path.join(root, 'llama', 'llama-server.exe'),
    model: path.join(root, 'models', MODEL_FILE)
  };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => resolve(address.port));
    });
  });
}

async function waitForHealthy(url, timeoutMs = 120000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch { /* model is still loading */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Runtime AI tidak siap dalam 120 detik.');
}

async function start(options) {
  if (serverProcess && status.state === 'ready') return status;
  if (startPromise) return startPromise;
  startPromise = (async () => {
    const paths = getPaths(options);
    if (!fs.existsSync(paths.executable)) throw new Error(`Runtime AI tidak ditemukan: ${paths.executable}`);
    if (!fs.existsSync(paths.model)) throw new Error(`Model AI tidak ditemukan: ${paths.model}`);
    serverPort = await freePort();
    setStatus({ state: 'starting', detail: 'Memuat model AI bawaan…' });
    serverProcess = spawn(paths.executable, [
      '-m', paths.model,
      '--host', '127.0.0.1',
      '--port', String(serverPort),
      '--ctx-size', '4096',
      '--threads', String(Math.max(2, Math.min(8, require('node:os').cpus().length))),
      '--alias', MODEL_ALIAS
    ], { cwd: path.dirname(paths.executable), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    serverProcess.stdout?.on('data', (chunk) => { if (process.env.WA_AI_DEBUG) console.log(`[llama] ${chunk}`); });
    serverProcess.stderr?.on('data', (chunk) => { if (process.env.WA_AI_DEBUG) console.error(`[llama] ${chunk}`); });
    serverProcess.once('exit', (code) => {
      serverProcess = null;
      serverPort = null;
      if (status.state !== 'stopping') setStatus({ state: 'error', detail: `Runtime AI berhenti (kode ${code ?? 'unknown'}).` });
    });
    await waitForHealthy(`http://127.0.0.1:${serverPort}/health`);
    setStatus({ state: 'ready', detail: 'AI bawaan siap digunakan tanpa akun atau API key.' });
    return status;
  })().catch((error) => {
    serverProcess?.kill();
    serverProcess = null;
    setStatus({ state: 'error', detail: error.message });
    throw error;
  }).finally(() => { startPromise = null; });
  return startPromise;
}

async function chat(messages) {
  if (!serverPort || status.state !== 'ready') throw new Error('AI bawaan belum siap. Tekan Mulai ulang AI atau tunggu model selesai dimuat.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
  try {
    const response = await fetch(`http://127.0.0.1:${serverPort}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL_ALIAS, messages, temperature: 0.2, max_tokens: 256, stream: false }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`AI bawaan gagal (${response.status}).`);
    const result = await response.json();
    const content = result?.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error('AI bawaan tidak menghasilkan draft jawaban.');
    return content;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('AI bawaan tidak merespons dalam 90 detik.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function stop() {
  if (!serverProcess) return;
  setStatus({ state: 'stopping', detail: 'Mematikan AI bawaan…' });
  const processToStop = serverProcess;
  serverProcess = null;
  processToStop.kill();
  await new Promise((resolve) => setTimeout(resolve, 300));
  setStatus({ state: 'offline', detail: 'AI bawaan berhenti.' });
}

function configure(listener) { statusListener = listener; }

module.exports = { MODEL_FILE, configure, getStatus, getPaths, start, chat, stop };
