import { describe, expect, it } from "vitest";
import {
  hostSupportsFeature,
  selectHostFeature,
  selectHostFeatureAvailability,
  type HostFeatureSessionState,
} from "@/runtime/host-features";

function stateWith(serverInfo: unknown): HostFeatureSessionState {
  return { sessions: { host: { serverInfo: serverInfo as never } } };
}

describe("host feature availability", () => {
  it("reports a feature the host listed as enabled", () => {
    const state = stateWith({ features: { agentTitleGeneration: true } });
    expect(selectHostFeature(state, "host", "agentTitleGeneration")).toBe(true);
    expect(selectHostFeatureAvailability(state, "host", "agentTitleGeneration")).toBe(true);
  });

  it("separates a host that omits the feature from a host that has not reported", () => {
    const reported = stateWith({ features: {} });
    expect(selectHostFeatureAvailability(reported, "host", "agentTitleGeneration")).toBe(false);

    const unreported = stateWith(null);
    expect(selectHostFeature(unreported, "host", "agentTitleGeneration")).toBe(false);
    expect(selectHostFeatureAvailability(unreported, "host", "agentTitleGeneration")).toBeNull();

    const unknownSession: HostFeatureSessionState = { sessions: {} };
    expect(
      selectHostFeatureAvailability(unknownSession, "host", "agentTitleGeneration"),
    ).toBeNull();
  });

  it("treats a non-true feature flag as unsupported", () => {
    expect(hostSupportsFeature({ features: {} } as never, "agentTitleGeneration")).toBe(false);
    expect(hostSupportsFeature(null, "agentTitleGeneration")).toBe(false);
  });
});
