import type { MarkdownNode } from "react-native-enriched-markdown";

export function astNodesToMarkdown(nodes: MarkdownNode[]): string {
  return serializeBlocks(nodes).trim();
}

function serializeBlocks(nodes: MarkdownNode[]): string {
  return nodes
    .map(serializeBlockNode)
    .filter((block) => block.length > 0)
    .join("\n\n");
}

function serializeBlockNode(node: MarkdownNode): string {
  switch (node.type) {
    case "Heading": {
      const content = serializeInline(node.children ?? []);
      const heading = content.replace(/(^|[ \t])(#+)([ \t]*)$/, "$1\\$2$3");
      return `${"#".repeat(headingLevel(node))} ${heading}`;
    }
    case "Paragraph":
      return escapeBlockMarkers(serializeInline(node.children ?? []));
    case "CodeBlock":
      return fenceBlock(node.attributes?.language ?? "", codeText(node));
    case "ThematicBreak":
      return "---";
    default:
      return serializeNestedBlock(node);
  }
}

function serializeNestedBlock(node: MarkdownNode): string {
  switch (node.type) {
    case "UnorderedList":
      return serializeList(node, false);
    case "OrderedList":
      return serializeList(node, true);
    case "Blockquote":
      return prefixLines(serializeBlocks(node.children ?? []), QUOTE_PREFIXES);
    case "Admonition":
      return prefixLines(admonitionBody(node), QUOTE_PREFIXES);
    default:
      return node.children?.length ? serializeBlocks(node.children) : (node.content ?? "");
  }
}

function serializeInline(nodes: MarkdownNode[]): string {
  return nodes.map(serializeInlineNode).join("");
}

function serializeInlineNode(node: MarkdownNode): string {
  switch (node.type) {
    case "Text":
      return escapeInlineText(node.content ?? "");
    case "SoftBreak":
    case "LineBreak":
      return "\n";
    case "Code":
      return inlineCode(codeText(node));
    default:
      return serializeInlineContainer(node);
  }
}

function serializeInlineContainer(node: MarkdownNode): string {
  const content = serializeInline(node.children ?? []);
  const url = node.attributes?.url ?? "";
  switch (node.type) {
    case "Strong":
      return `**${content}**`;
    case "Emphasis":
      return `_${content}_`;
    case "Strikethrough":
      return `~~${content}~~`;
    // Recognition turns bare paths and inline code into Link nodes after parsing.
    case "Link":
      return node.attributes?.recognizedLink === "true"
        ? content
        : `[${content}](${linkTarget(url)})`;
    // Copy only alt text: node URLs are adapted preview URLs, not authored sources.
    case "Image":
      return imageAltText(node);
    default:
      return node.children?.length ? content : (node.content ?? "");
  }
}

function serializeList(node: MarkdownNode, ordered: boolean): string {
  const start = ordered ? Number(node.attributes?.start ?? 1) : 0;
  return (node.children ?? [])
    .map((item, index) => {
      const marker = listItemMarker(item, ordered ? `${start + index}. ` : "- ");
      const body = serializeBlocks(item.children ?? []);
      return prefixLines(body, { first: marker, rest: " ".repeat(marker.length), empty: "" });
    })
    .join("\n");
}

function listItemMarker(item: MarkdownNode, marker: string): string {
  if (item.attributes?.isTask !== "true") return marker;
  return `${marker}${item.attributes.taskChecked === "true" ? "[x] " : "[ ] "}`;
}

function admonitionBody(node: MarkdownNode): string {
  const type = (node.attributes?.admonitionType ?? "note").toUpperCase();
  return `[!${type}]\n\n${serializeBlocks(node.children ?? [])}`;
}

// MD4C stores inline code and image alt text as Text children, not as node content.
function codeText(node: MarkdownNode): string {
  return node.content ?? (node.children ?? []).map((child) => child.content ?? "").join("");
}

function imageAltText(node: MarkdownNode): string {
  const text = (node.children ?? []).map(plainText).join("").trim();
  return escapeInlineText(text);
}

function escapeInlineText(text: string): string {
  return text
    .replace(/[\\`*_[\]<>|~]/g, "\\$&")
    .replace(/&(?=#\d+;|#x[\da-f]+;|[a-z][a-z\d]+;)/gi, "\\&");
}

function escapeBlockMarkers(text: string): string {
  // Inspect complete lines because a paragraph can contain multiple Text and break nodes.
  return text
    .replace(/^([ \t]*)(#{1,6}(?=[ \t]|$)|[+-](?=[ \t]|$)|-(?=[- \t]*$)|=+(?=[ \t]*$))/gm, "$1\\$2")
    .replace(/^([ \t]*\d{1,9})([.)])(?=[ \t]|$)/gm, "$1\\$2");
}

function plainText(node: MarkdownNode): string {
  if (node.type === "SoftBreak" || node.type === "LineBreak") return " ";
  return node.content ?? (node.children ?? []).map(plainText).join("");
}

function linkTarget(url: string): string {
  return /[\s()]/.test(url) ? `<${url.replace(/[<>]/g, "")}>` : url;
}

function longestRun(text: string, character: "`" | "~"): number {
  const runs = text.match(character === "`" ? /`+/g : /~+/g) ?? [];
  return runs.reduce((longest, run) => Math.max(longest, run.length), 0);
}

function inlineCode(content: string): string {
  const delimiter = "`".repeat(longestRun(content, "`") + 1);
  const needsPadding =
    content.startsWith("`") ||
    content.endsWith("`") ||
    (content.startsWith(" ") && content.endsWith(" ") && content.trim().length > 0);
  const padding = needsPadding ? " " : "";
  return `${delimiter}${padding}${content}${padding}${delimiter}`;
}

function fenceBlock(info: string, content: string): string {
  const character = info.includes("`") ? "~" : "`";
  const delimiter = character.repeat(Math.max(3, longestRun(content, character) + 1));
  const closingNewline = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
  return `${delimiter}${info.trim()}\n${content}${closingNewline}${delimiter}`;
}

function headingLevel(node: MarkdownNode): number {
  const level = Number(node.attributes?.level ?? 1);
  return Number.isFinite(level) ? Math.min(Math.max(level, 1), 6) : 1;
}

const QUOTE_PREFIXES = { first: "> ", rest: "> ", empty: ">" };

function prefixLines(
  text: string,
  prefixes: { first: string; rest: string; empty: string },
): string {
  return text
    .split("\n")
    .map((line, index) => {
      if (line.length === 0) return prefixes.empty;
      return `${index === 0 ? prefixes.first : prefixes.rest}${line}`;
    })
    .join("\n");
}
