import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { forkSession as claudeForkSession, type Query } from "@anthropic-ai/claude-agent-sdk";
import type { ForkSessionWorkerData, ForkSessionWorkerResult } from "./fork-session-worker.js";

export interface ClaudeRewindSdk {
  forkSession(
    sessionId: string,
    options: { upToMessageId: string; configDir?: string },
  ): Promise<{ sessionId: string }>;
}

function resolveForkSessionWorkerEntry(): string {
  const candidates = ["./fork-session-worker.js", "./fork-session-worker.ts"].map((relative) =>
    fileURLToPath(new URL(relative, import.meta.url)),
  );
  const entry = candidates.find((candidate) => existsSync(candidate));
  if (!entry) {
    throw new Error(`fork-session-worker entry not found: ${candidates.join(", ")}`);
  }
  return entry;
}

// The Claude SDK resolves the session transcript directory from
// process.env.CLAUDE_CONFIG_DIR at call time. A custom provider can point the
// rewind at a different config dir, so we run the fork in a worker thread with
// an isolated env instead of mutating the daemon's process.env, which would
// race every other SDK call that reads the same variable.
function forkSessionInWorker(
  sessionId: string,
  options: { upToMessageId: string; configDir: string },
): Promise<{ sessionId: string }> {
  const entry = resolveForkSessionWorkerEntry();
  const execArgv = entry.endsWith(".ts") ? ["--import", "tsx"] : undefined;
  const workerData: ForkSessionWorkerData = {
    sessionId,
    upToMessageId: options.upToMessageId,
  };
  return new Promise((resolve, reject) => {
    const worker = new Worker(entry, {
      execArgv,
      workerData,
      env: { ...process.env, CLAUDE_CONFIG_DIR: options.configDir },
    });
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      action();
      void worker.terminate();
    };
    worker.once("message", (message: ForkSessionWorkerResult) => {
      finish(() => {
        if (message.ok) {
          resolve({ sessionId: message.sessionId });
        } else {
          reject(new Error(message.error));
        }
      });
    });
    worker.once("error", (error) => {
      finish(() => reject(error));
    });
    worker.once("exit", (code) => {
      if (settled) return;
      settled = true;
      reject(new Error(`fork-session-worker exited with code ${code}`));
    });
  });
}

async function forkSessionWithConfigDir(
  sessionId: string,
  options: { upToMessageId: string; configDir?: string },
): Promise<{ sessionId: string }> {
  const { configDir, ...sdkOptions } = options;
  const daemonConfigDir = process.env.CLAUDE_CONFIG_DIR;
  if (configDir === undefined || configDir === daemonConfigDir) {
    return claudeForkSession(sessionId, sdkOptions);
  }
  return forkSessionInWorker(sessionId, { upToMessageId: sdkOptions.upToMessageId, configDir });
}

export const realClaudeRewindSdk: ClaudeRewindSdk = {
  forkSession: forkSessionWithConfigDir,
};

export async function revertClaudeConversation(input: {
  sdk: ClaudeRewindSdk;
  sessionId: string | null;
  messageId: string;
  resolveMessageId?: (messageId: string) => string | Promise<string>;
  setSessionId: (sessionId: string) => void;
  configDir?: string;
}): Promise<void> {
  if (!input.sessionId) {
    throw new Error("Claude session is not ready for rewind");
  }
  const messageId = (await input.resolveMessageId?.(input.messageId)) ?? input.messageId;
  const fork = await input.sdk.forkSession(input.sessionId, {
    upToMessageId: messageId,
    configDir: input.configDir,
  });
  input.setSessionId(fork.sessionId);
}

export async function revertClaudeFiles(input: {
  query: Query;
  messageId: string;
  resolveMessageId?: (messageId: string) => string | Promise<string>;
}): Promise<void> {
  const messageId = (await input.resolveMessageId?.(input.messageId)) ?? input.messageId;
  const result = await input.query.rewindFiles(messageId, { dryRun: false });
  if (!result.canRewind) {
    throw new Error(result.error ?? `No file checkpoint found for message ${messageId}`);
  }
}

export async function revertClaudeConversationAndFiles(input: {
  sdk: ClaudeRewindSdk;
  query: Query;
  sessionId: string | null;
  messageId: string;
  resolveMessageId?: (messageId: string) => string | Promise<string>;
  setSessionId: (sessionId: string) => void;
  configDir?: string;
}): Promise<void> {
  await revertClaudeFiles({
    query: input.query,
    messageId: input.messageId,
    resolveMessageId: input.resolveMessageId,
  });
  await revertClaudeConversation(input);
}
