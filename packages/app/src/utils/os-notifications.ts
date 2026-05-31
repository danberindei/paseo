import * as Notifications from "expo-notifications";
import { Asset } from "expo-asset";
import { getDesktopHost } from "@/desktop/host";
import { buildNotificationRoute, resolveNotificationTarget } from "./notification-routing";
import { isNative } from "@/constants/platform";

interface OsNotificationPayload {
  title: string;
  body?: string;
  data?: Record<string, unknown>;
}

export interface WebNotificationClickDetail {
  data?: Record<string, unknown>;
}

interface WebNotificationInstance {
  addEventListener: (type: "click", listener: (event: Event) => void) => void;
  close?: () => void;
}

export const WEB_NOTIFICATION_CLICK_EVENT = "paseo:web-notification-click";

let permissionRequest: Promise<boolean> | null = null;
let notificationIconUrl: string | null | undefined;
const webNotificationsByAgentId = new Map<string, WebNotificationInstance>();

function getDesktopNotificationSender():
  | ((payload: {
      title: string;
      body?: string;
      data?: Record<string, unknown>;
    }) => Promise<boolean>)
  | null {
  const sendNotification = getDesktopHost()?.notification?.sendNotification;
  return typeof sendNotification === "function"
    ? (sendNotification as (payload: {
        title: string;
        body?: string;
        data?: Record<string, unknown>;
      }) => Promise<boolean>)
    : null;
}

function getWebNotificationConstructor(): {
  permission: string;
  requestPermission?: () => Promise<string>;
  new (
    title: string,
    options?: {
      body?: string;
      data?: Record<string, unknown>;
      icon?: string;
    },
  ): unknown;
} | null {
  const NotificationConstructor = (
    globalThis as {
      Notification?: {
        permission: string;
        requestPermission?: () => Promise<string>;
        new (
          title: string,
          options?: { body?: string; data?: Record<string, unknown>; icon?: string },
        ): unknown;
      };
    }
  ).Notification;
  return NotificationConstructor ?? null;
}

async function ensureNotificationPermission(): Promise<boolean> {
  const NotificationConstructor = getWebNotificationConstructor();
  if (!NotificationConstructor) {
    return false;
  }
  if (NotificationConstructor.permission === "granted") {
    return true;
  }
  if (NotificationConstructor.permission === "denied") {
    return false;
  }
  if (permissionRequest) {
    return permissionRequest;
  }
  permissionRequest = Promise.resolve(
    NotificationConstructor.requestPermission
      ? NotificationConstructor.requestPermission()
      : "denied",
  ).then((permission) => permission === "granted");
  const result = await permissionRequest;
  permissionRequest = null;
  return result;
}

export async function ensureOsNotificationPermission(): Promise<boolean> {
  if (isNative) {
    return false;
  }
  return await ensureNotificationPermission();
}

function hasNotificationClickTarget(data: Record<string, unknown> | undefined): boolean {
  const target = resolveNotificationTarget(data);
  return target.serverId !== null || target.agentId !== null || target.workspaceId !== null;
}

function getWebNotificationIconUrl(): string | undefined {
  if (notificationIconUrl !== undefined) {
    return notificationIconUrl ?? undefined;
  }

  try {
    const asset = Asset.fromModule(require("../../assets/images/notification-icon.png"));
    notificationIconUrl = asset.uri ?? null;
  } catch {
    notificationIconUrl = null;
  }

  return notificationIconUrl ?? undefined;
}

function dispatchWebNotificationClick(detail: WebNotificationClickDetail): boolean {
  const dispatch = (globalThis as { dispatchEvent?: (event: Event) => boolean }).dispatchEvent;
  const CustomEventConstructor = (globalThis as { CustomEvent?: typeof CustomEvent }).CustomEvent;

  if (typeof dispatch !== "function" || !CustomEventConstructor) {
    return false;
  }

  const event = new CustomEventConstructor<WebNotificationClickDetail>(
    WEB_NOTIFICATION_CLICK_EVENT,
    {
      detail,
      cancelable: true,
    },
  );
  return !dispatch(event);
}

function fallbackNavigateToNotificationTarget(data: Record<string, unknown> | undefined): void {
  const route = buildNotificationRoute(data);
  const location = (globalThis as { location?: { assign?: (url: string) => void; href?: string } })
    .location;
  if (!location) {
    return;
  }
  if (typeof location.assign === "function") {
    location.assign(route);
    return;
  }
  if (typeof location.href === "string") {
    location.href = route;
  }
}

function attachWebClickHandler(
  notification: WebNotificationInstance,
  data: Record<string, unknown> | undefined,
): void {
  notification.addEventListener("click", () => {
    const handledByApp = dispatchWebNotificationClick({ data });
    if (!handledByApp) {
      fallbackNavigateToNotificationTarget(data);
    }
  });
}

export async function dismissOsNotificationsForAgent(agentId: string): Promise<void> {
  if (isNative) {
    const presented = await Notifications.getPresentedNotificationsAsync();
    const matching = presented.filter(
      (n) =>
        typeof n.request.content.data === "object" &&
        n.request.content.data !== null &&
        (n.request.content.data as Record<string, unknown>).agentId === agentId,
    );
    await Promise.all(
      matching.map((n) => Notifications.dismissNotificationAsync(n.request.identifier)),
    );
    return;
  }

  const desktopHost = getDesktopHost();
  if (desktopHost?.notification?.dismissNotification) {
    await desktopHost.notification.dismissNotification(agentId);
    return;
  }

  const notification = webNotificationsByAgentId.get(agentId);
  if (notification) {
    notification.close?.();
    webNotificationsByAgentId.delete(agentId);
  }
}

export async function sendOsNotification(payload: OsNotificationPayload): Promise<boolean> {
  // Mobile/native notifications should be remote push only.
  if (isNative) {
    return false;
  }

  const desktopNotificationSender = getDesktopNotificationSender();
  if (desktopNotificationSender) {
    return await desktopNotificationSender(payload);
  }

  const NotificationConstructor = getWebNotificationConstructor();
  if (NotificationConstructor) {
    const granted = await ensureNotificationPermission();
    if (granted) {
      const notification = new NotificationConstructor(payload.title, {
        body: payload.body,
        data: payload.data,
        icon: getWebNotificationIconUrl(),
      }) as WebNotificationInstance;
      const agentId =
        typeof payload.data?.agentId === "string" && payload.data.agentId.length > 0
          ? payload.data.agentId
          : null;
      if (agentId) {
        webNotificationsByAgentId.get(agentId)?.close?.();
        webNotificationsByAgentId.set(agentId, notification);
        notification.addEventListener("click", () => {
          webNotificationsByAgentId.delete(agentId);
        });
      }
      if (hasNotificationClickTarget(payload.data)) {
        attachWebClickHandler(notification, payload.data);
      }
      return true;
    }
  }

  return false;
}
