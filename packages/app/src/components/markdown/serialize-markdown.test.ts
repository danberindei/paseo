import { describe, expect, it } from "vitest";
import { parseMarkdown } from "react-native-enriched-markdown/src/web/parseMarkdown";
import { recognizeTextLinks } from "react-native-enriched-markdown/src/web/recognizeTextLinks";
import type { ASTNode } from "react-native-enriched-markdown/src/web/types";
import { prepareMarkdownSource } from "./source";
import { astNodesToMarkdown, astNodesToMarkdownPlain } from "./serialize-markdown";

// Copy must serialize the AST the chat actually renders, so keep these flags in
// step with MD4C_FLAGS in renderer.tsx.
const MD4C_FLAGS = { latexMath: false, hardSoftBreaks: true, admonitions: true };

async function blockquoteOf(markdown: string): Promise<ASTNode> {
  const tree = await parseMarkdown(markdown, MD4C_FLAGS);
  const blockquote = tree.children?.find((node: ASTNode) => node.type === "Blockquote");
  if (!blockquote) throw new Error("expected a blockquote node");
  return blockquote;
}

async function serializeBlockquote(markdown: string): Promise<string> {
  const blockquote = await blockquoteOf(markdown);
  return astNodesToMarkdown(blockquote.children ?? []);
}

async function serializeBlockquotePlain(markdown: string): Promise<string> {
  const blockquote = await blockquoteOf(markdown);
  return astNodesToMarkdownPlain(blockquote.children ?? []);
}

interface ImageAdaptation {
  urls?: ReadonlyMap<string, string>;
  unavailable?: ReadonlySet<string>;
  pending?: ReadonlySet<string>;
}

async function serializeAdaptedBlockquote(
  source: string,
  adaptation: ImageAdaptation = {},
): Promise<string> {
  const prepared = prepareMarkdownSource(source, undefined, { supportsSvg: true });
  const adapted = prepared.render(adaptation.urls, adaptation.unavailable, adaptation.pending);
  return serializeBlockquote(adapted);
}

describe("astNodesToMarkdown", () => {
  it("copies prose punctuation and inline code without extra escapes", async () => {
    const text =
      "@Handi no, `log_call_entry` doesn't take a `project_id` param. For calls placed through `/outbound-vai`, the server already uses the `project_id` the reminder workflow sends when it places the call, so the bot doesn't need to pass it.";

    expect(await serializeBlockquote(`> ${text}`)).toBe(text);
  });

  it("leaves underscores that cannot form emphasis alone in the plain flavor", async () => {
    const text = "Set max_retries and snake_case before the handler runs.";

    expect(await serializeBlockquotePlain(`> ${text}`)).toBe(text);
  });

  it("escapes paired underscores in literal text so they stay literal", async () => {
    const source = String.raw`> literal \_word\_ stays literal`;
    const copied = await serializeBlockquote(source);

    expect(copied).toBe(String.raw`literal \_word\_ stays literal`);
    const parsed = await parseMarkdown(copied, MD4C_FLAGS);
    expect(parsed.children).toEqual((await blockquoteOf(source)).children);
    // text/plain carries the text as displayed: the backslashes are gone.
    expect(await serializeBlockquotePlain(source)).toBe("literal _word_ stays literal");
  });

  it.each([
    { source: "> ```\n> ```", text: "" },
    { source: "> ```\n> code\n> ```", text: "code\n" },
    { source: "> ````\n> ```\n> code\n>\n>\n> ````", text: "```\ncode\n\n\n" },
  ])("preserves parsed fenced code text: $text", async ({ source, text }) => {
    const original = (await blockquoteOf(source)).children?.[0];
    expect(original?.type).toBe("CodeBlock");
    expect((original?.children ?? []).map((child) => child.content ?? "").join("")).toBe(text);

    const copied = await serializeBlockquote(source);
    const parsed = await parseMarkdown(copied, MD4C_FLAGS);
    const code = parsed.children?.[0];
    expect(code?.type).toBe("CodeBlock");
    expect((code?.children ?? []).map((child) => child.content ?? "").join("")).toBe(text);
  });

  it("puts the closing fence on a new line when code text has no final newline", () => {
    expect(astNodesToMarkdown([{ type: "CodeBlock", content: "code" }])).toBe("```\ncode\n```");
  });
  it("keeps inline code, a fenced block, and prose separated", async () => {
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

    expect(await serializeBlockquote(source)).toBe(
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

  it("preserves inline emphasis, strong, and links", async () => {
    const source = "> See **bold**, _italic_, and [docs](file:///x).";

    expect(await serializeBlockquote(source)).toBe(
      "See **bold**, _italic_, and [docs](file:///x).",
    );
  });

  it("preserves literal Markdown punctuation", async () => {
    const source = String.raw`> \*word\* and \[label\]\(url\) and \# heading`;
    expect(await serializeBlockquote(source)).toBe(
      String.raw`\*word\* and \[label\](url) and # heading`,
    );
  });

  it.each([
    String.raw`\# heading`,
    String.raw`\+ item`,
    String.raw`\- item`,
    String.raw`1\. item`,
    String.raw`2\) item`,
    String.raw`\---`,
    String.raw`\-- -`,
    String.raw`\===`,
  ])("keeps literal block markers as prose: %s", async (literal) => {
    const source = `> Before\n> ${literal}`;
    const original = await blockquoteOf(source);
    const copied = await serializeBlockquote(source);
    const parsed = await parseMarkdown(copied, MD4C_FLAGS);

    expect(parsed.children).toEqual(original.children);
  });

  it("preserves literal entities, HTML, backslashes, and inline Markdown", async () => {
    const source = String.raw`> \&amp; \&#64; \&#x40; \<b\> \<https://example.com\> C:\\temp\\file \~\~text\~\~ \_word\_ a\|b`;
    const original = await blockquoteOf(source);
    const copied = await serializeBlockquote(source);
    const parsed = await parseMarkdown(copied, MD4C_FLAGS);

    expect(parsed.children).toEqual(original.children);
  });

  it("preserves a literal trailing hash in a heading", async () => {
    const source = String.raw`> # Release \#`;
    const original = await blockquoteOf(source);
    const copied = await serializeBlockquote(source);
    const parsed = await parseMarkdown(copied, MD4C_FLAGS);

    expect(parsed.children).toEqual(original.children);
  });

  it("preserves backticks and edge spaces in inline code", async () => {
    const source = "> `` a ` b `` and ``` ``x`` ``` and `  spaced  `";
    expect(await serializeBlockquote(source)).toBe("``a ` b`` and ``` ``x`` ``` and `  spaced  `");
  });

  it("uses a longer fence for code containing backtick fences", async () => {
    const source = ["> ````js", "> ```", "> code", "> ````"].join("\n");
    expect(await serializeBlockquote(source)).toBe(["````js", "```", "code", "````"].join("\n"));
  });

  it("serializes bullet and ordered lists", async () => {
    const source = ["> - one", "> - two", ">", "> 1. first", "> 2. second"].join("\n");

    expect(await serializeBlockquote(source)).toBe(
      ["- one\n- two", "1. first\n2. second"].join("\n\n"),
    );
  });

  it("keeps a nested quote nested", async () => {
    const source = ["> Outer", ">", "> > Inner"].join("\n");

    expect(await serializeBlockquote(source)).toBe("Outer\n\n> Inner");
  });

  it("keeps a line break inside a quoted paragraph", async () => {
    expect(await serializeBlockquote("> one\n> two")).toBe("one\ntwo");
  });

  it("copies a recognized path as the text the author wrote", async () => {
    const blockquote = await blockquoteOf("> Edited `src/index.tsx` and src/app.tsx by hand.");
    const recognized = recognizeTextLinks(
      blockquote,
      /src\/[\w./-]+\.tsx?/g,
      /^src\/[\w./-]+\.tsx?$/,
    );

    expect(astNodesToMarkdown(recognized.children ?? [])).toBe(
      "Edited `src/index.tsx` and src/app.tsx by hand.",
    );
  });

  it("copies a resolved workspace image as its alt text", async () => {
    const urls = new Map([["./screens/shot.png", "blob:http://localhost/abc"]]);

    expect(await serializeAdaptedBlockquote("> ![shot](./screens/shot.png)", { urls })).toBe(
      "shot",
    );
  });

  it("copies an external image as its alt text", async () => {
    expect(await serializeAdaptedBlockquote("> ![diagram](https://example.com/diagram.png)")).toBe(
      "diagram",
    );
  });

  it("copies a pending image as its alt text", async () => {
    const pending = new Set(["./screens/waiting.png"]);

    expect(
      await serializeAdaptedBlockquote("> ![waiting](./screens/waiting.png)", { pending }),
    ).toBe("waiting");
  });

  it("copies unavailable image markup as its alt text", async () => {
    const unavailable = new Set(["./screens/missing.png"]);

    expect(
      await serializeAdaptedBlockquote("> ![missing shot](./screens/missing.png)", { unavailable }),
    ).toBe("missing shot");
  });

  it("copies nothing for an image with empty alt text", async () => {
    const urls = new Map([["./screens/shot.png", "blob:http://localhost/abc"]]);

    expect(await serializeAdaptedBlockquote("> ![](./screens/shot.png)", { urls })).toBe("");
  });

  it("escapes punctuation in alt text so it stays literal", async () => {
    const urls = new Map([["./screens/shot.png", "blob:http://localhost/abc"]]);
    const source = String.raw`> ![see \[docs\] & (notes)](./screens/shot.png)`;

    expect(await serializeAdaptedBlockquote(source, { urls })).toBe(
      String.raw`see \[docs\] & (notes)`,
    );
  });

  it("copies repeated alt text in nested quotes", async () => {
    const source = ["> ![same](./a.png)", ">", "> > ![same](./b.png)"].join("\n");
    const urls = new Map([
      ["./a.png", "blob:http://localhost/a"],
      ["./b.png", "blob:http://localhost/b"],
    ]);

    expect(await serializeAdaptedBlockquote(source, { urls })).toBe("same\n\n> same");
  });
});
