import { crashReporter } from "electron";

/**
 * Keeps crash dumps in `crashDumps` on this computer. Crashpad removes old reports itself. Without
 * them, a window that disappeared on Windows left nothing to tell a crash from a quit (#2675).
 *
 * An AppImage run has no crash reporter. Crashpad's handler runs from the AppImage mount and outlives
 * OpenBot by a moment. The AppImage runtime removes that mount when OpenBot quits, so the handler
 * then dies with SIGBUS, and the desktop reports a crash on each quit (#3066).
 */
export function startCrashReporter(environment: NodeJS.ProcessEnv = process.env): void {
  if (process.platform === "linux" && environment.APPIMAGE?.trim()) return;
  crashReporter.start({ uploadToServer: false });
}
