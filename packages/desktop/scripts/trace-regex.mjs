#!/usr/bin/env node
// Inject a RegExp.prototype.test/exec wrapper into the packaged renderer via CDP.
// Launch the app with --remote-debugging-port=9222 first, then run this BEFORE
// clicking the suspected freeze-triggering workspace. The wrapper logs big or
// slow regex calls to the renderer console — visible in Paseo.bin's stderr.
//
// Usage:
//   node packages/desktop/scripts/trace-regex.mjs [--port 9222]
//       [--min-input 5000] [--min-ms 50] [--stack-every 0]
//
// --stack-every N sends a stack trace every Nth intercepted call so you can
// pin the JS caller of a regex that is fast per-call but invoked in a storm.

import http from "node:http";
import WSClient from "ws";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .flatMap((a, i, arr) => (a.startsWith("--") ? [[a.slice(2), arr[i + 1]]] : [])),
);
const port = Number(args.port ?? 9222);
const minInput = Number(args["min-input"] ?? 500);
const minMs = Number(args["min-ms"] ?? 10);
const stackEvery = Number(args["stack-every"] ?? 0);

const targets = await new Promise((resolve, reject) => {
  http
    .get({ host: "127.0.0.1", port, path: "/json" }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve(JSON.parse(body)));
    })
    .on("error", reject);
});

const renderer =
  targets.find(
    (t) =>
      t.type === "page" &&
      typeof t.url === "string" &&
      !t.url.startsWith("devtools://") &&
      !t.url.startsWith("chrome-extension://"),
  ) ?? targets.find((t) => t.type === "page");
if (!renderer) {
  console.error("No page target on port", port);
  process.exit(1);
}
console.log("Attaching to:", renderer.url);

const ws = new WSClient(renderer.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.id !== undefined) {
    const p = pending.get(msg.id);
    if (p) {
      pending.delete(msg.id);
      if (msg.error) {
        p.reject(new Error(msg.error.message));
      } else {
        p.resolve(msg.result);
      }
    }
    return;
  }
  if (msg.method === "Runtime.consoleAPICalled") {
    const parts = (msg.params.args ?? []).map((a) =>
      a.value !== undefined ? a.value : (a.description ?? a.type),
    );
    const line = parts.join(" ");
    if (line.startsWith("R[") || msg.params.type === "error") {
      process.stdout.write(line + "\n");
    }
  }
  if (msg.method === "Runtime.exceptionThrown") {
    console.error("RendererException:", msg.params.exceptionDetails?.text);
  }
});
const send = (method, params) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

await new Promise((r) => ws.once("open", r));
await send("Runtime.enable");
await send("Page.enable");

const expression = `
(() => {
  if (globalThis.__regexTraceInstalled) return "already installed";
  globalThis.__regexTraceInstalled = true;
  const MIN_INPUT = ${minInput};
  const MIN_MS = ${minMs};
  const STACK_EVERY = ${stackEvery};
  const oT = RegExp.prototype.test;
  const oE = RegExp.prototype.exec;
  let seq = 0;
  const stats = new Map();
  globalThis.__regexStats = () =>
    [...stats.entries()]
      .map(([k, v]) => ({ pattern: k, ...v }))
      .sort((a, b) => b.t - a.t)
      .slice(0, 30);
  const bump = (re, dt, len) => {
    const k = String(re).slice(0, 200);
    let s = stats.get(k);
    if (!s) stats.set(k, (s = { n: 0, t: 0, maxT: 0, maxLen: 0 }));
    s.n++;
    s.t += dt;
    if (dt > s.maxT) s.maxT = dt;
    if (len > s.maxLen) s.maxLen = len;
  };
  const wrap = (name, orig) =>
    function (s) {
      const id = ++seq;
      const len = typeof s === "string" ? s.length : 0;
      const src = String(this).slice(0, 120);
      if (len > MIN_INPUT) {
        console.log("R[" + id + "] " + name + " BIG len=" + len + " " + src);
      }
      if (STACK_EVERY > 0 && id % STACK_EVERY === 0) {
        const stack = new Error().stack;
        console.log("R[" + id + "] " + name + " STACK " + src + "\\n" + stack);
      }
      const t0 = performance.now();
      const r = orig.call(this, s);
      const dt = performance.now() - t0;
      bump(this, dt, len);
      if (dt > MIN_MS) {
        console.log(
          "R[" + id + "] " + name + " SLOW dt=" + dt.toFixed(0) + "ms len=" + len + " " + src,
        );
      }
      return r;
    };
  RegExp.prototype.test = wrap("test", oT);
  RegExp.prototype.exec = wrap("exec", oE);
  return "regex-trace installed (MIN_INPUT=" + MIN_INPUT + " MIN_MS=" + MIN_MS + ")";
})()
`;

const { result } = await send("Runtime.evaluate", {
  expression,
  returnByValue: true,
  awaitPromise: false,
});
console.log("Injection result:", result.value ?? result);

await send("Page.addScriptToEvaluateOnNewDocument", {
  source: expression,
});
console.log("Persisted across navigations via Page.addScriptToEvaluateOnNewDocument");

console.log(
  "\nNow click the suspected workspace. Watch Paseo.bin stderr for R[...] BIG/SLOW lines.",
);
console.log("When you want to dump stats (if main thread is responsive), Ctrl+C.");

const dump = async () => {
  try {
    const { result: statsResult } = await send("Runtime.evaluate", {
      expression: "JSON.stringify(globalThis.__regexStats(), null, 2)",
      returnByValue: true,
      awaitPromise: false,
    });
    console.log("\n=== Top regex call sites by cumulative time ===");
    console.log(statsResult.value);
  } catch (e) {
    console.error("Stats dump failed (main thread likely stuck):", e.message);
  } finally {
    ws.close();
    process.exit(0);
  }
};
process.on("SIGINT", dump);
process.on("SIGTERM", dump);
