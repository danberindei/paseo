import { parseAgentDeepLink, type AgentDeepLinkTarget } from "@getpaseo/protocol/agent-deep-link";

export type DesktopAgentTarget = AgentDeepLinkTarget & { pin?: boolean };

export interface AgentOpenInSpaceRequest {
  spaceId: string;
  target: DesktopAgentTarget;
}

/**
 * Reads a renderer request to open an agent in the window bound to `spaceId`.
 * The renderer resolves the space from the agent's project, which only it knows.
 */
export function readAgentOpenInSpaceRequest(input: unknown): AgentOpenInSpaceRequest | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }
  const candidate = input as Record<string, unknown>;
  const spaceId = typeof candidate.spaceId === "string" ? candidate.spaceId.trim() : "";
  const serverId = typeof candidate.serverId === "string" ? candidate.serverId.trim() : "";
  const agentId = typeof candidate.agentId === "string" ? candidate.agentId.trim() : "";
  if (!spaceId || !serverId || !agentId) {
    return null;
  }
  const pin = candidate.pin;
  if (pin !== undefined && typeof pin !== "boolean") return null;
  return { spaceId, target: { serverId, agentId, ...(pin === undefined ? {} : { pin }) } };
}

export function parseAgentDeepLinkFromArgv(argv: string[]): AgentDeepLinkTarget | null {
  for (const arg of argv) {
    const target = parseAgentDeepLink(arg);
    if (target) {
      return target;
    }
  }
  return null;
}

export class AgentNavigationInbox {
  private readonly readyWindows = new Set<number>();
  private readonly pendingByWindow = new Map<number, DesktopAgentTarget>();

  windowLoading(webContentsId: number): void {
    this.readyWindows.delete(webContentsId);
  }

  windowReady(webContentsId: number): DesktopAgentTarget | null {
    this.readyWindows.add(webContentsId);
    const pending = this.pendingByWindow.get(webContentsId) ?? null;
    this.pendingByWindow.delete(webContentsId);
    return pending;
  }

  deliverOrQueue(webContentsId: number, target: DesktopAgentTarget): DesktopAgentTarget | null {
    if (this.readyWindows.has(webContentsId)) {
      return target;
    }
    this.pendingByWindow.set(webContentsId, target);
    return null;
  }

  removeWindow(webContentsId: number): void {
    this.readyWindows.delete(webContentsId);
    this.pendingByWindow.delete(webContentsId);
  }
}
