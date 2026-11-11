import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  AssistantFileLinkResolverProvider,
  type AssistantFileLinkResolverProviderProps,
} from "@/assistant-file-links/provider";
import { i18n } from "@/i18n/i18next";
import { WEB_RENDERERS } from "./renderers.web";

const Link = WEB_RENDERERS.link;
const LINK_TEXT = "src/index.ts";
const WORKSPACE_ROOT = "/Users/test/project";
/** A workspace where nothing matches, so every link behind it is a missing file. */
const MISSING_FILE_CLIENT: AssistantFileLinkResolverProviderProps["client"] = {
  getDirectorySuggestions: async () => ({ entries: [], error: null }),
};

let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  await i18n.changeLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function anchorPropsFor(url: string) {
  return { href: url };
}

function renderAnchor(link: { url: string; sourceType?: "markdown" | "text" | "inline-code" }) {
  if (!Link) {
    throw new Error("Expected a web link renderer");
  }
  const anchorProps = anchorPropsFor(link.url);
  act(() =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <Link link={link} anchorProps={anchorProps}>
          {LINK_TEXT}
        </Link>
      </QueryClientProvider>,
    ),
  );
  const anchor = container.querySelector("a");
  if (!anchor) {
    throw new Error("Expected a rendered link");
  }
  return anchor;
}

it("marks a link it recognized from a path so copy can unwrap it", () => {
  const anchor = renderAnchor({ url: LINK_TEXT, sourceType: "text" });
  expect(anchor.getAttribute("href")).toBe(LINK_TEXT);
  expect(anchor.getAttribute("data-paseo-markdown-recognized-link")).toBe("true");
});

it("leaves an authored link wrapped", () => {
  const anchor = renderAnchor({ url: "https://example.test/doc", sourceType: "markdown" });
  expect(anchor.hasAttribute("data-paseo-markdown-recognized-link")).toBe(false);
});

it("offers copy on right click when the file behind the link is missing", () => {
  const onCopyPath = vi.fn();
  const onOpenInEditor = vi.fn();
  const anchor = renderWorkspaceAnchor({
    link: { url: "src/missing.ts", sourceType: "inline-code" },
    onCopyPath,
    onOpenInEditor,
  });

  act(() => {
    anchor.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, clientX: 40, clientY: 60 }),
    );
  });

  const copyItem = document.querySelector('[data-testid="file-link-copy-path"]');
  expect(copyItem).not.toBeNull();
  expect(document.querySelector('[data-testid="file-link-context-menu"]')).not.toBeNull();
  expect(document.querySelector('[data-testid="file-link-open-in-editor"]')).toBeNull();

  act(() => (copyItem as HTMLElement).click());
  expect(onCopyPath).toHaveBeenCalledWith(`${WORKSPACE_ROOT}/src/missing.ts`);
  expect(onOpenInEditor).not.toHaveBeenCalled();
});

function renderWorkspaceAnchor(options: {
  link: { url: string; sourceType?: "markdown" | "text" | "inline-code" };
  onCopyPath: (path: string) => void;
  onOpenInEditor: (path: string) => void;
}) {
  if (!Link) {
    throw new Error("Expected a web link renderer");
  }
  act(() =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <AssistantFileLinkResolverProvider
          client={MISSING_FILE_CLIENT}
          serverId="server-1"
          workspaceRoot={WORKSPACE_ROOT}
          onCopyPath={options.onCopyPath}
          canOpenInEditor
          onOpenInEditor={options.onOpenInEditor}
        >
          <Link link={options.link} anchorProps={anchorPropsFor(options.link.url)}>
            {options.link.url}
          </Link>
        </AssistantFileLinkResolverProvider>
      </QueryClientProvider>,
    ),
  );
  const anchor = container.querySelector("a");
  if (!anchor) {
    throw new Error("Expected a rendered link");
  }
  return anchor;
}
