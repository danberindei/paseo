import type pino from "pino";
import { fileURLToPath } from "node:url";

export const SLOW_COMMAND_THRESHOLD_MS = 100;

interface SlowCommandLogInput {
  source: "exec" | "spawn";
  command: string;
  args: string[];
  cwd?: string | URL | null;
  durationMs: number;
  pid?: number | null;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  error?: unknown;
}

let slowCommandLogger: pino.Logger | null = null;
let slowCommandThresholdMs = SLOW_COMMAND_THRESHOLD_MS;

export function configureSlowCommandLogger(logger: pino.Logger | null): void {
  slowCommandLogger = logger?.child({ component: "command-logging" }) ?? null;
}

export function logSlowCommand(input: SlowCommandLogInput): void {
  if (!slowCommandLogger || input.durationMs < slowCommandThresholdMs) {
    return;
  }

  slowCommandLogger.info(
    {
      source: input.source,
      command: input.command,
      args: input.args,
      commandLine: formatCommandLine(input.command, input.args),
      cwd: normalizeCwd(input.cwd),
      durationMs: roundDuration(input.durationMs),
      thresholdMs: slowCommandThresholdMs,
      pid: input.pid ?? null,
      exitCode: input.exitCode ?? null,
      signal: input.signal ?? null,
      failed: input.error != null || (input.exitCode != null && input.exitCode !== 0),
      ...(input.error
        ? {
            error: input.error instanceof Error ? input.error.message : String(input.error),
          }
        : {}),
    },
    "Slow command",
  );
}

function normalizeCwd(cwd: string | URL | null | undefined): string | null {
  if (!cwd) {
    return null;
  }
  if (cwd instanceof URL) {
    return cwd.protocol === "file:" ? fileURLToPath(cwd) : cwd.toString();
  }
  return cwd;
}

function roundDuration(durationMs: number): number {
  return Math.round(durationMs * 100) / 100;
}

function formatCommandLine(command: string, args: string[]): string {
  return [command, ...args].map(quoteArgument).join(" ");
}

function quoteArgument(value: string): string {
  if (value.length === 0) {
    return '""';
  }
  if (!/[^\w@%+=:,./-]/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

export function __resetSlowCommandLoggerForTests(): void {
  slowCommandLogger = null;
  slowCommandThresholdMs = SLOW_COMMAND_THRESHOLD_MS;
}

export function __setSlowCommandThresholdForTests(thresholdMs: number): void {
  slowCommandThresholdMs = thresholdMs;
}
