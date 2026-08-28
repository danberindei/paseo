import { expect, test, type Page } from "../support/fixtures";
import {
  expectComposerMode,
  expectComposerModel,
  seedAgentProfiles,
} from "../support/helpers/agent-profiles";
import { waitForDraftComposer } from "../support/helpers/command-center-agent-controls";
import { clickNewChat, gotoWorkspace } from "../support/helpers/launcher";
import { seedWorkspace } from "../support/helpers/seed-client";

const DEFAULT_MATCH_PROFILE = {
  id: "p-default",
  name: "Default match",
  provider: "mock",
  model: "ten-second-stream",
};

const OTHER_PROFILE = {
  id: "p-other",
  name: "Other",
  provider: "mock",
  model: "five-minute-stream",
  modeId: "approval-test",
};

// The workspace renders more than one composer instance; the helpers scope
// composer queries to the visible one (openModelPicker, expectThinkingSelected).
function draftChip(page: Page, profileId: string) {
  return page
    .getByTestId(`draft-agent-profile-chip-${profileId}`)
    .filter({ visible: true })
    .first();
}

test.describe("Workspace draft agent profile chips", () => {
  test.describe.configure({ timeout: 180_000 });

  test("highlights the chip matching the draft default and applies the others", async ({
    page,
  }) => {
    const seed = await seedAgentProfiles([DEFAULT_MATCH_PROFILE, OTHER_PROFILE]);
    const workspace = await seedWorkspace({ repoPrefix: "draft-agent-profiles-" });

    try {
      await gotoWorkspace(page, workspace.workspaceId);
      await clickNewChat(page);
      await waitForDraftComposer(page);

      const defaultChip = draftChip(page, "p-default");
      const otherChip = draftChip(page, "p-other");
      await expect(defaultChip).toBeVisible({ timeout: 30_000 });
      await expect(otherChip).toBeVisible();

      await expect(defaultChip).toHaveAttribute("data-default-match", "true");
      await expect(otherChip).not.toHaveAttribute("data-default-match");

      await otherChip.click();
      await expectComposerModel(page, "Five minute stream");
      await expectComposerMode(page, "Approval test");
    } finally {
      await workspace.cleanup();
      await seed.restore();
    }
  });
});
