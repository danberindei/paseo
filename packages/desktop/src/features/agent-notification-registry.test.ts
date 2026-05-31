import { describe, expect, it } from "vitest";
import { deleteAgentNotificationIfCurrent } from "./agent-notification-registry";

describe("agent notification registry", () => {
  it("keeps a replacement when an older notification is cleaned up", () => {
    const notificationsByAgentId = new Map<string, object>();
    const oldNotification = {};
    const replacement = {};
    notificationsByAgentId.set("agent", oldNotification);
    notificationsByAgentId.set("agent", replacement);

    deleteAgentNotificationIfCurrent(notificationsByAgentId, "agent", oldNotification);

    expect(notificationsByAgentId.get("agent")).toBe(replacement);
  });

  it("removes the notification when it is still current", () => {
    const notificationsByAgentId = new Map<string, object>();
    const notification = {};
    notificationsByAgentId.set("agent", notification);

    deleteAgentNotificationIfCurrent(notificationsByAgentId, "agent", notification);

    expect(notificationsByAgentId.has("agent")).toBe(false);
  });
});
