import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = process.cwd();

async function startOllamaIfNeeded() {
  try {
    const response = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(1500) });
    if (response.ok) return;
  } catch {
    // Ollama is optional; the app can still start and report it as offline.
  }
  try {
    const ollama = spawn("ollama", ["serve"], {
      stdio: "ignore",
      windowsHide: true,
      detached: true,
    });
    ollama.unref();
    ollama.once("error", (error) => {
      console.warn(`Could not start Ollama automatically: ${error.message}`);
    });
  } catch (error) {
    console.warn(`Could not start Ollama automatically: ${error.message}`);
  }
}

void startOllamaIfNeeded();

const children = [
  spawn(process.execPath, [resolve(root, "server.mjs"), "--dev"], { cwd: root, stdio: "inherit" }),
  spawn(process.execPath, [resolve(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1"], {
    cwd: root,
    stdio: "inherit",
  }),
];

let stopping = false;
const stop = (code = 0) => {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill();
  }
  process.exitCode = code;
};

for (const child of children) {
  child.on("error", (error) => {
    console.error("Could not start a development process:", error.message);
    stop(1);
  });
  child.on("exit", (code) => {
    if (!stopping) stop(code || 0);
  });
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
