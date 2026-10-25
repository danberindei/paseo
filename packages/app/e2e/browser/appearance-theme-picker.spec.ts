import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { openSettingsSection } from "../support/helpers/settings";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

test("refreshes retained chat Markdown after the system theme changes", async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(120_000);
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "retained-chat-theme-",
    title: "Retained theme reply",
    featureValues: {
      mockStreamingAssistantResponse:
        "Retained reply with `inline code` and [a link](https://example.com).\n\n" +
        "> Retained quote.\n\n" +
        "| Name | Value |\n| --- | --- |\n| Theme | Auto |\n\n" +
        "```text\nRetained code block.\n```",
      mockStreamingAssistantIntervalMs: 1,
    },
  });
  const other = await seedWorkspace({ repoPrefix: "retained-chat-theme-other-" });

  try {
    await page.emulateMedia({ colorScheme: "dark" });
    await openAgentRoute(page, agent);
    await agent.client.sendAgentMessage(agent.agentId, "Show the reply.");
    await agent.client.waitForFinish(agent.agentId, 30_000);
    const reply = page.getByTestId("assistant-message").filter({ hasText: "Retained reply with" });
    const paragraph = reply.locator("p").filter({ hasText: "Retained reply with" });
    await expect(reply).toBeVisible();
    await expect(paragraph).toHaveCSS("color", "rgb(250, 250, 250)");
    const composer = await page
      .getByTestId("message-input-root")
      .filter({ visible: true })
      .elementHandle();
    expect(composer).not.toBeNull();

    await page.getByTestId(`sidebar-workspace-row-${getServerId()}:${other.workspaceId}`).click();
    await expect(reply).toBeHidden();
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
      await page.emulateMedia({ colorScheme: "light" });
      await cdp.send("Page.setWebLifecycleState", { state: "active" });
    } finally {
      await cdp.detach();
    }
    await expect(page.locator("html")).toHaveCSS("--colors-foreground", "#1a1a1e");
    await expect(paragraph).toHaveCSS("color", "rgb(26, 26, 30)");
    await expect(reply.locator("code")).toHaveCSS("background-color", "rgb(244, 244, 245)");
    await expect(reply.locator("a")).toHaveCSS("color", "rgb(35, 153, 86)");
    await expect(reply.locator("blockquote")).toHaveCSS(
      "color",
      "color(srgb 0.101961 0.101961 0.117647 / 0.8)",
    );
    await expect(reply.locator("th").first()).toHaveCSS("color", "rgb(26, 26, 30)");
    await expect(reply.locator("th").first()).toHaveCSS("background-color", "rgb(244, 244, 245)");
    await expect(reply.locator('[data-paseo-markdown-tag="code"]')).toHaveCSS(
      "color",
      "rgb(26, 26, 30)",
    );
    await expect(reply.locator('[data-paseo-markdown-tag="pre"]')).toHaveCSS(
      "background-color",
      "rgb(244, 244, 245)",
    );
    await page.getByTestId(`sidebar-workspace-row-${getServerId()}:${agent.workspaceId}`).click();

    await expect(reply).toBeVisible();
    await expect(paragraph).toHaveCSS("color", "rgb(26, 26, 30)");
    await expect(reply.locator("code")).toHaveCSS("color", "rgb(26, 26, 30)");
    await expect(reply.locator("code")).toHaveCSS("background-color", "rgb(244, 244, 245)");
    expect(await composer!.evaluate((node) => node.isConnected)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("retained-chat-light.png") });
  } finally {
    await other.cleanup();
    await agent.cleanup();
  }
});

test("shows Pure black in the appearance picker", async ({ page }, testInfo) => {
  await page.goto("/settings");
  await expect(page.getByTestId("settings-sidebar")).toBeVisible();
  await openSettingsSection(page, "appearance");

  await expect(page.getByRole("radio", { name: "System", exact: true })).toBeChecked();
  await expect(
    page.getByRole("radiogroup", { name: "Theme" }).getByRole("radio").first(),
  ).toHaveAccessibleName("System");
  await expect(page.getByRole("radio", { name: "Pure black", exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("appearance-theme-picker.png"),
    fullPage: true,
  });
});

test("keeps the selected workspace visible in Light", async ({ page }, testInfo) => {
  const workspace = await seedWorkspace({
    repoPrefix: "light-selected-workspace-",
    title: "Selected workspace",
  });

  try {
    await page.addInitScript(() => {
      localStorage.setItem("@paseo:app-settings", JSON.stringify({ theme: "light" }));
    });
    await gotoAppShell(page);

    const row = page.getByTestId(`sidebar-workspace-row-${getServerId()}:${workspace.workspaceId}`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();

    await expect(row).toHaveAttribute("aria-selected", "true");
    await expect(row).toHaveCSS("background-color", "rgb(212, 212, 213)");
    await page.screenshot({
      path: testInfo.outputPath("light-selected-workspace.png"),
      fullPage: true,
    });
  } finally {
    await workspace.cleanup();
  }
});

test("keeps the selected workspace visible in Pure black", async ({ page }, testInfo) => {
  const workspace = await seedWorkspace({
    repoPrefix: "pure-black-selected-workspace-",
    title: "Selected workspace",
  });

  try {
    await page.addInitScript(() => {
      localStorage.setItem("@paseo:app-settings", JSON.stringify({ theme: "pureBlack" }));
    });
    await gotoAppShell(page);

    const row = page.getByTestId(`sidebar-workspace-row-${getServerId()}:${workspace.workspaceId}`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();

    await expect(row).toHaveAttribute("aria-selected", "true");
    await expect(row).toHaveCSS("background-color", "rgb(29, 29, 29)");
    await page.screenshot({
      path: testInfo.outputPath("pure-black-selected-workspace.png"),
      fullPage: true,
    });
  } finally {
    await workspace.cleanup();
  }
});

test("applies the interface font size to settings text", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("@paseo:app-settings", JSON.stringify({ uiBaseFontSize: 21 }));
  });
  await page.goto("/settings");
  await expect(page.getByTestId("settings-sidebar")).toBeVisible();
  await openSettingsSection(page, "appearance");

  const sectionTitle = page.getByText("Theme", { exact: true }).first();
  await expect(sectionTitle).toHaveCSS("font-size", "18px");

  const interfaceSizeInput = page.getByLabel("Interface font size");
  const contentSizeInput = page.getByLabel("Content font size");
  await expect(interfaceSizeInput).toHaveValue("21");
  await expect(contentSizeInput).toHaveValue("21");
  await interfaceSizeInput.fill("12");
  await interfaceSizeInput.press("Tab");

  await expect(interfaceSizeInput).toHaveValue("12");
  await expect(contentSizeInput).toHaveValue("21");
  await expect(sectionTitle).toHaveCSS("font-size", "10px");
});
