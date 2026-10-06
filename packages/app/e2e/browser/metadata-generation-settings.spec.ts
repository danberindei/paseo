import { expect, test, type Page } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { getServerId } from "../support/helpers/server-id";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { connectNewWorkspaceDaemonClient } from "../support/helpers/new-workspace";
import {
  expectSettingsHeader,
  openHostSection,
  openSettingsHost,
} from "../support/helpers/settings";

async function openMetadataGenerationSettings(page: Page) {
  const serverId = getServerId();
  await gotoAppShell(page);
  await openSettings(page);
  await openSettingsHost(page, serverId);
  await openHostSection(page, serverId, "metadata");
  await expectSettingsHeader(page, "Metadata");
}

async function openManualMetadataModelPicker(page: Page) {
  await page.getByRole("button", { name: "Manual", exact: true }).click();
  await page.getByRole("button", { name: /Select model/ }).click();
}

test("agent title generation defaults on and persists without changing model preferences", async ({
  page,
}) => {
  const client = await connectNewWorkspaceDaemonClient({ ownProjects: false });
  const previous = (await client.getDaemonConfig()).config.metadataGeneration;
  try {
    await openMetadataGenerationSettings(page);
    const toggle = page.getByRole("switch", { name: "Generate agent titles" });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await expect
      .poll(async () => (await client.getDaemonConfig()).config.metadataGeneration)
      .toEqual({ ...previous, generateAgentTitles: false });
    await page.reload();
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await expect(toggle).toBeChecked();
    await page.reload();
    await expect(toggle).toBeChecked();
  } finally {
    await client.patchDaemonConfig({ metadataGeneration: previous });
    await client.close();
  }
});

test("agent title settings show pending and failure states and allow retry", async ({ page }) => {
  let rejectRequest: (() => void) | undefined;
  let failed = false;
  await page.routeWebSocket(daemonWsRoutePattern(), (browser) => {
    const server = browser.connectToServer();
    browser.onMessage((message) => {
      if (typeof message === "string") {
        const envelope = JSON.parse(message);
        const request = envelope.message;
        if (
          !failed &&
          request?.type === "set_daemon_config_request" &&
          request.config.metadataGeneration?.generateAgentTitles !== undefined
        ) {
          failed = true;
          rejectRequest = () =>
            browser.send(
              JSON.stringify({
                type: "session",
                message: {
                  type: "rpc_error",
                  payload: {
                    requestId: request.requestId,
                    requestType: request.type,
                    error: "Injected title settings failure",
                  },
                },
              }),
            );
          return;
        }
      }
      server.send(message);
    });
    server.onMessage((message) => browser.send(message));
  });
  const client = await connectNewWorkspaceDaemonClient({ ownProjects: false });
  const previous = (await client.getDaemonConfig()).config.metadataGeneration;
  try {
    await openMetadataGenerationSettings(page);
    const toggle = page.getByRole("switch", { name: "Generate agent titles" });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-disabled", "true");
    await expect.poll(() => typeof rejectRequest).toBe("function");
    rejectRequest!();
    await expect(page.getByRole("alert")).toHaveText("Injected title settings failure");
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally {
    await client.patchDaemonConfig({ metadataGeneration: previous });
    await client.close();
  }
});

test("agent title settings request a host update when the feature is unavailable", async ({
  page,
}) => {
  await page.routeWebSocket(daemonWsRoutePattern(), (browser) => {
    const server = browser.connectToServer();
    browser.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      if (typeof message !== "string") {
        browser.send(message);
        return;
      }
      const envelope = JSON.parse(message);
      if (envelope.message?.type === "status" && envelope.message.payload?.status === "server_info")
        envelope.message.payload.features.agentTitleGeneration = false;
      browser.send(JSON.stringify(envelope));
    });
  });
  await openMetadataGenerationSettings(page);
  await expect(page.getByText("Update the host to configure agent titles.")).toBeVisible();
  await expect(page.getByRole("switch", { name: "Generate agent titles" })).toHaveCount(0);
});

test("chooses a metadata model and can return to automatic selection", async ({
  page,
}, testInfo) => {
  await openMetadataGenerationSettings(page);

  // The section explains itself through the header's info tooltip, not a paragraph.
  await expect(page.getByTestId("metadata-generation-settings-info")).toHaveAccessibleName(
    "About Metadata generation",
  );
  await expect(page.getByRole("button", { name: "Automatic", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.screenshot({
    path: testInfo.outputPath("metadata-automatic.png"),
    fullPage: true,
  });

  await openManualMetadataModelPicker(page);
  await page.getByText("Mock Load Test", { exact: true }).click();
  await expect(page.getByText("Ten second stream", { exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("metadata-model-picker.png"),
    fullPage: true,
  });
  await page.getByText("Ten second stream", { exact: true }).click();

  await expect(page.getByRole("button", { name: /Ten second stream/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Manual", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("button", { name: /Ten second stream/ })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("metadata-manual-persisted.png"),
    fullPage: true,
  });

  await page.getByRole("button", { name: "Automatic", exact: true }).click();
  await page.reload();

  await expect(page.getByRole("button", { name: "Automatic", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("button", { name: /Ten second stream/ })).toHaveCount(0);
});

test("replaces only the first configured metadata model", async ({ page }) => {
  const client = await connectNewWorkspaceDaemonClient({ ownProjects: false });
  const previousConfig = await client.getDaemonConfig();

  try {
    await client.patchDaemonConfig({
      metadataGeneration: {
        providers: [
          { provider: "mock", model: "five-minute-stream" },
          { provider: "mock", model: "thirty-minute-stream" },
        ],
      },
    });
    await openMetadataGenerationSettings(page);

    await expect(page.getByRole("button", { name: "Manual", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await openManualMetadataModelPicker(page);
    await page.getByText("Ten second stream", { exact: true }).click();

    await expect
      .poll(async () => (await client.getDaemonConfig()).config.metadataGeneration.providers)
      .toEqual([
        { provider: "mock", model: "ten-second-stream" },
        { provider: "mock", model: "thirty-minute-stream" },
      ]);
  } finally {
    try {
      await client.patchDaemonConfig({
        metadataGeneration: {
          providers: previousConfig.config.metadataGeneration.providers,
        },
      });
    } finally {
      await client.close().catch(() => undefined);
    }
  }
});
