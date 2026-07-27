import { EventEmitter } from "node:events";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_DESKTOP_SETTINGS } from "../settings/desktop-settings";
import { getBundledCliShimPath } from "../integrations/cli-install";
import { createDaemonCommandHandlers } from "./daemon-manager";

const mocks = vi.hoisted(() => ({
  paseoHome: "/tmp/paseo-desktop-daemon-manager-test-home",
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
  spawnProcess: vi.fn(),
  logInfo: vi.fn(),
  logError: vi.fn(),
  appLogPath: "/tmp/paseo-desktop-daemon-manager-test-main.log",
  getElectronLogFile: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp/paseo-user-data"),
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

vi.mock("@getpaseo/server", () => ({
  resolvePaseoHome: vi.fn(() => mocks.paseoHome),
  spawnProcess: mocks.spawnProcess,
}));

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
    entryPath: "/tmp/daemon.js",
    execArgv: [],
  })),
}));

vi.mock("./cli/external.js", () => ({
  runExternalCliJsonCommand: mocks.runExternalCliJsonCommand,
  runExternalCliTextCommand: mocks.runExternalCliTextCommand,
}));

function desktopSettingsWithManagement(enabled: boolean) {
  return {
    ...DEFAULT_DESKTOP_SETTINGS,
    daemon: {
      ...DEFAULT_DESKTOP_SETTINGS.daemon,
      manageBuiltInDaemon: enabled,
    },
  };
}

type MockChildProcess = EventEmitter & {
  pid: number;
  spawnfile: string;
  spawnargs: string[];
  unref: ReturnType<typeof vi.fn>;
};

function createMockChildProcess(): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess;
  child.pid = 1234;
  child.spawnfile = "node";
  child.spawnargs = ["node", "daemon.js"];
  child.unref = vi.fn();
  return child;
}

function scheduleFailedStartup(child: MockChildProcess): void {
  setImmediate(() => {
    child.emit("exit", 1, null);
  });
}

interface FakeDaemonCli {
  statusCalls: number;
  stopCalls: number;
  spawnCalls: number;
}

// A daemon lifecycle that answers from recorded state rather than a fixed queue of
// responses, so a duplicated start sequence shows up as extra stops and spawns instead of
// running out of responses. The daemon already running is one version behind the app, so a
// start has to stop it and spawn a replacement.
function installFakeDaemonCli(): FakeDaemonCli {
  const calls: FakeDaemonCli = { statusCalls: 0, stopCalls: 0, spawnCalls: 0 };
  let running: { serverId: string; version: string } | null = {
    serverId: "server-1",
    version: "1.2.2",
  };

  mocks.runExternalCliJsonCommand.mockImplementation(async (args: string[]) => {
    if (args[1] === "stop") {
      calls.stopCalls += 1;
      running = null;
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
      pid: 7675,
      listen: "127.0.0.1:6767",
      hostname: "dev-host",
      daemonVersion: running.version,
      desktopManaged: true,
    };
  });
  mocks.spawnProcess.mockImplementation(() => {
    calls.spawnCalls += 1;
    running = { serverId: `server-${calls.spawnCalls + 1}`, version: "1.2.3" };
    return createMockChildProcess();
  });

  return calls;
}

describe("daemon-manager commands", () => {
  beforeEach(() => {
    mocks.settings = DEFAULT_DESKTOP_SETTINGS;
    mocks.runExternalCliJsonCommand.mockReset();
    mocks.runExternalCliTextCommand.mockReset();
    mocks.createNodeEntrypointInvocation.mockReset();
    mocks.createNodeEntrypointInvocation.mockReturnValue({ command: "node", args: [], env: {} });
    mocks.spawnProcess.mockReset();
    mocks.logInfo.mockReset();
    mocks.logError.mockReset();
    mocks.getElectronLogFile.mockReset();
    mocks.getElectronLogFile.mockReturnValue({ path: mocks.appLogPath });
    rmSync(mocks.paseoHome, { recursive: true, force: true });
    rmSync(mocks.appLogPath, { force: true });
  });

  afterEach(() => {
    rmSync(mocks.paseoHome, { recursive: true, force: true });
    rmSync(mocks.appLogPath, { force: true });
  });

  it("refuses start and restart while built-in daemon management is disabled", async () => {
    mocks.settings = desktopSettingsWithManagement(false);
    const handlers = createDaemonCommandHandlers();

    await expect(handlers.start_desktop_daemon()).rejects.toThrow(
      "Built-in daemon management is disabled.",
    );
    await expect(handlers.restart_desktop_daemon()).rejects.toThrow(
      "Built-in daemon management is disabled.",
    );

    expect(mocks.runExternalCliJsonCommand).not.toHaveBeenCalled();
    expect(mocks.spawnProcess).not.toHaveBeenCalled();
  });

  it("keeps stop callable while built-in daemon management is disabled", async () => {
    mocks.settings = desktopSettingsWithManagement(false);
    mocks.runExternalCliJsonCommand.mockResolvedValue({
      localDaemon: "stopped",
      serverId: "",
    });
    const handlers = createDaemonCommandHandlers();

    await expect(handlers.stop_desktop_daemon()).resolves.toEqual({
      serverId: "",
      status: "stopped",
      listen: null,
      hostname: null,
      pid: null,
      home: mocks.paseoHome,
      version: null,
      desktopManaged: false,
      error: null,
    });

    expect(mocks.runExternalCliJsonCommand).toHaveBeenCalledWith(["daemon", "status", "--json"]);
  });

  it("routes running desktop daemon stops through external CLI daemon stop", async () => {
    mocks.runExternalCliJsonCommand
      .mockResolvedValueOnce({
        localDaemon: "running",
        serverId: "server-1",
        pid: 4242,
        listen: "127.0.0.1:6767",
        desktopManaged: true,
      })
      .mockResolvedValueOnce({ action: "stopped" })
      .mockResolvedValueOnce({
        localDaemon: "stopped",
        serverId: "",
      });
    const handlers = createDaemonCommandHandlers();

    await expect(handlers.stop_desktop_daemon()).resolves.toEqual({
      serverId: "",
      status: "stopped",
      listen: null,
      hostname: null,
      pid: null,
      home: mocks.paseoHome,
      version: null,
      desktopManaged: false,
      error: null,
    });

    expect(mocks.runExternalCliJsonCommand).toHaveBeenNthCalledWith(1, [
      "daemon",
      "status",
      "--json",
    ]);
    expect(mocks.runExternalCliJsonCommand).toHaveBeenNthCalledWith(2, [
      "daemon",
      "stop",
      "--json",
      "--timeout",
      "5",
      "--force",
      "--kill-timeout",
      "5",
    ]);
    expect(mocks.runExternalCliJsonCommand).toHaveBeenNthCalledWith(3, [
      "daemon",
      "status",
      "--json",
    ]);
    expect(mocks.logInfo).toHaveBeenCalledWith(
      "[desktop daemon]",
      "desktop daemon stop requested",
      expect.objectContaining({
        reason: "manual_ipc",
        statusBefore: expect.objectContaining({
          status: "running",
          pid: 4242,
          serverId: "server-1",
          desktopManaged: true,
        }),
      }),
    );
    expect(mocks.logInfo).toHaveBeenCalledWith(
      "[desktop daemon]",
      "desktop daemon stop completed",
      expect.objectContaining({
        reason: "manual_ipc",
        cliResult: { action: "stopped" },
        statusAfter: expect.objectContaining({
          status: "stopped",
          serverId: null,
        }),
      }),
    );
  });

  it("routes stale reachable desktop daemon stops through external CLI daemon stop", async () => {
    mocks.runExternalCliJsonCommand
      .mockResolvedValueOnce({
        localDaemon: "stale_pid",
        connectedDaemon: "reachable",
        serverId: "server-1",
        pid: 7675,
        listen: "127.0.0.1:6767",
        daemonVersion: "1.2.2",
        desktopManaged: true,
      })
      .mockResolvedValueOnce({ action: "stopped" })
      .mockResolvedValueOnce({
        localDaemon: "stopped",
        connectedDaemon: "unreachable",
        serverId: "",
      });
    const handlers = createDaemonCommandHandlers();

    await expect(handlers.stop_desktop_daemon()).resolves.toEqual({
      serverId: "",
      status: "stopped",
      listen: null,
      hostname: null,
      pid: null,
      home: mocks.paseoHome,
      version: null,
      desktopManaged: false,
      error: null,
    });

    expect(mocks.runExternalCliJsonCommand).toHaveBeenNthCalledWith(2, [
      "daemon",
      "stop",
      "--json",
      "--timeout",
      "5",
      "--force",
      "--kill-timeout",
      "5",
    ]);
  });

  it("records the renderer stop reason when stopping the desktop daemon", async () => {
    mocks.runExternalCliJsonCommand
      .mockResolvedValueOnce({
        localDaemon: "running",
        serverId: "server-1",
        pid: 4242,
        listen: "127.0.0.1:6767",
        desktopManaged: true,
      })
      .mockResolvedValueOnce({ action: "stopped", reason: "lifecycle_shutdown_rpc" })
      .mockResolvedValueOnce({
        localDaemon: "stopped",
        serverId: "",
      });
    const handlers = createDaemonCommandHandlers();

    await handlers.stop_desktop_daemon({ reason: "host_remove" });

    expect(mocks.logInfo).toHaveBeenCalledWith(
      "[desktop daemon]",
      "desktop daemon stop requested",
      expect.objectContaining({ reason: "host_remove" }),
    );
    expect(mocks.logInfo).toHaveBeenCalledWith(
      "[desktop daemon]",
      "desktop daemon stop completed",
      expect.objectContaining({
        reason: "host_remove",
        cliResult: { action: "stopped", reason: "lifecycle_shutdown_rpc" },
      }),
    );
  });

  it("uses a stale reachable desktop daemon when the version matches", async () => {
    mocks.runExternalCliJsonCommand.mockResolvedValue({
      localDaemon: "stale_pid",
      connectedDaemon: "reachable",
      serverId: "server-1",
      pid: 7675,
      listen: "127.0.0.1:6767",
      hostname: "dev-host",
      daemonVersion: "1.2.3",
      desktopManaged: true,
    });
    const handlers = createDaemonCommandHandlers();

    await expect(handlers.start_desktop_daemon()).resolves.toEqual({
      serverId: "server-1",
      status: "running",
      listen: "127.0.0.1:6767",
      hostname: "dev-host",
      pid: null,
      home: mocks.paseoHome,
      version: "1.2.3",
      desktopManaged: true,
      error: null,
    });

    expect(mocks.spawnProcess).not.toHaveBeenCalled();
  });

  it("restarts a stale reachable desktop daemon when the version differs", async () => {
    mocks.runExternalCliJsonCommand
      .mockResolvedValueOnce({
        localDaemon: "stale_pid",
        connectedDaemon: "reachable",
        serverId: "server-1",
        pid: 7675,
        listen: "127.0.0.1:6767",
        hostname: "dev-host",
        daemonVersion: "1.2.2",
        desktopManaged: true,
      })
      .mockResolvedValueOnce({
        localDaemon: "stale_pid",
        connectedDaemon: "reachable",
        serverId: "server-1",
        pid: 7675,
        listen: "127.0.0.1:6767",
        daemonVersion: "1.2.2",
        desktopManaged: true,
      })
      .mockResolvedValueOnce({ action: "stopped" })
      .mockResolvedValueOnce({
        localDaemon: "stopped",
        connectedDaemon: "unreachable",
        serverId: "",
      })
      .mockResolvedValueOnce({
        localDaemon: "running",
        connectedDaemon: "reachable",
        serverId: "server-2",
        pid: 8888,
        listen: "127.0.0.1:6767",
        hostname: "dev-host",
        daemonVersion: "1.2.3",
        desktopManaged: true,
      });
    mocks.spawnProcess.mockReturnValue(createMockChildProcess());
    const handlers = createDaemonCommandHandlers();

    await expect(handlers.start_desktop_daemon()).resolves.toEqual({
      serverId: "server-2",
      status: "running",
      listen: "127.0.0.1:6767",
      hostname: "dev-host",
      pid: 8888,
      home: mocks.paseoHome,
      version: "1.2.3",
      desktopManaged: true,
      error: null,
    });

    expect(mocks.runExternalCliJsonCommand).toHaveBeenNthCalledWith(3, [
      "daemon",
      "stop",
      "--json",
      "--timeout",
      "5",
      "--force",
      "--kill-timeout",
      "5",
    ]);
    expect(mocks.spawnProcess).toHaveBeenCalled();
  });

  it("starts the managed daemon detached from desktop stdio and reports daemon log failures", async () => {
    mkdirSync(mocks.paseoHome, { recursive: true });
    writeFileSync(
      `${mocks.paseoHome}/daemon.log`,
      ["old log line", "recent daemon failure"].join("\n"),
    );
    mocks.runExternalCliJsonCommand.mockResolvedValue({
      localDaemon: "stopped",
      connectedDaemon: "unreachable",
      serverId: "",
    });
    mocks.spawnProcess.mockImplementation(() => {
      const child = createMockChildProcess();
      scheduleFailedStartup(child);
      return child;
    });
    const handlers = createDaemonCommandHandlers();

    let thrown: Error | null = null;
    try {
      await handlers.start_desktop_daemon();
    } catch (error) {
      thrown = error instanceof Error ? error : new Error(String(error));
    }

    expect(thrown).toBeInstanceOf(Error);
    const message = thrown?.message ?? "";
    const recentLogsLabel = message.match(/Recent logs \(([^)]*)\):/)?.[1];
    expect(message).toContain("Daemon failed to start: exit code 1");
    expect(recentLogsLabel?.split(/[\\/]/).at(-1)).toBe("daemon.log");
    expect(message).toContain("recent daemon failure");
    expect(mocks.createNodeEntrypointInvocation).toHaveBeenCalledWith(
      expect.objectContaining({ args: [] }),
    );
    expect(mocks.spawnProcess).toHaveBeenCalledWith(
      "node",
      [],
      expect.objectContaining({
        detached: true,
        stdio: ["ignore", "ignore", "ignore"],
        envOverlay: expect.objectContaining({
          PASEO_CLI: getBundledCliShimPath(),
          PASEO_WEB_UI_ENABLED: "false",
        }),
      }),
    );
  });

  it("passes stale lock reclaim only after a live desktop daemon is confirmed unresponsive", async () => {
    mocks.runExternalCliJsonCommand.mockResolvedValue({
      localDaemon: "unresponsive",
      connectedDaemon: "unreachable",
      serverId: "",
      pid: 7675,
      listen: "127.0.0.1:6767",
      desktopManaged: true,
    });
    mocks.spawnProcess.mockImplementation(() => {
      const child = createMockChildProcess();
      scheduleFailedStartup(child);
      return child;
    });

    await expect(createDaemonCommandHandlers().start_desktop_daemon()).rejects.toThrow(
      "Daemon failed to start: exit code 1",
    );

    expect(mocks.createNodeEntrypointInvocation).toHaveBeenCalledWith(
      expect.objectContaining({ args: ["--reclaim-stale-pid-lock"] }),
    );
  });

  it("does not pass stale lock reclaim when the status command fails", async () => {
    mocks.runExternalCliJsonCommand.mockRejectedValue(new Error("status command failed"));
    mocks.spawnProcess.mockImplementation(() => {
      const child = createMockChildProcess();
      scheduleFailedStartup(child);
      return child;
    });

    await expect(createDaemonCommandHandlers().start_desktop_daemon()).rejects.toThrow(
      "Daemon failed to start: exit code 1",
    );

    expect(mocks.createNodeEntrypointInvocation).toHaveBeenCalledWith(
      expect.objectContaining({ args: [] }),
    );
  });

  // Regression: each renderer window mounts its own copy of the app and asks main to start
  // the daemon, so two windows ran the version-mismatch restart at once, stopped the same
  // daemon twice, and spawned two replacements that raced for the port.
  it("stops and spawns once when two renderer windows request a start at the same time", async () => {
    const cli = installFakeDaemonCli();
    const windowA = createDaemonCommandHandlers();
    const windowB = createDaemonCommandHandlers();

    const [first, second] = await Promise.all([
      windowA.start_desktop_daemon(),
      windowB.start_desktop_daemon(),
    ]);

    expect(first).toEqual(
      expect.objectContaining({ status: "running", serverId: "server-2", version: "1.2.3" }),
    );
    expect(second).toBe(first);
    expect(cli.stopCalls).toBe(1);
    expect(cli.spawnCalls).toBe(1);
  });

  it("re-checks the daemon for a start requested after the first start finished", async () => {
    const cli = installFakeDaemonCli();

    const first = await createDaemonCommandHandlers().start_desktop_daemon();
    const statusCallsAfterFirst = cli.statusCalls;
    const second = await createDaemonCommandHandlers().start_desktop_daemon();

    expect(second).not.toBe(first);
    expect(second).toEqual(first);
    expect(cli.statusCalls).toBeGreaterThan(statusCallsAfterFirst);
    expect(cli.spawnCalls).toBe(1);
  });

  it("retries a failed start for the next window instead of replaying the failure", async () => {
    mocks.runExternalCliJsonCommand.mockResolvedValue({
      localDaemon: "stopped",
      connectedDaemon: "unreachable",
      serverId: "",
    });
    let spawnCalls = 0;
    mocks.spawnProcess.mockImplementation(() => {
      spawnCalls += 1;
      const child = createMockChildProcess();
      scheduleFailedStartup(child);
      return child;
    });

    await expect(createDaemonCommandHandlers().start_desktop_daemon()).rejects.toThrow(
      "Daemon failed to start: exit code 1",
    );
    await expect(createDaemonCommandHandlers().start_desktop_daemon()).rejects.toThrow(
      "Daemon failed to start: exit code 1",
    );

    expect(spawnCalls).toBe(2);
  });

  it("does not let a restart join an in-flight start", async () => {
    const cli = installFakeDaemonCli();
    const windowA = createDaemonCommandHandlers();
    const windowB = createDaemonCommandHandlers();

    const start = windowA.start_desktop_daemon();
    const restart = windowB.restart_desktop_daemon();
    const [started, restarted] = await Promise.all([start, restart]);

    expect(started).toEqual(expect.objectContaining({ serverId: "server-2" }));
    expect(restarted).toEqual(expect.objectContaining({ serverId: "server-3" }));
    // The start stops the mismatched daemon and spawns a replacement; the restart then
    // stops that replacement and spawns its own.
    expect(cli.stopCalls).toBe(2);
    expect(cli.spawnCalls).toBe(2);
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
});
