const fs = require('node:fs/promises');
const path = require('node:path');
const puppeteer = require('puppeteer');

async function main() {
  const executable = puppeteer.executablePath();
  const sourceDir = path.dirname(executable);
  const destination = path.resolve(__dirname, '..', 'build', 'chromium');
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.cp(sourceDir, destination, { recursive: true, force: true });
  console.log(`Bundled Chromium from ${sourceDir}`);
}

main().catch((error) => {
  console.error(`Cannot prepare Chromium: ${error.message}`);
  process.exitCode = 1;
});
