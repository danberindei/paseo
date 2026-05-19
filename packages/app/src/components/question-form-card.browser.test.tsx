import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { within } from "@testing-library/dom";
import type { AgentPermissionResponse } from "@getpaseo/protocol/agent-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n as testI18n } from "@/i18n/i18next";
import type { PendingPermission } from "@/types/shared";
import { QuestionFormCard } from "./question-form-card";

// Load translations so controls expose their real accessible names.
void testI18n;

// The Markdown engine does not load in this harness; question and option text are covered by
// e2e/browser/question-prompt-pagination.spec.ts. Plain text keeps these tests on the answers.
vi.mock("@/components/markdown/renderer", () => ({
  MarkdownRenderer: ({ text }: { text: string }) => <span>{text}</span>,
}));

// App sources compile against the classic JSX runtime, which expects React on the global.
beforeEach(() => vi.stubGlobal("React", React));

/**
 * A real browser with the real web `EditingTextInput`, because the bug under test lives in the
 * gap between that input and React state: the input owns its text and never replays state, so a
 * card that drops the Other text from state alone keeps showing it while submit ignores it.
 */

interface Mounted {
  root: Root;
  container: HTMLDivElement;
}

const mounted: Mounted[] = [];

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});

function buildPermission(questions: Record<string, unknown>[]): PendingPermission {
  return {
    key: "perm-1",
    agentId: "agent-1",
    request: {
      id: "perm-1",
      provider: "claude",
      name: "AskUserQuestion",
      kind: "question",
      input: { questions },
    },
  };
}

function createShortcutRegistry() {
  const respondingKeys = new Set<string>();
  const shortcutTargets = new Map<
    string,
    Parameters<React.ComponentProps<typeof QuestionFormCard>["registerShortcutTarget"]>[1]
  >();
  const registerShortcutTarget: React.ComponentProps<
    typeof QuestionFormCard
  >["registerShortcutTarget"] = (key, actions) => {
    shortcutTargets.set(key, actions);
    return () => {
      if (shortcutTargets.get(key) === actions) shortcutTargets.delete(key);
    };
  };
  return { registerShortcutTarget, respondingKeys, shortcutTargets };
}

function mountCard(questionOrQuestions: Record<string, unknown> | Record<string, unknown>[]) {
  const questions = Array.isArray(questionOrQuestions)
    ? questionOrQuestions
    : [questionOrQuestions];
  const onRespond = vi.fn<(response: AgentPermissionResponse) => void>();
  const shortcutRegistry = createShortcutRegistry();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let respondingActionId: "submit" | "dismiss" | null = null;
  const handleRespond = vi.fn(
    (response: AgentPermissionResponse, actionId: "submit" | "dismiss") => {
      onRespond(response);
      shortcutRegistry.respondingKeys.add("perm-1");
      render(actionId);
    },
  );
  const render = (actionId: "submit" | "dismiss" | null = respondingActionId) => {
    respondingActionId = actionId;
    act(() =>
      root.render(
        <QuestionFormCard
          permission={buildPermission(questions)}
          onRespond={handleRespond}
          isResponding={respondingActionId !== null}
          respondingActionId={respondingActionId}
          isShortcutTarget={true}
          isShortcutOwner={true}
          registerShortcutTarget={shortcutRegistry.registerShortcutTarget}
          responseError={null}
        />,
      ),
    );
  };
  render();
  mounted.push({ root, container });

  const view = within(container);
  const otherInput = (questionText = String(questions[0].question)) =>
    view.getByRole<HTMLInputElement>("textbox", { name: questionText });
  const check = (label: string) =>
    act(() =>
      (
        view.queryByRole("checkbox", { name: label }) ?? view.getByRole("radio", { name: label })
      ).click(),
    );
  const type = (text: string, questionText?: string) => {
    const input = otherInput(questionText);
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!valueSetter) throw new Error("HTML input value setter is unavailable");
    act(() => {
      valueSetter.call(input, text);
      input.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
    });
  };
  const submit = () => act(() => view.getByRole("button", { name: "Submit" }).click());
  const pressArrow = (key: "ArrowUp" | "ArrowDown") => {
    const target = document.activeElement;
    if (!target || !container.contains(target)) throw new Error("card has no focused target");
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    act(() => target.dispatchEvent(event));
    return event;
  };
  const pressCardArrow = (key: "ArrowUp" | "ArrowDown") => {
    const card = view.getByTestId("question-form-card");
    act(() => card.focus());
    return pressArrow(key);
  };
  const focusShortcutTarget = () => {
    const target = shortcutRegistry.shortcutTargets.get("perm-1");
    if (!target) throw new Error("shortcut target was not registered");
    act(() => target.focus());
  };
  const submittedAnswers = (): Record<string, string> => {
    const response = onRespond.mock.calls[0]?.[0];
    if (!response || response.behavior !== "allow") throw new Error("card did not submit");
    return (response.updatedInput as { answers: Record<string, string> }).answers;
  };
  return {
    check,
    type,
    otherInput,
    submit,
    pressArrow,
    pressCardArrow,
    focusShortcutTarget,
    submittedAnswers,
    render,
    onRespond,
    respondingKeys: shortcutRegistry.respondingKeys,
    view,
  };
}

const multiSelectQuestion = {
  question: "Which fruits do you like?",
  header: "Fruits",
  options: [{ label: "Apple" }, { label: "Banana" }, { label: "Cherry" }],
  multiSelect: true,
  allowOther: true,
};

const singleSelectQuestion = {
  question: "Which provider?",
  header: "Provider",
  options: [{ label: "Claude Code" }, { label: "Codex" }],
  multiSelect: false,
  allowOther: true,
};

describe("QuestionFormCard other answers", () => {
  it("clears the dismiss spinner and enables dismissal again after a failure reset", () => {
    const card = mountCard(singleSelectQuestion);
    const dismiss = card.view.getByRole("button", { name: "Dismiss" });
    act(() => dismiss.click());
    expect(card.view.getAllByRole("progressbar")).toHaveLength(1);
    expect(dismiss.getAttribute("aria-disabled")).toBe("true");
    act(() => dismiss.click());
    expect(card.onRespond).toHaveBeenCalledTimes(1);

    card.render(null);
    expect(card.view.queryByRole("progressbar")).toBeNull();
    expect(dismiss.getAttribute("aria-disabled")).not.toBe("true");
    act(() => dismiss.click());
    expect(card.onRespond.mock.calls.map(([response]) => response)).toEqual([
      { behavior: "deny", message: "Dismissed by user" },
      { behavior: "deny", message: "Dismissed by user" },
    ]);
  });

  it("clears the submit spinner and restores focused shortcuts after a failure reset", () => {
    const card = mountCard(singleSelectQuestion);
    card.check("Claude Code");
    card.submit();
    expect(card.view.getAllByRole("progressbar")).toHaveLength(1);
    expect(
      card.view.getByTestId("question-form-primary-action").getAttribute("aria-disabled"),
    ).toBe("true");

    card.render(null);
    expect(card.view.queryByRole("progressbar")).toBeNull();
    expect(
      card.view.getByRole("button", { name: "Submit" }).getAttribute("aria-disabled"),
    ).not.toBe("true");
    card.focusShortcutTarget();
    expect(card.pressArrow("ArrowDown").defaultPrevented).toBe(true);
    expect(card.view.getByRole("radio", { name: "Codex" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(document.activeElement).toBe(card.view.getByRole("radio", { name: "Codex" }));
    card.submit();
    expect(card.onRespond.mock.calls.map(([response]) => response)).toEqual([
      {
        behavior: "allow",
        updatedInput: { questions: [singleSelectQuestion], answers: { Provider: "Claude Code" } },
      },
      {
        behavior: "allow",
        updatedInput: { questions: [singleSelectQuestion], answers: { Provider: "Codex" } },
      },
    ]);
  });

  it("keeps checked options when the other answer is typed afterwards (multi-select)", () => {
    const card = mountCard(multiSelectQuestion);

    const apple = card.view.getByRole("checkbox", { name: "Apple" });
    expect(apple.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(apple);
    card.check("Cherry");
    card.type("durian");
    card.submit();

    expect(card.submittedAnswers()).toEqual({ Fruits: "Apple, Cherry, durian" });
    expect(card.respondingKeys).toEqual(new Set(["perm-1"]));
  });

  it("keeps the typed other answer when options are checked afterwards (multi-select)", () => {
    const card = mountCard(multiSelectQuestion);

    card.type("durian");
    card.check("Banana");

    expect(card.otherInput().value).toBe("durian");
    card.submit();
    expect(card.submittedAnswers()).toEqual({ Fruits: "Apple, Banana, durian" });
  });

  it("replaces the selected option with the typed other answer (single-select)", () => {
    const card = mountCard(singleSelectQuestion);

    card.check("Codex");
    card.type("OpenCode");
    card.submit();

    expect(card.submittedAnswers()).toEqual({ Provider: "OpenCode" });
  });

  it("clears the typed other answer on screen when an option is picked afterwards (single-select)", () => {
    const card = mountCard(singleSelectQuestion);

    card.type("OpenCode");
    card.check("Codex");

    expect(card.otherInput().value).toBe("");
    card.submit();
    expect(card.submittedAnswers()).toEqual({ Provider: "Codex" });
  });

  it("keeps the preselected first radio selected when activated and advances on Next", () => {
    const card = mountCard([
      singleSelectQuestion,
      {
        question: "Which second provider?",
        header: "Second provider",
        options: [{ label: "Pi" }, { label: "OpenCode" }],
        multiSelect: false,
      },
    ]);

    const firstOption = card.view.getByRole("radio", { name: "Claude Code" });
    expect(firstOption.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(firstOption);
    card.check("Claude Code");
    // The card keeps a picked option on screen until Next, so advancing is an explicit step.
    act(() => card.view.getByRole("button", { name: "Next" }).click());
    expect(card.view.getByTestId("question-form-current-question").textContent).toBe(
      "Which second provider?",
    );
    expect(card.view.getByRole("radio", { name: "Pi" }).getAttribute("aria-checked")).toBe("true");
    card.submit();
    expect(card.submittedAnswers()).toEqual({ Provider: "Claude Code", "Second provider": "Pi" });
  });

  it("navigates options in the active single-select question", () => {
    const card = mountCard([
      singleSelectQuestion,
      {
        question: "Which second provider?",
        header: "Second provider",
        options: [{ label: "Pi" }, { label: "OpenCode" }, { label: "Claude Code" }],
        multiSelect: false,
        allowOther: true,
      },
    ]);

    card.check("Codex");
    act(() => card.view.getByRole("button", { name: "Next" }).click());
    expect(card.view.getByTestId("question-form-current-question").textContent).toBe(
      "Which second provider?",
    );
    const firstSecondOption = card.view.getByRole("radio", { name: "Pi" });
    expect(firstSecondOption.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(firstSecondOption);
    expect(card.pressArrow("ArrowDown").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(card.view.getByRole("radio", { name: "OpenCode" }));
    expect(card.pressArrow("ArrowUp").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(firstSecondOption);
    card.check("OpenCode");
    card.focusShortcutTarget();
    expect(document.activeElement).toBe(card.view.getByRole("radio", { name: "OpenCode" }));
    card.type("Custom", "Which second provider?");
    const otherInput = card.otherInput("Which second provider?");
    act(() => otherInput.focus());
    expect(card.pressArrow("ArrowDown").defaultPrevented).toBe(false);
    expect(otherInput.value).toBe("Custom");
    card.focusShortcutTarget();
    expect(document.activeElement).toBe(firstSecondOption);
    expect(card.pressArrow("ArrowDown").defaultPrevented).toBe(true);
    expect(firstSecondOption.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(firstSecondOption);
    expect(card.otherInput("Which second provider?").value).toBe("");
    card.submit();
    expect(card.submittedAnswers()).toEqual({ Provider: "Codex", "Second provider": "Pi" });
  });

  it("keeps multi-select options and Other text when card arrows are pressed", () => {
    const card = mountCard(multiSelectQuestion);

    expect(card.view.getByRole("checkbox", { name: "Apple" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    card.type("durian");
    expect(card.pressCardArrow("ArrowDown").defaultPrevented).toBe(false);
    expect(card.pressCardArrow("ArrowUp").defaultPrevented).toBe(false);
    expect(card.view.getByRole("checkbox", { name: "Apple" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(card.otherInput().value).toBe("durian");
    card.submit();
    expect(card.submittedAnswers()).toEqual({ Fruits: "Apple, durian" });
  });
});

describe("QuestionFormCard explicit navigation", () => {
  it("keeps a picked option visible until Next and submits only on Submit", () => {
    const card = mountCard([singleSelectQuestion, multiSelectQuestion]);
    card.check("Codex");
    expect(card.view.getByRole("radio", { name: "Codex" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(card.onRespond).not.toHaveBeenCalled();
    act(() => card.view.getByRole("button", { name: "Next" }).click());
    // The first multi-select option starts checked, so picking another one adds to it.
    card.check("Banana");
    expect(card.onRespond).not.toHaveBeenCalled();
    card.submit();
    expect(card.submittedAnswers()).toEqual({ Provider: "Codex", Fruits: "Apple, Banana" });
  });

  it("selects an option when its description is clicked without submitting", () => {
    const card = mountCard({
      ...singleSelectQuestion,
      options: [{ label: "Codex", description: "Use this provider" }],
    });
    act(() => card.view.getByText("Use this provider").click());
    expect(card.view.getByRole("radio", { name: "Codex" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(card.onRespond).not.toHaveBeenCalled();
  });
});
