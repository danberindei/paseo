import { describe, expect, it } from "vitest";
import {
  applyClearDraftRecord,
  toDraftInputIfReady,
  editDraftRecordText,
  mergeDraftStoreStates,
  draftStatesNeedStorageRepair,
  type DraftRecord,
} from "./state";

describe("draft-store lifecycle", () => {
  it("edits text without invalidating attachment subscribers", () => {
    const draft: DraftRecord = {
      input: {
        text: "hello",
        attachments: [
          { kind: "workspace_file", path: "README.md", selection: { kind: "whole_file" } },
        ],
      },
      lifecycle: "active",
      updatedAt: 1,
      version: 1,
    };
    const edited = editDraftRecordText(draft, "hello\n", 2);
    expect(edited.input.text).toBe("hello\n");
    expect(edited.input.attachments).toBe(draft.input.attachments);
    expect(edited.version).toBe(2);
    expect(editDraftRecordText(edited, "hello\n", 3)).toBe(edited);
    expect(editDraftRecordText(edited, "", 3).lifecycle).toBe("active");
    expect(editDraftRecordText(undefined, "", 3).lifecycle).toBe("abandoned");
  });
  it("normalizes clear-with-lifecycle into a tombstone without attachments", () => {
    const cleared = applyClearDraftRecord({
      record: {
        input: {
          text: "hello",
          attachments: [
            {
              kind: "image",
              metadata: {
                id: "att-1",
                mimeType: "image/jpeg",
                storageType: "web-indexeddb",
                storageKey: "att-1",
                createdAt: 1,
              },
            },
          ],
        },
        lifecycle: "active",
        updatedAt: 1,
        version: 1,
      },
      lifecycle: "sent",
      nowMs: 2,
    });

    expect(cleared).toEqual({
      input: { text: "", attachments: [] },
      lifecycle: "sent",
      updatedAt: 2,
      version: 2,
    });
  });
});

describe("draft-store normalization", () => {
  it("preserves plugin resources when hydrating a draft", () => {
    const attachment = {
      kind: "plugin_resource" as const,
      pluginId: "linear",
      sourceId: "issues",
      sourceTitle: "Linear issue",
      sourceIcon: "CircleDot",
      item: {
        id: "issue-uuid",
        identifier: "ENG-123",
        title: "Plugin attachments",
        subtitle: "In progress",
        url: "https://linear.app/acme/issue/ENG-123/plugin-attachments",
        text: "Linear issue ENG-123: Plugin attachments",
        resourceType: "issue",
      },
    };

    expect(
      toDraftInputIfReady({
        input: { text: "Implement this", attachments: [attachment] },
        lifecycle: "active",
        updatedAt: 1,
        version: 1,
      }),
    ).toEqual({ text: "Implement this", attachments: [attachment] });
  });

  it("preserves uploaded file attachments when hydrating a draft", () => {
    const attachment = {
      kind: "file" as const,
      attachment: {
        type: "uploaded_file" as const,
        id: "file-1",
        fileName: "context.json",
        mimeType: "application/json",
        size: 42,
        path: "/tmp/context.json",
      },
    };

    expect(
      toDraftInputIfReady({
        input: { text: "Review this", attachments: [attachment] },
        lifecycle: "active",
        updatedAt: 1,
        version: 1,
      }),
    ).toEqual({ text: "Review this", attachments: [attachment] });
  });

  it("preserves workspace file selections when hydrating a draft", () => {
    const attachment = {
      kind: "workspace_file" as const,
      path: "src/app.ts",
      selection: { kind: "line_range" as const, startLine: 12, endLine: 24 },
    };

    expect(
      toDraftInputIfReady({
        input: { text: "Review this", attachments: [attachment] },
        lifecycle: "active",
        updatedAt: 1,
        version: 1,
      }),
    ).toEqual({ text: "Review this", attachments: [attachment] });
  });

  it("preserves New Workspace picker ownership when hydrating a draft", () => {
    const pickerAttachment = {
      kind: "github_pr" as const,
      owner: "new-workspace-picker" as const,
      item: {
        kind: "change_request" as const,
        number: 202,
        title: "Persist picker ownership",
        url: "https://example.com/pull/202",
        state: "open" as const,
        body: null,
        labels: [],
        baseRefName: "main",
        headRefName: "feature/picker-ownership",
      },
    };

    expect(
      toDraftInputIfReady({
        input: { text: "Keep this prompt", attachments: [pickerAttachment] },
        lifecycle: "active",
        updatedAt: 1,
        version: 1,
      }),
    ).toEqual({
      text: "Keep this prompt",
      attachments: [pickerAttachment],
    });
  });
});

describe("draft store cross-window merge", () => {
  function draftRecord(overrides: Partial<DraftRecord> & { version: number }): DraftRecord {
    return {
      input: { text: "draft", attachments: [] },
      lifecycle: "active",
      updatedAt: 1,
      ...overrides,
    };
  }

  it("accepts a new draft after a finalized record", () => {
    const closed = draftRecord({
      lifecycle: "sent",
      input: { text: "", attachments: [] },
      updatedAt: 20,
      version: 5,
    });
    const edited = editDraftRecordText(closed, "new prompt", closed.updatedAt + 1);
    const current = { drafts: { draftKey: edited }, createModalDraft: null };
    const incoming = { drafts: { draftKey: closed }, createModalDraft: null };

    expect(edited.version).toBe(6);
    expect(mergeDraftStoreStates({ current, incoming }).drafts.draftKey).toBe(edited);
    expect(mergeDraftStoreStates({ current: incoming, incoming: current }).drafts.draftKey).toBe(
      edited,
    );
  });

  it("repairs an old active snapshot with a retained finalized tombstone", () => {
    const closed = draftRecord({
      lifecycle: "abandoned",
      input: { text: "", attachments: [] },
      updatedAt: 10_000_000,
      version: 3,
    });
    const stale = draftRecord({ updatedAt: 9_000_000, version: 2 });
    const current = { drafts: { draftKey: closed }, createModalDraft: null };
    const incoming = { drafts: { draftKey: stale }, createModalDraft: null };

    const merged = mergeDraftStoreStates({ current, incoming });

    expect(merged.drafts.draftKey).toBe(closed);
    expect(draftStatesNeedStorageRepair(current, incoming)).toBe(true);
  });

  it("adopts a record only the other window has", () => {
    const incomingRecord = draftRecord({ version: 1 });

    const merged = mergeDraftStoreStates({
      current: { drafts: {}, createModalDraft: null },
      incoming: { drafts: { draftKey: incomingRecord }, createModalDraft: null },
    });

    expect(merged.drafts.draftKey).toBe(incomingRecord);
  });

  it("returns the current state reference when the merge changes nothing", () => {
    const current = { drafts: { draftKey: draftRecord({ version: 1 }) }, createModalDraft: null };

    expect(
      mergeDraftStoreStates({ current, incoming: { drafts: {}, createModalDraft: null } }),
    ).toBe(current);
  });

  it("does not restore a modal draft the other window cleared", () => {
    const current = { drafts: {}, createModalDraft: null };

    const merged = mergeDraftStoreStates({
      current,
      incoming: { drafts: {}, createModalDraft: draftRecord({ version: 4 }) },
    });

    expect(merged.createModalDraft).toBeNull();
    expect(merged).toBe(current);
  });

  it("does not repair storage for modal-only disagreements", () => {
    const withModal = { drafts: {}, createModalDraft: draftRecord({ version: 4 }) };
    const withoutModal = { drafts: {}, createModalDraft: null };

    expect(draftStatesNeedStorageRepair(withModal, withoutModal)).toBe(false);
    expect(draftStatesNeedStorageRepair(withoutModal, withModal)).toBe(false);
    expect(mergeDraftStoreStates({ current: withModal, incoming: withoutModal })).toBe(withModal);
    expect(mergeDraftStoreStates({ current: withoutModal, incoming: withModal })).toBe(
      withoutModal,
    );
  });

  it("repairs stale keyed drafts even when modal values disagree", () => {
    const stale = draftRecord({ version: 2, updatedAt: 20 });
    const closed = draftRecord({
      version: 3,
      updatedAt: 30,
      lifecycle: "removed",
      input: { text: "", attachments: [] },
    });
    const current = { drafts: { draftKey: closed }, createModalDraft: null };
    const incoming = { drafts: { draftKey: stale }, createModalDraft: stale };

    expect(mergeDraftStoreStates({ current, incoming })).toBe(current);
    expect(draftStatesNeedStorageRepair(current, incoming)).toBe(true);
    expect(
      draftStatesNeedStorageRepair(current, {
        drafts: { draftKey: { ...closed } },
        createModalDraft: stale,
      }),
    ).toBe(false);
  });
});
