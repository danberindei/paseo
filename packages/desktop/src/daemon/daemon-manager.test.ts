import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_DESKTOP_SETTINGS } from "../settings/desktop-settings";
import { ExternalCliCommandError } from "./cli/external";
import {
  createDaemonCommandHandlers,
  keepsTerminalsOnStop,
  stopCapturedDaemon,
  type DesktopDaemonStopReason,
} from "./daemon-manager";

const mocks = vi.hoisted(() => ({
  paseoHome: "",
  settings: {
    releaseChannel: "stable",
    daemon: {
      manageBuiltInDaemon: true,
      keepRunningAfterQuit: true,
    },
  },
  runExternalCliJsonCommand: vi.fn(),
  runExternalCliTextCommand: vi.fn(),
  createNodeEntrypointInvocation: vi.fn(() => ({
    command: "node",
    args: [],
    env: {},
  })),
  startDaemonInstance: vi.fn(),
  stopDaemonInstance: vi.fn(),
  readDaemonInstance: vi.fn(),
  readDaemonInstanceReal: (home: string): Promise<unknown> => {
    throw new Error(`readDaemonInstance was not captured for ${home}`);
  },
  isSameDaemonInstance: vi.fn(),
  logInfo: vi.fn(),
  logError: vi.fn(),
  appLogPath: "",
  getElectronLogFile: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => mocks.paseoHome),
    getVersion: vi.fn(() => "1.2.3"),
    isPackaged: true,
  },
  ipcMain: { handle: vi.fn() },
  powerMonitor: { getSystemIdleTime: vi.fn(() => 0) },
}));

vi.mock("electron-log/main", () => ({
  default: {
    info: mocks.logInfo,
    error: mocks.logError,
    transports: {
      file: {
        getFile: mocks.getElectronLogFile,
      },
    },
  },
}));

vi.mock("@getpaseo/server/daemon-control", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@getpaseo/server/daemon-control")>();
  mocks.readDaemonInstanceReal = actual.readDaemonInstance;
  return {
    ...actual,
    resolvePaseoHome: () => mocks.paseoHome,
    startDaemonInstance: mocks.startDaemonInstance,
    stopDaemonInstance: mocks.stopDaemonInstance,
    readDaemonInstance: mocks.readDaemonInstance,
    isSameDaemonInstance: mocks.isSameDaemonInstance,
  };
});

vi.mock("../settings/desktop-settings-electron.js", () => ({
  getDesktopSettingsStore: () => ({
    get: async () => mocks.settings,
    patch: vi.fn(),
    migrateLegacyRendererSettings: vi.fn(),
  }),
}));

vi.mock("./runtime-paths.js", () => ({
  createNodeEntrypointInvocation: mocks.createNodeEntrypointInvocation,
  resolveDaemonRunnerEntrypoint: vi.fn(() => ({
    entryPath: path.join(mocks.paseoHome, "daemon.js"),
    execArgv: [],
  })),
}));

vi.mock("./cli/external.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  runExternalCliJsonCommand: mocks.runExternalCliJsonCommand,
  runExternalCliTextCommand: mocks.runExternalCliTextCommand,
}));

interface FakeDaemonLifecycle {
  statusCalls: number;
  startCalls: number;
  restartCalls: number;
}

function installFakeDaemonLifecycle(startGate?: Promise<void>): FakeDaemonLifecycle {
  const calls: FakeDaemonLifecycle = { statusCalls: 0, startCalls: 0, restartCalls: 0 };
  let running: { pid: number; startedAt: string; serverId: string } | null = null;

  mocks.runExternalCliJsonCommand.mockImplementation(async (args: string[]) => {
    if (args[1] === "restart") {
      calls.restartCalls += 1;
      running = {
        pid: 8000 + calls.restartCalls,
        startedAt: `restart-${calls.restartCalls}`,
        serverId: `restart-${calls.restartCalls}`,
      };
      return { action: "stopped" };
    }
    calls.statusCalls += 1;
    if (!running) {
      return { localDaemon: "stopped", connectedDaemon: "unreachable", serverId: "" };
    }
    return {
      localDaemon: "running",
      connectedDaemon: "reachable",
      serverId: running.serverId,
      pid: running.pid,
      listen: "127.0.0.1:6767",
      hostname: "dev-host",
      daemonVersion: "1.2.3",
      desktopManaged: true,
      startedAt: running.startedAt,
    };
  });
  mocks.startDaemonInstance.mockImplementation(
    async (options: { onAcquired: (instance: { pid: number; startedAt: string }) => void }) => {
      calls.startCalls += 1;
      await startGate;
      running = {
        pid: 7000 + calls.startCalls,
        startedAt: `start-${calls.startCalls}`,
        serverId: `start-${calls.startCalls}`,
      };
      options.onAcquired(running);
    },
  );
  mocks.readDaemonInstance.mockImplementation(async () => running);
  mocks.isSameDaemonInstance.mockImplementation(
    (first: { pid: number; startedAt: string }, second: { pid: number; startedAt: string }) =>
      first.pid === second.pid && first.startedAt === second.startedAt,
  );

  return calls;
}

describe("daemon-manager commands", () => {
  let fixtureRoot: string;

  beforeEach(() => {
    fixtureRoot = mkdtempSync(path.join(tmpdir(), "paseo daemon manager "));
    mocks.paseoHome = path.join(fixtureRoot, "home");
    mocks.appLogPath = path.join(fixtureRoot, "main.log");
    mocks.settings = DEFAULT_DESKTOP_SETTINGS;
    mocks.runExternalCliJsonCommand.mockReset();
    mocks.runExternalCliTextCommand.mockReset();
    mocks.createNodeEntrypointInvocation.mockReset();
    mocks.createNodeEntrypointInvocation.mockReturnValue({ command: "node", args: [], env: {} });
    mocks.startDaemonInstance.mockReset();
    mocks.stopDaemonInstance.mockReset();
    mocks.readDaemonInstance.mockReset();
    mocks.readDaemonInstance.mockImplementation(mocks.readDaemonInstanceReal);
    mocks.isSameDaemonInstance.mockReset();
    mocks.logInfo.mockReset();
    mocks.logError.mockReset();
    mocks.getElectronLogFile.mockReset();
    mocks.getElectronLogFile.mockReturnValue({ path: mocks.appLogPath });
  });

  afterEach(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it("starts once when two renderer windows request a start at the same time", async () => {
    const lifecycle = installFakeDaemonLifecycle();
    const windowA = createDaemonCommandHandlers();
    const windowB = createDaemonCommandHandlers();

    const [first, second] = await Promise.all([
      windowA.start_desktop_daemon(),
      windowB.start_desktop_daemon(),
    ]);

    expect(first).toEqual(
      expect.objectContaining({ status: "running", serverId: "start-1", version: "1.2.3" }),
    );
    expect(second).toBe(first);
    expect(lifecycle.startCalls).toBe(1);
  });

  it("re-checks the daemon for a start requested after the first start finished", async () => {
    const lifecycle = installFakeDaemonLifecycle();

    const first = await createDaemonCommandHandlers().start_desktop_daemon();
    const statusCallsAfterFirst = lifecycle.statusCalls;
    const second = await createDaemonCommandHandlers().start_desktop_daemon();

    expect(second).not.toBe(first);
    expect(second).toEqual(first);
    expect(lifecycle.statusCalls).toBeGreaterThan(statusCallsAfterFirst);
    expect(lifecycle.startCalls).toBe(1);
  });

  it("retries a failed start for the next window instead of replaying the failure", async () => {
    mocks.runExternalCliJsonCommand.mockResolvedValue({
      localDaemon: "stopped",
      connectedDaemon: "unreachable",
      serverId: "",
    });
    mocks.startDaemonInstance.mockRejectedValue(new Error("start failed"));

    await expect(createDaemonCommandHandlers().start_desktop_daemon()).rejects.toThrow(
      "start failed",
    );
    await expect(createDaemonCommandHandlers().start_desktop_daemon()).rejects.toThrow(
      "start failed",
    );

    expect(mocks.startDaemonInstance).toHaveBeenCalledTimes(2);
  });

  it("does not let a restart join an in-flight start", async () => {
    let releaseStart: () => void = () => {};
    const startGate = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    const lifecycle = installFakeDaemonLifecycle(startGate);
    const windowA = createDaemonCommandHandlers();
    const windowB = createDaemonCommandHandlers();

    const start = windowA.start_desktop_daemon();
    await vi.waitFor(() => expect(lifecycle.startCalls).toBe(1));
    const restart = windowB.restart_desktop_daemon();
    await Promise.resolve();
    expect(lifecycle.restartCalls).toBe(0);
    releaseStart();
    const [started, restarted] = await Promise.all([start, restart]);

    expect(started).toEqual(expect.objectContaining({ serverId: "start-1" }));
    expect(restarted).toEqual(expect.objectContaining({ serverId: "restart-1" }));
    expect(lifecycle.startCalls).toBe(1);
    expect(lifecycle.restartCalls).toBe(1);
  });

  it("returns the Electron main-process log tail from electron-log", () => {
    writeFileSync(
      mocks.appLogPath,
      Array.from({ length: 105 }, (_value, index) => `main log line ${index + 1}`).join("\n"),
    );
    const handlers = createDaemonCommandHandlers();

    expect(handlers.desktop_app_logs()).toEqual({
      logPath: mocks.appLogPath,
      contents: Array.from({ length: 100 }, (_value, index) => `main log line ${index + 6}`).join(
        "\n",
      ),
    });
  });

  it("exposes updater diagnostics through the desktop command boundary", () => {
    const diagnostics = createDaemonCommandHandlers().desktop_update_diagnostics();

    expect(diagnostics).toMatchObject({
      platform: process.platform,
      currentVersion: "1.2.3",
    });
  });

  it("reports a stopped daemon without launching the CLI when no local daemon runs", async () => {
    mkdirSync(mocks.paseoHome);
    writeFileSync(path.join(mocks.paseoHome, "server-id"), "srv_existing\n");
    mocks.runExternalCliJsonCommand.mockResolvedValue({
      home: mocks.paseoHome,
      pid: null,
      startedAt: null,
      listen: null,
      hostname: null,
      localDaemon: "stopped",
      desktopManaged: false,
      connectedDaemon: "not_probed",
    });

    const status = await createDaemonCommandHandlers().desktop_daemon_status();

    expect(status).toMatchObject({ serverId: "", status: "stopped", pid: null });
    expect(mocks.runExternalCliJsonCommand).not.toHaveBeenCalled();
  });

  it("reports an errored daemon when the local daemon state cannot be read", async () => {
    mkdirSync(mocks.paseoHome);
    writeFileSync(path.join(mocks.paseoHome, "paseo.pid"), "garbage");

    const status = await createDaemonCommandHandlers().desktop_daemon_status();

    expect(status).toMatchObject({ serverId: "", status: "errored", pid: null });
    expect(status.error).toBeTruthy();
  });

  it("returns a local credential only for its live managed daemon listen", async () => {
    mkdirSync(mocks.paseoHome);
    const token = "a".repeat(43);
    writeFileSync(path.join(mocks.paseoHome, "local-credential"), `${token}\n`, { mode: 0o600 });
    const lock = {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      hostname: hostname(),
      uid: process.getuid?.() ?? 0,
      listen: "127.0.0.1:6799",
      desktopManaged: true,
    };
    const lockPath = path.join(mocks.paseoHome, "paseo.pid");
    writeFileSync(lockPath, JSON.stringify(lock));
    const handler = createDaemonCommandHandlers().desktop_local_credential;
    expect(await handler({ listen: "localhost:6799" })).toBe(token);
    expect(await handler({ listen: "remote:6799" })).toBeNull();
    writeFileSync(lockPath, JSON.stringify({ ...lock, desktopManaged: false }));
    expect(await handler({ listen: "localhost:6799" })).toBeNull();
  });
});

describe("desktop stops and terminals", () => {
  const reasons: DesktopDaemonStopReason[] = [
    "manual_ipc",
    "settings",
    "host_remove",
    "quit",
    "app_update",
    "version_mismatch",
    "restart",
  ];

  it("keeps terminals only for an app update or version-mismatch restart, never on Windows", () => {
    for (const platform of ["darwin", "linux"] as const) {
      expect(reasons.filter((reason) => keepsTerminalsOnStop(reason, platform))).toEqual([
        "app_update",
        "version_mismatch",
      ]);
    }
    expect(reasons.filter((reason) => keepsTerminalsOnStop(reason, "win32"))).toEqual([]);
  });

  function stopHarness(runCliJson: (args: string[]) => Promise<unknown>) {
    const stops: Array<{ keepTerminals: boolean | undefined }> = [];
    const logged: string[] = [];
    const instance = {
      pid: 4242,
      startedAt: "2026-10-21T00:00:00.000Z",
      hostname: "host",
      uid: 501,
      listen: "127.0.0.1:6799",
    };
    const stopInstance = (async (
      _home: string,
      options: {
        keepTerminals?: boolean;
        requestShutdown?: (ready: { listen: string }) => Promise<void>;
      },
    ) => {
      stops.push({ keepTerminals: options.keepTerminals });
      await options.requestShutdown?.({ listen: instance.listen });
      return { action: "stopped", pid: instance.pid, forced: false, usedLifecycleRpc: true };
    }) as unknown as NonNullable<Parameters<typeof stopCapturedDaemon>[0]["stopInstance"]>;
    return {
      stops,
      logged,
      input: {
        home: "/tmp/paseo-home",
        instance,
        stopInstance,
        runCliJson,
        log: (message: string) => logged.push(message),
      } as Omit<Parameters<typeof stopCapturedDaemon>[0], "reason" | "keepTerminals">,
    };
  }

  it("asks the daemon to keep its terminals on an app update", async () => {
    const calls: string[][] = [];
    const harness = stopHarness(async (args) => {
      calls.push(args);
      return { action: "shutdown_requested" };
    });

    await stopCapturedDaemon({ ...harness.input, reason: "app_update", keepTerminals: true });

    expect(harness.stops).toEqual([{ keepTerminals: true }]);
    expect(calls).toEqual([
      ["daemon", "stop", "--host", "127.0.0.1:6799", "--keep-terminals", "--json"],
    ]);
  });

  it("stops a daemon without the capability with its terminals closed, and says so", async () => {
    const calls: string[][] = [];
    const harness = stopHarness(async (args) => {
      calls.push(args);
      if (args.includes("--keep-terminals")) {
        throw new ExternalCliCommandError("refused", {
          code: "TERMINALS_KEEP_UNSUPPORTED",
          version: "0.11.0",
        });
      }
      return { action: "shutdown_requested" };
    });

    await stopCapturedDaemon({ ...harness.input, reason: "app_update", keepTerminals: true });

    expect(harness.stops).toEqual([{ keepTerminals: true }, { keepTerminals: false }]);
    expect(calls[1]).toEqual(["daemon", "stop", "--host", "127.0.0.1:6799", "--json"]);
    expect(harness.logged).toContain(
      "daemon v0.11.0 cannot keep terminals; stopping it and closing them",
    );
  });

  it("does not retry a keep stop that failed for another reason", async () => {
    const harness = stopHarness(async () => {
      throw new ExternalCliCommandError("unreachable", { code: "DAEMON_UNREACHABLE" });
    });

    await expect(
      stopCapturedDaemon({ ...harness.input, reason: "app_update", keepTerminals: true }),
    ).rejects.toThrow("unreachable");
    expect(harness.stops).toEqual([{ keepTerminals: true }]);
  });
});
