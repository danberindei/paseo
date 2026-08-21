import type { ASTNode } from "react-native-markdown-display";

export function astNodesToMarkdown(nodes: ASTNode[]): string {
  return serializeBlocks(nodes).trim();
}

function serializeBlocks(nodes: ASTNode[]): string {
  return nodes
    .map(serializeBlockNode)
    .filter((block) => block.length > 0)
    .join("\n\n");
}

const HEADING_LEVELS: Record<string, number> = {
  heading1: 1,
  heading2: 2,
  heading3: 3,
  heading4: 4,
  heading5: 5,
  heading6: 6,
};

function serializeBlockNode(node: ASTNode): string {
  const headingLevel = HEADING_LEVELS[node.type];
  if (headingLevel) {
    return `${"#".repeat(headingLevel)} ${serializeInline(node.children)}`;
  }
  switch (node.type) {
    case "paragraph":
    case "textgroup":
      return serializeInline(node.children);
    case "fence":
      return fenceBlock(node.sourceInfo ?? "", node.content);
    case "code_block":
      return fenceBlock("", node.content);
    case "bullet_list":
      return serializeList(node, false);
    case "ordered_list":
      return serializeList(node, true);
    case "blockquote":
      return prefixLines(serializeBlocks(node.children), { first: "> ", rest: "> ", empty: ">" });
    case "hr":
      return "---";
    default:
      return node.children?.length ? serializeBlocks(node.children) : node.content;
  }
}

function serializeInline(nodes: ASTNode[]): string {
  return nodes.map(serializeInlineNode).join("");
}

function serializeInlineNode(node: ASTNode): string {
  switch (node.type) {
    case "text":
      return node.content;
    case "softbreak":
    case "hardbreak":
      return "\n";
    case "strong":
      return `**${serializeInline(node.children)}**`;
    case "em":
      return `_${serializeInline(node.children)}_`;
    case "s":
      return `~~${serializeInline(node.children)}~~`;
    case "code_inline":
      return `\`${node.content}\``;
    case "link":
      return `[${serializeInline(node.children)}](${stringAttribute(node, "href")})`;
    case "image":
      return `![${stringAttribute(node, "alt")}](${stringAttribute(node, "src")})`;
    default:
      return node.children?.length ? serializeInline(node.children) : node.content;
  }
}

function serializeList(node: ASTNode, ordered: boolean): string {
  const start = ordered ? Number(node.attributes?.start ?? 1) : 0;
  return node.children
    .map((item, index) => {
      const marker = ordered ? `${start + index}. ` : "- ";
      const body = serializeBlocks(item.children);
      const indent = " ".repeat(marker.length);
      return prefixLines(body, { first: marker, rest: indent, empty: "" });
    })
    .join("\n");
}

function fenceBlock(info: string, content: string): string {
  const body = content.replace(/\n+$/, "");
  return `\`\`\`${info.trim()}\n${body}\n\`\`\``;
}

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

function stringAttribute(node: ASTNode, key: string): string {
  const value = node.attributes?.[key];
  return typeof value === "string" ? value : "";
}
