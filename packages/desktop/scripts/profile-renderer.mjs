#!/usr/bin/env node
// Capture a renderer CPU profile from a running Electron app via CDP.
// Usage:
//   1) Launch the app with:
//        PASEO_ELECTRON_FLAGS='--remote-debugging-port=9222' paseo-desktop
//      (main.ts reads PASEO_ELECTRON_FLAGS and forwards each token through
//      app.commandLine.appendSwitch. Passing Chromium switches directly on
//      argv conflicts with the CLI-passthrough detector in node-entrypoint-launcher.)
//   2) node profile-renderer.mjs [--port 9222] [--out /tmp/renderer.cpuprofile]
//      Starts profiling immediately, press Ctrl+C to stop and save.

import { writeFileSync } from "node:fs";
import http from "node:http";
import WSClient from "ws";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .flatMap((a, i, arr) => (a.startsWith("--") ? [[a.slice(2), arr[i + 1]]] : [])),
);
const port = Number(args.port ?? 9222);
const out = args.out ?? `/tmp/renderer-${Date.now()}.cpuprofile`;

const targets = await new Promise((resolve, reject) => {
  http
    .get({ host: "127.0.0.1", port, path: "/json" }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve(JSON.parse(body)));
    })
    .on("error", reject);
});

const wantMain = args.target === "main";
const renderer = wantMain
  ? targets.find((t) => t.type === "node")
  : (targets.find(
      (t) =>
        t.type === "page" &&
        typeof t.url === "string" &&
        !t.url.startsWith("devtools://") &&
        !t.url.startsWith("chrome-extension://"),
    ) ?? targets.find((t) => t.type === "page"));
if (!renderer) {
  console.error("No CDP targets found on port", port);
  process.exit(1);
}
console.log("Attaching to:", renderer.url);

const ws = new WSClient(renderer.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  const p = pending.get(msg.id);
  if (p) {
    pending.delete(msg.id);
    if (msg.error) {
      p.reject(new Error(msg.error.message));
    } else {
      p.resolve(msg.result);
    }
  }
});
const send = (method, params) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

await new Promise((r) => ws.once("open", r));
await send("Profiler.enable");
await send("Profiler.setSamplingInterval", { interval: 1000 });
await send("Profiler.start");
console.log("Profiling started. Reproduce the freeze, then press Ctrl+C.");

const stop = async () => {
  try {
    const { profile } = await send("Profiler.stop");
    writeFileSync(out, JSON.stringify(profile));
    console.log("Wrote profile to", out);
  } catch (e) {
    console.error("Failed to stop/write profile:", e);
  } finally {
    ws.close();
    process.exit(0);
  }
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.on("SIGHUP", () => {});
