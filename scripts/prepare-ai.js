const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const https = require('node:https');

const runtimeUrl = 'https://github.com/ggml-org/llama.cpp/releases/download/b11335/llama-b11335-bin-win-cpu-x64.zip';
const modelUrl = 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf?download=true';
const root = path.resolve(__dirname, '..');
const downloads = path.join(root, 'build', 'downloads');
const runtimeZip = path.join(downloads, 'llama-win-cpu-x64.zip');
const modelDownload = path.join(downloads, 'qwen2.5-1.5b-instruct-q4_k_m.gguf');
const llamaDir = path.join(root, 'build', 'llama');
const modelDir = path.join(root, 'build', 'models');
const modelPath = path.join(modelDir, 'qwen2.5-1.5b-instruct-q4_k_m.gguf');

function download(url, destination) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'WA-Telesales-Assistant' } }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        return download(response.headers.location, destination).then(resolve, reject);
      }
      if (response.statusCode !== 200) return reject(new Error(`Download gagal (${response.statusCode}) untuk ${url}`));
      const temporary = `${destination}.tmp`;
      const output = fs.createWriteStream(temporary);
      response.pipe(output);
      output.once('finish', async () => {
        output.close();
        await fsp.rename(temporary, destination);
        resolve();
      });
      output.once('error', reject);
    });
    request.once('error', reject);
  });
}

async function main() {
  await fsp.mkdir(downloads, { recursive: true });
  await fsp.mkdir(modelDir, { recursive: true });
  if (!fs.existsSync(runtimeZip)) { console.log('Downloading llama.cpp runtime…'); await download(runtimeUrl, runtimeZip); }
  if (!fs.existsSync(path.join(llamaDir, 'llama-server.exe'))) {
    await fsp.rm(llamaDir, { recursive: true, force: true });
    await fsp.mkdir(llamaDir, { recursive: true });
    const extraction = spawnSync('tar.exe', ['-xf', runtimeZip, '-C', llamaDir], { stdio: 'inherit' });
    if (extraction.status !== 0) throw new Error('Gagal mengekstrak runtime llama.cpp.');
    const nested = (await fsp.readdir(llamaDir, { withFileTypes: true })).find((entry) => entry.isDirectory());
    if (nested && fs.existsSync(path.join(llamaDir, nested.name, 'llama-server.exe'))) {
      const nestedDir = path.join(llamaDir, nested.name);
      const entries = await fsp.readdir(nestedDir);
      for (const entry of entries) await fsp.rename(path.join(nestedDir, entry), path.join(llamaDir, entry));
      await fsp.rm(nestedDir, { recursive: true, force: true });
    }
  }
  if (!fs.existsSync(modelDownload) || (await fsp.stat(modelDownload)).size < 500_000_000) { console.log('Downloading local AI model (~1.1 GB)…'); await download(modelUrl, modelDownload); }
  if (!fs.existsSync(modelPath)) await fsp.copyFile(modelDownload, modelPath);
  console.log(`Local AI prepared: ${modelPath}`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
