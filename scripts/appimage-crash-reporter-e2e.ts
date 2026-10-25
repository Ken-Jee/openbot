// Runs the real Electron with the crash reporter start of `src/main/index.ts` (#3066):
// 1. A normal Linux run starts Crashpad's handler, so a crash still keeps a dump (#2675).
// 2. An AppImage run (`APPIMAGE` set) starts no handler. The AppImage runtime removes its mount when
//    OpenBot quits, and a handler that still runs from that mount then dies with SIGBUS.
//
// Run on Linux: bun scripts/appimage-crash-reporter-e2e.ts
// It writes .openbot-build/appimage-crash-reporter-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { withoutElectronRuntimeFlags } from "./electron-spawn-env";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "appimage-crash-reporter-e2e");
const STATE_TIMEOUT_MS = 30_000;
// The Electron binary itself, not the `.bin/electron` Node wrapper.
const electronPath = join(
  ROOT,
  "node_modules",
  "electron",
  "dist",
  readFileSync(join(ROOT, "node_modules", "electron", "path.txt"), "utf8").trim(),
);

await mkdir(OUT, { recursive: true });
const root = await mkdtemp(join(tmpdir(), "openbot-appimage-crash-reporter-"));
const bundle = join(root, "exit-records-electron.mjs");
const children: ChildProcess[] = [];
let passed = false;
let error: string | undefined;
const results: { plainHandlers?: number; appImageHandlers?: number } = {};

try {
  assert.equal(process.platform, "linux", "this test runs on Linux");
  const build = spawnSync(process.execPath, [
    "build",
    join(ROOT, "scripts", "exit-records-electron.ts"),
    "--target=node",
    "--format=esm",
    "--external=electron",
    `--outfile=${bundle}`,
  ]);
  assert.equal(build.status, 0, `bun build failed: ${build.stderr.toString()}`);

  // 1. A normal run keeps the crash reporter.
  results.plainHandlers = await crashpadHandlers("plain", {});
  assert.ok(results.plainHandlers > 0, "a normal Linux run starts Crashpad's handler");

  // 2. An AppImage run starts no handler that could outlive the mount.
  results.appImageHandlers = await crashpadHandlers("appimage", { APPIMAGE: join(root, "OpenBot.AppImage") });
  assert.equal(results.appImageHandlers, 0, "an AppImage run starts no Crashpad handler");
  passed = true;
} catch (cause) {
  error = cause instanceof Error ? cause.message : String(cause);
} finally {
  for (const child of children)
    if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  await rm(root, { recursive: true, force: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, results, error }, null, 2)}\n`);
  process.stdout.write(
    `${passed ? "PASS" : "FAIL"}${error ? `: ${error}` : ""}: report in ${join(OUT, "report.json")}\n`,
  );
  if (!passed) process.exitCode = 1;
}

/** Starts the app, counts the Crashpad handlers that serve its user data, and quits it. */
async function crashpadHandlers(name: string, environment: Record<string, string>): Promise<number> {
  const userData = join(root, name);
  const readyFile = join(root, `${name}-ready.json`);
  const log = openSync(join(OUT, `${name}-electron.log`), "w");
  const { APPIMAGE: _inherited, ...base } = withoutElectronRuntimeFlags(process.env);
  const app = spawn(electronPath, [bundle, `--user-data=${userData}`, `--ready-file=${readyFile}`], {
    env: { ...base, ...environment },
    stdio: ["pipe", log, log],
  });
  children.push(app);
  closeSync(log);
  const exited = new Promise<number | null>((done) => app.once("exit", (code) => done(code)));
  let stopped = false;
  void exited.then(() => {
    stopped = true;
  });
  await until(() => existsSync(readyFile) || stopped, "the app is ready");
  assert.equal(stopped, false, `Electron stopped before it was ready: see ${OUT}`);
  // The handler starts with the crash reporter, before the window, so it runs by now if it runs at all.
  const handlers = processesWith(`--database=${join(userData, "Crashpad")}`);
  app.stdin?.end("quit\n");
  assert.equal(await exited, 0, "Electron quits cleanly");
  return handlers;
}

function processesWith(argument: string): number {
  return readdirSync("/proc").filter((pid) => {
    if (!/^\d+$/.test(pid)) return false;
    try {
      return readFileSync(join("/proc", pid, "cmdline"), "utf8")
        .split("\0")
        .includes(argument);
    } catch {
      return false;
    }
  }).length;
}

async function until<T>(read: () => T | undefined | false, what: string): Promise<T> {
  const deadline = Date.now() + STATE_TIMEOUT_MS;
  for (;;) {
    const value = read();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for: ${what}`);
    await sleep(100);
  }
}
