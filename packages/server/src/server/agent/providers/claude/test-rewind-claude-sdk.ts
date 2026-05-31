import type { ClaudeRewindSdk } from "./rewind.js";

export class FakeClaudeSdk implements ClaudeRewindSdk {
  readonly recordedForks: Array<{ upToMessageId: string; configDir?: string }> = [];
  readonly recordedFileRewinds: Array<{ userMessageId: string }> = [];

  private nextSessionId = "forked-session-1";

  setNextSessionId(sessionId: string): void {
    this.nextSessionId = sessionId;
  }

  async forkSession(
    _sessionId: string,
    options: { upToMessageId: string; configDir?: string },
  ): Promise<{ sessionId: string }> {
    this.recordedForks.push({ upToMessageId: options.upToMessageId, configDir: options.configDir });
    return { sessionId: this.nextSessionId };
  }

  createQuery(): {
    rewindFiles: (
      userMessageId: string,
      options?: { dryRun?: boolean },
    ) => Promise<{
      canRewind: boolean;
    }>;
  } {
    return {
      rewindFiles: async (userMessageId: string) => {
        this.recordedFileRewinds.push({ userMessageId });
        return { canRewind: true };
      },
    };
  }
}
