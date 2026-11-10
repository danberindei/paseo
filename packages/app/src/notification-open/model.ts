import { buildHostRootRoute } from "@/utils/host-routes";
import type { NotificationOpenSource, NotificationTap } from "./source";

export const WEB_NOTIFICATION_CLICK_EVENT = "paseo:web-notification-click";

export interface AgentNotificationTarget {
  serverId: string;
  agentId: string;
  // Workspace named by the notification. Not the navigation target: the agent
  // can move after the notification is sent, so the session record wins when it
  // exists. It still names the project while that record is missing.
  workspaceId?: string;
}

export type NotificationOpenTarget =
  | ({ kind: "agent" } & AgentNotificationTarget)
  | { kind: "terminal"; serverId: string; workspaceId: string; terminalId: string }
  | { kind: "host"; serverId: string };

function readId(data: object, key: string): string {
  const value: unknown = Reflect.get(data, key);
  return typeof value === "string" ? value.trim() : "";
}

export function parseNotificationOpenTarget(data: unknown): NotificationOpenTarget | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const serverId = readId(data, "serverId");
  if (!serverId) return null;
  const workspaceId = readId(data, "workspaceId");
  const terminalId = readId(data, "terminalId");
  if (workspaceId && terminalId) return { kind: "terminal", serverId, workspaceId, terminalId };
  const agentId = readId(data, "agentId");
  if (agentId) {
    return workspaceId
      ? { kind: "agent", serverId, agentId, workspaceId }
      : { kind: "agent", serverId, agentId };
  }
  return { kind: "host", serverId };
}

interface NotificationOpenRouterDeps {
  source: NotificationOpenSource;
  openAgent: (target: AgentNotificationTarget) => void;
  openRoute: (route: string) => void;
  openTerminal: (target: Extract<NotificationOpenTarget, { kind: "terminal" }>) => void;
  whenReadyToNavigate: () => Promise<void>;
}

export function createNotificationOpenRouter(deps: NotificationOpenRouterDeps) {
  const handledIds = new Set<string>();
  let launchTaken = false;
  async function receive(tap: NotificationTap) {
    if (handledIds.has(tap.id)) return;
    handledIds.add(tap.id);
    await deps.whenReadyToNavigate();
    const target = parseNotificationOpenTarget(tap.data);
    if (target?.kind === "agent") {
      deps.openAgent({
        serverId: target.serverId,
        agentId: target.agentId,
        ...(target.workspaceId ? { workspaceId: target.workspaceId } : {}),
      });
    } else if (target?.kind === "terminal") {
      deps.openTerminal(target);
    } else if (target?.kind === "host") {
      deps.openRoute(buildHostRootRoute(target.serverId));
    }
    deps.source.acknowledge(tap);
  }
  return {
    start() {
      const unsubscribe = deps.source.subscribe((tap) => {
        void receive(tap);
      });
      if (!launchTaken) {
        launchTaken = true;
        void deps.source.takeLaunchTap().then((tap) => {
          return tap ? receive(tap) : undefined;
        });
      }
      return unsubscribe;
    },
  };
}
