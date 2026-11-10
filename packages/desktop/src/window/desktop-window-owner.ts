import { PendingOpenProjectStore } from "../pending-open-project-store.js";

export interface OwnedDesktopWindow<TAgentTarget> {
  webContentsId: number;
  /** Space this window is bound to; null for a window bound to no space. */
  spaceId: string | null;
  isDestroyed(): boolean;
  isVisible(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  sendAgent(target: TAgentTarget): void;
}

interface DesktopWindowOwnerPort<TAgentTarget> {
  create(input: {
    initialRoute: string | null;
    restoreWindowState: boolean;
    spaceId?: string | null;
    onCreated(webContentsId: number): void;
    onClosed(webContentsId: number): void;
  }): Promise<OwnedDesktopWindow<TAgentTarget>>;
  windows(): OwnedDesktopWindow<TAgentTarget>[];
  focusedWindow(): OwnedDesktopWindow<TAgentTarget> | null;
  agentRoute(target: TAgentTarget): string;
  deliverAgent(webContentsId: number, target: TAgentTarget): TAgentTarget | null;
}

export interface DesktopWindowOwner<TAgentTarget> {
  openPrimary(input?: {
    initialRoute?: string | null;
    pendingProjectPath?: string | null;
    spaceId?: string | null;
  }): Promise<void>;
  openAdditional(input?: {
    initialRoute?: string | null;
    pendingProjectPath?: string | null;
    spaceId?: string | null;
  }): Promise<void>;
  openOrFocusAgent(target: TAgentTarget): Promise<void>;
  /**
   * Focuses the window bound to `spaceId` and opens the agent there, or opens a
   * new window bound to that space on the agent's route.
   */
  openOrFocusAgentInSpace(spaceId: string, target: TAgentTarget): Promise<void>;
  restoreWhenActivated(): Promise<void>;
  takePendingProject(webContentsId: number): string | null;
}

export function createDesktopWindowOwner<TAgentTarget>(
  port: DesktopWindowOwnerPort<TAgentTarget>,
): DesktopWindowOwner<TAgentTarget> {
  const pendingProjects = new PendingOpenProjectStore();
  let agentWindowCreation: Promise<void> | null = null;
  const spaceWindowCreations = new Map<string, Promise<void>>();

  const open = async (input: {
    initialRoute: string | null;
    pendingProjectPath: string | null;
    restoreWindowState: boolean;
    spaceId: string | null;
  }): Promise<void> => {
    await port.create({
      initialRoute: input.initialRoute,
      restoreWindowState: input.restoreWindowState,
      spaceId: input.spaceId,
      onCreated: (webContentsId) => pendingProjects.set(webContentsId, input.pendingProjectPath),
      onClosed: (webContentsId) => pendingProjects.delete(webContentsId),
    });
  };

  /** Focuses the window and hands the agent to it, queueing while it loads. */
  const focusAndDeliver = (
    window: OwnedDesktopWindow<TAgentTarget>,
    target: TAgentTarget,
  ): void => {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    const deliverable = port.deliverAgent(window.webContentsId, target);
    if (deliverable) window.sendAgent(deliverable);
  };

  const owner: DesktopWindowOwner<TAgentTarget> = {
    openPrimary: (input = {}) =>
      open({
        initialRoute: input.initialRoute ?? null,
        pendingProjectPath: input.pendingProjectPath ?? null,
        restoreWindowState: true,
        spaceId: input.spaceId ?? null,
      }),
    openAdditional: (input = {}) =>
      open({
        initialRoute: input.initialRoute ?? null,
        pendingProjectPath: input.pendingProjectPath ?? null,
        restoreWindowState: false,
        spaceId: input.spaceId ?? null,
      }),
    async openOrFocusAgent(target) {
      const windows = port.windows();
      const window =
        port.focusedWindow() ?? windows.find((candidate) => candidate.isVisible()) ?? windows[0];
      if (!window || window.isDestroyed()) {
        if (!agentWindowCreation) {
          agentWindowCreation = owner
            .openPrimary({ initialRoute: port.agentRoute(target) })
            .finally(() => {
              agentWindowCreation = null;
            });
          await agentWindowCreation;
          return;
        }
        await agentWindowCreation;
        await owner.openOrFocusAgent(target);
        return;
      }
      focusAndDeliver(window, target);
    },
    async openOrFocusAgentInSpace(spaceId, target) {
      const creation = spaceWindowCreations.get(spaceId);
      if (creation) {
        await creation;
        await owner.openOrFocusAgentInSpace(spaceId, target);
        return;
      }
      const existing = port
        .windows()
        .find((candidate) => !candidate.isDestroyed() && candidate.spaceId === spaceId);
      if (existing) {
        focusAndDeliver(existing, target);
        return;
      }
      const newCreation = owner
        .openAdditional({ spaceId, initialRoute: port.agentRoute(target) })
        .finally(() => spaceWindowCreations.delete(spaceId));
      spaceWindowCreations.set(spaceId, newCreation);
      await newCreation;
    },
    async restoreWhenActivated() {
      if (port.windows().length === 0) await owner.openPrimary();
    },
    takePendingProject: (webContentsId) => pendingProjects.take(webContentsId),
  };
  return owner;
}
