/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { definePanel, registerPanel, usePanelRegistration } from "@/panels/panel-registry";

const terminalRegistration = definePanel("terminal", {
  component: () => null,
  presentation: {
    label: () => "Terminal",
    subtitle: () => "",
    tooltip: () => "",
    icon: () => null,
  },
});

describe("panel registry readers", () => {
  it("re-renders a reader that mounted before the panels registered", async () => {
    const { result } = renderHook(() => usePanelRegistration("terminal"));
    expect(result.current).toBeUndefined();

    await act(async () => {
      registerPanel(terminalRegistration);
    });

    expect(result.current).toBe(terminalRegistration);
  });

  it("resolves no registration without a kind", () => {
    const { result } = renderHook(() => usePanelRegistration(null));
    expect(result.current).toBeUndefined();
  });
});
