import path from "node:path";
import { existsSync } from "node:fs";
import { app, BrowserWindow, Notification, ipcMain, nativeImage } from "electron";
import { getDesktopSettingsStore } from "../settings/desktop-settings-electron.js";

interface NotificationInput {
  title?: unknown;
  body?: unknown;
  data?: unknown;
}

interface NotificationClickPayload {
  data?: Record<string, unknown>;
}

const activeNotifications = new Set<Notification>();

function toTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function getNotificationIcon(): Electron.NativeImage | null {
  const candidates = [
    path.resolve(__dirname, "../assets/icon.png"),
    path.resolve(__dirname, "../assets/64x64.png"),
    path.resolve(__dirname, "../assets/128x128.png"),
  ];

  for (const iconPath of candidates) {
    if (!existsSync(iconPath)) {
      continue;
    }
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) {
      return icon;
    }
  }

  return null;
}

/**
 * macOS requires a notification to have been shown at least once before
 * the app appears in System Preferences > Notifications. We fire a
 * silent no-op notification during startup to ensure registration.
 */
export function ensureNotificationCenterRegistration(): void {
  if (process.platform !== "darwin" || !Notification.isSupported()) {
    return;
  }

  const probe = new Notification({ title: app.name, silent: true });
  probe.on("show", () => probe.close());
  setTimeout(() => probe.close(), 2_000);
  probe.show();
}

interface NotificationHandlerContext {
  getWindowRegistry: () => Map<BrowserWindow, string | null>;
  getLastFocusedWindow: () => BrowserWindow | null;
}

function findWindowForSpaceId(
  registry: Map<BrowserWindow, string | null>,
  spaceId: string,
): BrowserWindow | null {
  for (const [win, boundSpaceId] of registry) {
    if (boundSpaceId === spaceId && !win.isDestroyed()) {
      return win;
    }
  }
  return null;
}

export function registerNotificationHandlers(context: NotificationHandlerContext): void {
  ipcMain.handle("paseo:notification:isSupported", () => {
    return Notification.isSupported();
  });

  ipcMain.handle("paseo:notification:send", async (event, rawInput?: NotificationInput) => {
    if (!Notification.isSupported()) {
      return false;
    }

    const title = toTrimmedString(rawInput?.title);
    if (!title) {
      return false;
    }

    const body = toTrimmedString(rawInput?.body) ?? undefined;
    const data = toRecord(rawInput?.data);
    const icon = getNotificationIcon();
    const settings = await getDesktopSettingsStore().get();
    const notification = new Notification({
      title,
      ...(body ? { body } : {}),
      ...(icon ? { icon } : {}),
      silent: !settings.notifications.playSound,
    });

    activeNotifications.add(notification);

    notification.on("click", () => {
      const allWindows = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
      const spaceId =
        typeof data?.spaceId === "string" && data.spaceId.length > 0 ? data.spaceId : null;
      const registry = context.getWindowRegistry();
      const spaceWin = spaceId ? findWindowForSpaceId(registry, spaceId) : null;
      const focusWin =
        spaceWin ??
        context.getLastFocusedWindow() ??
        BrowserWindow.fromWebContents(event.sender) ??
        allWindows[0] ??
        null;
      if (focusWin && !focusWin.isDestroyed()) {
        focusWin.show();
        if (focusWin.isMinimized()) {
          focusWin.restore();
        }
        focusWin.focus();
      }
      if (data && Object.keys(data).length > 0) {
        const payload: NotificationClickPayload = { data };
        for (const win of allWindows) {
          win.webContents.send("paseo:event:notification-click", payload);
        }
      }
      activeNotifications.delete(notification);
    });

    notification.on("close", () => {
      activeNotifications.delete(notification);
    });

    notification.show();
    return true;
  });
}
