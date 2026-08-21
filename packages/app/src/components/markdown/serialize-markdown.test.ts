import { describe, expect, it } from "vitest";
import type { ASTNode } from "react-native-markdown-display";
// The package entry ships JSX that the vitest transform rejects, so pull the
// pure parsing helpers from their source paths, which have no type declarations.
// @ts-expect-error no declaration file for this deep import
import { stringToTokens } from "react-native-markdown-display/src/lib/util/stringToTokens";
// @ts-expect-error no declaration file for this deep import
import tokensToAST from "react-native-markdown-display/src/lib/util/tokensToAST";
import { createAssistantMarkdownParser } from "@/utils/assistant-markdown-parser";
import { astNodesToMarkdown } from "./serialize-markdown";

function serializeBlockquote(markdown: string): string {
  const parser = createAssistantMarkdownParser();
  const ast: ASTNode[] = tokensToAST(stringToTokens(markdown, parser));
  const blockquote = ast.find((node) => node.type === "blockquote");
  if (!blockquote) throw new Error("expected a blockquote node");
  return astNodesToMarkdown(blockquote.children);
}

describe("astNodesToMarkdown", () => {
  it("keeps inline code, a fenced block, and prose separated", () => {
    const source = [
      "> `length` === 0 misses the fields:",
      ">",
      "> ```js",
      "> if (x) {",
      ">   return;",
      "> }",
      "> ```",
      ">",
      "> Manual pass.",
    ].join("\n");

    expect(serializeBlockquote(source)).toBe(
      [
        "`length` === 0 misses the fields:",
        "",
        "```js",
        "if (x) {",
        "  return;",
        "}",
        "```",
        "",
        "Manual pass.",
      ].join("\n"),
    );
  });

  it("preserves inline emphasis, strong, and links", () => {
    const source = "> See **bold**, _italic_, and [docs](file:///x).";

    expect(serializeBlockquote(source)).toBe("See **bold**, _italic_, and [docs](file:///x).");
  });

  it("serializes bullet and ordered lists", () => {
    const source = ["> - one", "> - two", ">", "> 1. first", "> 2. second"].join("\n");

    expect(serializeBlockquote(source)).toBe(["- one\n- two", "1. first\n2. second"].join("\n\n"));
  });
});
