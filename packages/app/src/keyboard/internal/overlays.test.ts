import { describe, expect, it } from "vitest";
import { createOverlayRegistry } from "./overlays";

function keyEvent(key: string) {
  return {
    key,
    code: key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    preventDefault() {},
    stopPropagation() {},
  };
}

describe("overlay keyboard ownership", () => {
  it("offers a key only to the highest layer and consumes it once without DOM focus", () => {
    const registry = createOverlayRegistry();
    const calls: string[] = [];
    const remove = registry.register({
      getLayer: () => 20,
      getKeys: () => ["Escape"],
      onKeyDown: (event) => {
        calls.push(`modal:${event.key}`);
        return true;
      },
    });
    const removeMenu = registry.register({
      getLayer: () => 30,
      getKeys: () => ["Enter"],
      onKeyDown: (event) => {
        calls.push(`menu:${event.key}`);
        return event.key === "Enter";
      },
    });
    expect(registry.dispatch(keyEvent("Escape"))).toBe(false);
    expect(calls).toEqual(["menu:Escape"]);
    expect(registry.getKeys()).toEqual(["Enter"]);
    removeMenu();
    expect(registry.dispatch(keyEvent("Escape"))).toBe(true);
    expect(calls).toEqual(["menu:Escape", "modal:Escape"]);
    remove();
    expect(registry.dispatch(keyEvent("Escape"))).toBe(false);
  });
});

describe("overlay registration lifecycle", () => {
  it("uses the newest registration at equal layers and ignores composition", () => {
    const registry = createOverlayRegistry();
    const calls: string[] = [];
    const first = registry.register({
      getLayer: () => 20,
      getKeys: () => ["Escape"],
      onKeyDown: () => {
        calls.push("first");
        return true;
      },
    });
    const second = registry.register({
      getLayer: () => 20,
      getKeys: () => ["Enter"],
      onKeyDown: () => {
        calls.push("second");
        return true;
      },
    });
    expect(registry.dispatch({ ...keyEvent("Enter"), isComposing: true })).toBe(false);
    expect(calls).toEqual([]);
    expect(registry.dispatch(keyEvent("Enter"))).toBe(true);
    expect(calls).toEqual(["second"]);
    second();
    expect(registry.dispatch(keyEvent("Escape"))).toBe(true);
    expect(calls).toEqual(["second", "first"]);
    first();
  });

  it("notifies subscribers when top key ownership changes", () => {
    const registry = createOverlayRegistry();
    const observed: string[][] = [];
    const unsubscribe = registry.subscribe(() => observed.push([...registry.getKeys()]));
    const release = registry.register({
      getLayer: () => 20,
      getKeys: () => ["Enter"],
      onKeyDown: () => false,
    });
    release();
    release();
    unsubscribe();
    expect(observed).toEqual([["Enter"], []]);
  });
});

describe("presentation ownership", () => {
  it("orders sheets and overlays by layer, newest first on a tie, independently of key dispatch", () => {
    const registry = createOverlayRegistry();
    const removeSheet = registry.registerPresentation({
      getLayer: () => 20,
      getWorkspaceKey: () => "server:workspace",
      getHostedTabId: () => "sheet",
    });
    const snapshot = registry.getPresentationOwnerSnapshot("server:workspace").split("\u0000");
    expect(snapshot).toHaveLength(2);
    expect(snapshot[0]).toMatch(/^\d+$/);
    expect(snapshot[1]).toBe("sheet");
    expect(registry.getPresentationOwner("server:workspace")).toEqual({ hostedTabId: "sheet" });
    expect(registry.getKeys()).toEqual([]);
    expect(registry.dispatch(keyEvent("Escape"))).toBe(false);

    const removeOverlay = registry.registerPresentation({ getLayer: () => 30 });
    expect(registry.getPresentationOwner("server:workspace")).toEqual({ hostedTabId: null });
    expect(registry.getTopPresentationLayer()).toBe(30);

    removeOverlay();
    expect(registry.getPresentationOwner("server:workspace")).toEqual({ hostedTabId: "sheet" });

    const removeTopSheet = registry.registerPresentation({
      getLayer: () => 20,
      getWorkspaceKey: () => "server:workspace",
      getHostedTabId: () => "top",
    });
    expect(registry.getPresentationOwner("server:workspace")).toEqual({ hostedTabId: "top" });

    removeTopSheet();
    removeSheet();
    expect(registry.getPresentationOwner("server:workspace")).toBeNull();
    expect(registry.getPresentationOwnerSnapshot("server:workspace")).toBe("");
  });

  it("matches global presentations for every workspace and ignores another workspace's sheet", () => {
    const registry = createOverlayRegistry();
    const removeOther = registry.registerPresentation({
      getLayer: () => 20,
      getWorkspaceKey: () => "server:other",
      getHostedTabId: () => "other",
    });
    expect(registry.getPresentationOwner("server:workspace")).toBeNull();

    const removeGlobal = registry.registerPresentation({ getLayer: () => 10 });
    expect(registry.getPresentationOwner("server:workspace")).toEqual({ hostedTabId: null });
    expect(registry.getPresentationOwner("server:other")).toEqual({ hostedTabId: "other" });

    removeGlobal();
    removeOther();
  });

  it("parses a snapshot without confusing an empty hosted tab with no presentation", () => {
    const registry = createOverlayRegistry();
    expect(registry.parsePresentationOwnerSnapshot("")).toBeNull();
    expect(registry.parsePresentationOwnerSnapshot("7\u0000")).toEqual({ hostedTabId: null });
    expect(registry.parsePresentationOwnerSnapshot("7\u0000tab")).toEqual({ hostedTabId: "tab" });
  });
});
