import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { lightTheme } from "@/styles/theme";
import { StatusBadge } from "./status-badge";

interface MountedBadge {
  root: Root;
  container: HTMLDivElement;
}

const mountedBadges: MountedBadge[] = [];

function mountBadge(variant: "success" | "warning" | "error" | "muted"): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => root.render(<StatusBadge label="Status" variant={variant} />));
  mountedBadges.push({ root, container });

  const badge = container.firstElementChild;
  if (!(badge instanceof HTMLElement)) {
    throw new Error("StatusBadge did not render a badge element");
  }
  return badge;
}

afterEach(() => {
  for (const mounted of mountedBadges.splice(0)) {
    act(() => mounted.root.unmount());
    mounted.container.remove();
  }
});

function parseColor(value: string): { rgb: string; alpha: number } {
  const channels = value.match(/[\d.]+/g)?.map(Number) ?? [];
  return { rgb: channels.slice(0, 3).join(","), alpha: channels[3] ?? 1 };
}

// The status palette is generated from one rule, so the expectation reads the token instead of
// restating a hex that a palette regeneration replaces.
function cssRgb(hex: string): string {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  return `rgb(${channels.join(", ")})`;
}

describe("StatusBadge", () => {
  it("uses the neutral badge shell for the muted variant", () => {
    const style = getComputedStyle(mountBadge("muted"));

    expect(style.backgroundColor).toBe("rgb(228, 228, 231)");
    expect(style.borderColor).toBe("rgb(228, 228, 231)");
  });

  it.each(["success", "warning", "error"] as const)(
    "fills the %s variant with a translucent tint of its own status color",
    (variant) => {
      const badge = mountBadge(variant);
      const text = badge.lastElementChild;
      if (!(text instanceof HTMLElement)) {
        throw new Error("StatusBadge did not render its label");
      }
      const fill = parseColor(getComputedStyle(badge).backgroundColor);

      expect(fill.rgb).toBe(parseColor(getComputedStyle(text).color).rgb);
      expect(fill.alpha).toBeGreaterThan(0);
      expect(fill.alpha).toBeLessThan(0.5);
    },
  );

  it.each([
    ["success", lightTheme.colors.statusSuccess],
    ["warning", lightTheme.colors.statusWarning],
    ["error", lightTheme.colors.statusDanger],
    ["muted", lightTheme.colors.foregroundMuted],
  ] as const)("uses the semantic %s signal for its text", (variant, expectedColor) => {
    const badge = mountBadge(variant);
    const text = badge.lastElementChild;
    if (!(text instanceof HTMLElement)) {
      throw new Error("StatusBadge did not render its label");
    }

    expect(getComputedStyle(text).color).toBe(cssRgb(expectedColor));
  });
});
