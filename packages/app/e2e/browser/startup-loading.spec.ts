import { expect, test } from "../support/fixtures";
import { startupScenario } from "../support/helpers/startup-dsl";
import { buildHostWorkspaceRoute } from "@/utils/host-routes";
import { getServerId } from "../support/helpers/server-id";
import { seedWorkspace } from "../support/helpers/seed-client";

test.describe("Startup loading presentation", () => {
  test("recovers the saved spaces error after storage becomes available", async ({ page }) => {
    await page.addInitScript(() => {
      const getItem = Storage.prototype.getItem;
      let failSpaceRead = true;
      Storage.prototype.getItem = function (key: string) {
        if (key === "space-store" && failSpaceRead) {
          failSpaceRead = false;
          throw new Error("storage unavailable");
        }
        return getItem.call(this, key);
      };
    });

    await startupScenario(page).openRoot();

    await expect(page.getByText("Could not load spaces", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Paseo could not read your saved spaces.", { exact: false }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.getByText("Could not load spaces", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("open-project-submit")).toBeVisible();
  });

  test("restores the saved workspace through its host boundary", async ({ page }) => {
    const workspace = await seedWorkspace({ repoPrefix: "startup-restore-" });
    const serverId = getServerId();

    try {
      await page.addInitScript(
        ({ savedServerId, workspaceId }) => {
          localStorage.setItem(
            "paseo:last-workspace-route-selection",
            JSON.stringify({ defaultSelection: { serverId: savedServerId, workspaceId } }),
          );
        },
        { savedServerId: serverId, workspaceId: workspace.workspaceId },
      );
      await startupScenario(page).openRoot();

      await expect(page).toHaveURL(buildHostWorkspaceRoute(serverId, workspace.workspaceId), {
        timeout: 30_000,
      });
      await expect(page.getByTestId("workspace-header-title")).toBeVisible();
    } finally {
      await workspace.cleanup();
    }
  });

  test("mobile reconnect preserves the saved host shell", async ({ page }) => {
    const startup = await startupScenario(page)
      .withMobileViewport()
      .withSavedHost({
        serverId: "srv_unreachable_mobile",
        label: "Dev",
        endpoint: "127.0.0.1:45678",
      })
      .openRoot();

    await startup.expectsSavedHostShell({ serverId: "srv_unreachable_mobile", label: "Dev" });
    await startup.expectsNoSavedHostErrorStatus();
    await startup.expectsNoLocalServerStartupCopy();
  });
});
