import { parentPort, workerData } from "node:worker_threads";
import { forkSession as claudeForkSession } from "@anthropic-ai/claude-agent-sdk";

export interface ForkSessionWorkerData {
  sessionId: string;
  upToMessageId: string;
}

export type ForkSessionWorkerResult =
  | { ok: true; sessionId: string }
  | { ok: false; error: string };

async function run(port: NonNullable<typeof parentPort>): Promise<void> {
  const { sessionId, upToMessageId } = workerData as ForkSessionWorkerData;
  try {
    const fork = await claudeForkSession(sessionId, { upToMessageId });
    port.postMessage({ ok: true, sessionId: fork.sessionId } satisfies ForkSessionWorkerResult);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    port.postMessage({ ok: false, error: message } satisfies ForkSessionWorkerResult);
  }
}

if (parentPort) {
  void run(parentPort);
}
