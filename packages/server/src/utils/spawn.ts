import { execFile, spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { extname } from "node:path";
import { promisify } from "node:util";

import { createExternalCommandProcessEnv, type ProcessEnvRecord } from "../server/paseo-env.js";
import { logSlowCommand } from "./command-logging.js";
import {
  isWindowsCommandScript,
  quoteWindowsArgument,
  quoteWindowsCommand,
} from "./windows-command.js";

const execFileAsync = promisify(execFile);

interface ExternalEnvOptions {
  baseEnv?: ProcessEnvRecord;
  envMode?: "external" | "internal";
  env?: ProcessEnvRecord;
  envOverlay?: ProcessEnvRecord;
}

export type SpawnProcessOptions = Omit<SpawnOptions, "env"> & ExternalEnvOptions;

interface ExecCommandOptions extends ExternalEnvOptions {
  cwd?: string;
  encoding?: BufferEncoding;
  killSignal?: NodeJS.Signals;
  timeout?: number;
  maxBuffer?: number;
  shell?: boolean | string;
  signal?: AbortSignal;
}

interface ExecCommandResult {
  stdout: string;
  stderr: string;
}

function hasPathSeparator(value: string): boolean {
  return value.includes("/") || value.includes("\\");
}

function shouldUseWindowsShell(
  command: string,
  requestedShell?: boolean | string,
): boolean | string {
  if (isWindowsCommandScript(command)) {
    return true;
  }
  if (requestedShell !== undefined) {
    return requestedShell;
  }
  return process.platform === "win32" && !hasPathSeparator(command) && !extname(command);
}

export function spawnProcess(
  command: string,
  args: string[],
  options?: SpawnProcessOptions,
): ChildProcess {
  const { baseEnv, env, envOverlay, ...spawnOptions } = options ?? {};
  const resolvedBaseEnv = env ?? baseEnv ?? process.env;
  const startedAt = performance.now();
  const isWindows = process.platform === "win32";
  const shell = shouldUseWindowsShell(command, spawnOptions.shell);

  const shouldQuoteForShell = isWindows && shell !== false;
  const resolvedCommand = shouldQuoteForShell ? quoteWindowsCommand(command) : command;
  const resolvedArgs = shouldQuoteForShell ? args.map(quoteWindowsArgument) : args;
  const childEnv =
    options?.envMode === "internal"
      ? ({ ...resolvedBaseEnv, ...envOverlay } as NodeJS.ProcessEnv)
      : createExternalCommandProcessEnv(
          command,
          resolvedBaseEnv,
          ...(envOverlay ? [envOverlay] : []),
        );

  const child = spawn(resolvedCommand, resolvedArgs, {
    ...spawnOptions,
    env: childEnv,
    shell,
    signal: options?.signal,
    windowsHide: true,
  });

  let logged = false;
  const logResult = (input: {
    exitCode?: number | null;
    signal?: NodeJS.Signals | null;
    error?: unknown;
  }) => {
    if (logged) {
      return;
    }
    logged = true;
    logSlowCommand({
      source: "spawn",
      command,
      args,
      cwd: options?.cwd,
      durationMs: performance.now() - startedAt,
      pid: child.pid ?? null,
      exitCode: input.exitCode,
      signal: input.signal,
      ...(input.error ? { error: input.error } : {}),
    });
  };

  child.once("error", (error) => {
    logResult({ error });
  });
  child.once("close", (exitCode, signal) => {
    logResult({
      exitCode,
      signal: typeof signal === "string" ? (signal as NodeJS.Signals) : null,
    });
  });

  return child;
}

export async function execCommand(
  command: string,
  args: string[],
  options?: ExecCommandOptions,
): Promise<ExecCommandResult> {
  const { baseEnv, env, envOverlay } = options ?? {};
  const resolvedBaseEnv = env ?? baseEnv ?? process.env;
  const startedAt = performance.now();
  const isWindows = process.platform === "win32";
  const shell = shouldUseWindowsShell(command, options?.shell);
  const shouldQuoteForShell = isWindows && shell !== false;
  const resolvedCommand = shouldQuoteForShell ? quoteWindowsCommand(command) : command;
  const resolvedArgs = shouldQuoteForShell ? args.map(quoteWindowsArgument) : args;
  const childEnv =
    options?.envMode === "internal"
      ? ({ ...resolvedBaseEnv, ...envOverlay } as NodeJS.ProcessEnv)
      : createExternalCommandProcessEnv(
          command,
          resolvedBaseEnv,
          ...(envOverlay ? [envOverlay] : []),
        );

  try {
    const result = (await execFileAsync(resolvedCommand, resolvedArgs, {
      cwd: options?.cwd,
      env: childEnv,
      encoding: options?.encoding ?? "utf8",
      killSignal: options?.killSignal,
      timeout: options?.timeout,
      maxBuffer: options?.maxBuffer,
      shell,
      windowsHide: true,
    })) as ExecCommandResult;

    logSlowCommand({
      source: "exec",
      command,
      args,
      cwd: options?.cwd,
      durationMs: performance.now() - startedAt,
    });

    return result;
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & {
      code?: number | string;
      signal?: string | null;
    };

    logSlowCommand({
      source: "exec",
      command,
      args,
      cwd: options?.cwd,
      durationMs: performance.now() - startedAt,
      exitCode: typeof execError.code === "number" ? execError.code : null,
      signal: typeof execError.signal === "string" ? (execError.signal as NodeJS.Signals) : null,
      error,
    });

    throw error;
  }
}
