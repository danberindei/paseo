import type { ChildProcess, SpawnOptions } from "node:child_process";
import { spawnProcess as spawnCli, execCommand as execCli } from "@getpaseo/plugin/server";
import { createExternalCommandProcessEnv, type ProcessEnvRecord } from "../server/paseo-env.js";
import { logSlowCommand } from "./command-logging.js";

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

interface ExecCommandFailure {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export function spawnProcess(
  command: string,
  args: string[],
  options?: SpawnProcessOptions,
): ChildProcess {
  const { baseEnv, env, envOverlay, ...spawnOptions } = options ?? {};
  const resolvedBaseEnv = env ?? baseEnv ?? process.env;
  const startedAt = performance.now();
  const childEnv =
    options?.envMode === "internal"
      ? ({ ...resolvedBaseEnv, ...envOverlay } as NodeJS.ProcessEnv)
      : createExternalCommandProcessEnv(
          command,
          resolvedBaseEnv,
          ...(envOverlay ? [envOverlay] : []),
        );

  const child = spawnCli(command, args, {
    ...spawnOptions,
    env: childEnv,
    signal: options?.signal,
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

function parseExecCommandFailure(error: unknown): ExecCommandFailure {
  const execError = error as NodeJS.ErrnoException & {
    code?: number | string;
    signal?: string | null;
  };
  return {
    exitCode: typeof execError.code === "number" ? execError.code : null,
    signal: typeof execError.signal === "string" ? (execError.signal as NodeJS.Signals) : null,
  };
}

export async function execCommand(
  command: string,
  args: string[],
  options?: ExecCommandOptions,
): Promise<ExecCommandResult> {
  const { baseEnv, env, envOverlay } = options ?? {};
  const resolvedBaseEnv = env ?? baseEnv ?? process.env;
  const startedAt = performance.now();
  const childEnv =
    options?.envMode === "internal"
      ? ({ ...resolvedBaseEnv, ...envOverlay } as NodeJS.ProcessEnv)
      : createExternalCommandProcessEnv(
          command,
          resolvedBaseEnv,
          ...(envOverlay ? [envOverlay] : []),
        );

  try {
    const result = (await execCli(command, args, {
      cwd: options?.cwd,
      env: childEnv,
      shell: options?.shell,
      encoding: options?.encoding ?? "utf8",
      signal: options?.signal,
      killSignal: options?.killSignal,
      timeout: options?.timeout,
      maxBuffer: options?.maxBuffer,
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
    const failure = parseExecCommandFailure(error);

    logSlowCommand({
      source: "exec",
      command,
      args,
      cwd: options?.cwd,
      durationMs: performance.now() - startedAt,
      exitCode: failure.exitCode,
      signal: failure.signal,
      error,
    });

    throw error;
  }
}
