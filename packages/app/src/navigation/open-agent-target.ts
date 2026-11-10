import {
  readAgentNavTarget,
  type AgentNavTarget,
  type NavigateToAgentInput,
} from "@/utils/navigate-to-agent";

export interface OpenAgentTargetRef {
  serverId: string;
  agentId: string;
  pin?: boolean;
}

export interface OpenAgentTargetDeps {
  navigateToAgent: (input: NavigateToAgentInput, navTarget: AgentNavTarget) => string | null;
  openAgentInProjectWindow: (projectId: string, target: OpenAgentTargetRef) => void;
}

/**
 * Opens an agent named by an explicit request: a notification tap or a plugin
 * surface link.
 *
 * `navigateToAgent` returns null when the agent's project is outside this
 * window's active space. The request then belongs to the window bound to that
 * project's space, so hand the agent to that window instead of dropping the
 * request. An unresolved project stays suppressed: nothing identifies the
 * window to hand it to.
 *
 * The store target is read once so the cross-window decision and the
 * navigation work from the same snapshot. Callers that already read it pass
 * `navTarget` to avoid a second read.
 */
export function openAgentTarget(
  input: NavigateToAgentInput,
  deps: OpenAgentTargetDeps,
  navTarget: AgentNavTarget = readAgentNavTarget({
    serverId: input.serverId,
    agentId: input.agentId,
    workspaceHint: input.workspaceId,
  }),
): void {
  const projectId = navTarget.projectId ?? null;
  const route = deps.navigateToAgent(input, navTarget);
  if (route === null && projectId) {
    deps.openAgentInProjectWindow(projectId, {
      serverId: input.serverId,
      agentId: input.agentId,
      ...(input.pin === undefined ? {} : { pin: input.pin }),
    });
  }
}
