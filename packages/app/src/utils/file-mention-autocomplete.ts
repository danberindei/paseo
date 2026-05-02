export interface FileMentionRange {
  start: number;
  end: number;
  query: string;
}

interface FindActiveFileMentionInput {
  text: string;
  cursorIndex: number;
}

interface ApplyFileMentionReplacementInput {
  text: string;
  mention: FileMentionRange;
  relativePath: string;
}

const INVALID_MENTION_QUERY_CHARS = /[\s\n\r\t"']/;

function isInvalidMentionChar(char: string): boolean {
  switch (char) {
    case " ":
    case "\n":
    case "\r":
    case "\t":
    case "\v":
    case "\f":
    case '"':
    case "'":
      return true;
    default:
      return false;
  }
}

export function findActiveFileMention(input: FindActiveFileMentionInput): FileMentionRange | null {
  const clampedCursor = Math.max(0, Math.min(input.cursorIndex, input.text.length));
  if (clampedCursor === 0) {
    return null;
  }

  const beforeCursor = input.text.slice(0, clampedCursor);
  const trailingChar = beforeCursor.charAt(beforeCursor.length - 1);
  if (!trailingChar || isInvalidMentionChar(trailingChar)) {
    return null;
  }

  for (let index = beforeCursor.length - 1; index >= 0; index -= 1) {
    const char = beforeCursor.charAt(index);
    if (char === "@") {
      const query = beforeCursor.slice(index + 1);
      if (INVALID_MENTION_QUERY_CHARS.test(query)) {
        return null;
      }
      return {
        start: index,
        end: clampedCursor,
        query,
      };
    }

    if (isInvalidMentionChar(char)) {
      return null;
    }
  }

  return null;
}

export function formatQuotedFileMentionPath(relativePath: string): string {
  const safePath = relativePath.replace(/"/g, '\\"');
  return `"${safePath}"`;
}

export function applyFileMentionReplacement(input: ApplyFileMentionReplacementInput): string {
  const before = input.text.slice(0, input.mention.start);
  const after = input.text.slice(input.mention.end);
  return `${before}${formatQuotedFileMentionPath(input.relativePath)}${after}`;
}
