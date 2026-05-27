import { describe, it } from "vitest";

import type { AgentStreamEventPayload } from "@getpaseo/protocol/messages";

import { hydrateStreamState } from "./stream";

interface TimedEvent {
  event: AgentStreamEventPayload;
  timestamp: Date;
}

const baseTime = Date.UTC(2025, 0, 1, 0, 0, 0);

function ts(offsetMs: number): Date {
  return new Date(baseTime + offsetMs);
}

function assistantDelta(text: string, offsetMs: number): TimedEvent {
  return {
    event: {
      type: "timeline",
      provider: "claude",
      item: { type: "assistant_message", text },
    },
    timestamp: ts(offsetMs),
  };
}

function userMessage(text: string, offsetMs: number): TimedEvent {
  return {
    event: {
      type: "timeline",
      provider: "claude",
      item: { type: "user_message", text, messageId: `u-${offsetMs}` },
    },
    timestamp: ts(offsetMs),
  };
}

function turnCompleted(offsetMs: number): TimedEvent {
  return {
    event: { type: "turn_completed", provider: "claude" },
    timestamp: ts(offsetMs),
  };
}

function measure(label: string, fn: () => unknown): number {
  const t0 = performance.now();
  fn();
  const dt = performance.now() - t0;
  // biome-ignore lint/suspicious/noConsole: perf test diagnostic
  console.log(`${label}: ${dt.toFixed(1)} ms`);
  return dt;
}

function generateStreamingResponse(chunkCount: number, chunkSize = 20): TimedEvent[] {
  const filler = "x".repeat(chunkSize);
  const events: TimedEvent[] = [userMessage("hello", 0)];
  for (let i = 0; i < chunkCount; i++) {
    events.push(assistantDelta(filler, i + 1));
  }
  events.push(turnCompleted(chunkCount + 1));
  return events;
}

function generateConversation(turnCount: number, chunksPerTurn = 50, chunkSize = 20): TimedEvent[] {
  const events: TimedEvent[] = [];
  let offset = 0;
  for (let t = 0; t < turnCount; t++) {
    events.push(userMessage(`user turn ${t}`, offset++));
    for (let i = 0; i < chunksPerTurn; i++) {
      events.push(assistantDelta("x".repeat(chunkSize), offset++));
    }
    events.push(turnCompleted(offset++));
  }
  return events;
}

function ratio(actual: number, expected: number): string {
  return `${(actual / expected).toFixed(2)}x expected`;
}

describe("hydrateStreamState scaling", () => {
  it("one long streamed assistant response at N = 500 / 1000 / 2000 / 4000 chunks", () => {
    const sizes = [500, 1000, 2000, 4000];
    const times: number[] = [];
    for (const n of sizes) {
      const events = generateStreamingResponse(n);
      const t = measure(`streamed N=${n}`, () => hydrateStreamState(events));
      times.push(t);
    }
    const linearTargets = times.map((_, i) => (times[0] * sizes[i]) / sizes[0]);
    for (let i = 0; i < sizes.length; i++) {
      // biome-ignore lint/suspicious/noConsole: perf test diagnostic
      console.log(
        `  N=${sizes[i]} observed=${times[i].toFixed(1)}ms linear-expected=${linearTargets[i].toFixed(1)}ms (${ratio(times[i], linearTargets[i])})`,
      );
    }
  });

  it("long conversation at N = 100 / 200 / 400 / 800 / 1600 / 3200 turns", () => {
    const sizes = [100, 200, 400, 800, 1600, 3200];
    const times: number[] = [];
    for (const n of sizes) {
      const events = generateConversation(n);
      const t = measure(`conversation turns=${n}`, () => hydrateStreamState(events));
      times.push(t);
    }
    const linearTargets = times.map((_, i) => (times[0] * sizes[i]) / sizes[0]);
    for (let i = 0; i < sizes.length; i++) {
      // biome-ignore lint/suspicious/noConsole: perf test diagnostic
      console.log(
        `  turns=${sizes[i]} observed=${times[i].toFixed(1)}ms linear-expected=${linearTargets[i].toFixed(1)}ms (${ratio(times[i], linearTargets[i])})`,
      );
    }
  });

  it("hydrates 27 parallel agents once each (jurnify-customer-ui shape)", () => {
    const AGENTS = 27;
    const TURNS_PER_AGENT = 50;
    const events = generateConversation(TURNS_PER_AGENT);
    measure(`27 × hydrate turns=${TURNS_PER_AGENT}`, () => {
      for (let a = 0; a < AGENTS; a++) {
        hydrateStreamState(events);
      }
    });
  });
});
