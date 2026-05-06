import { promises as fs } from "fs";
import ignoreModule, { type Ignore } from "ignore";

const ignore = ignoreModule as unknown as typeof ignoreModule.default;
import path from "path";

export async function listWorkspaceFiles(root: string): Promise<string[]> {
  const ig = await loadGitignoreRules(root);
  const results: string[] = [];
  await walk(root, root, ig, results);
  return results;
}

async function walk(root: string, dir: string, ig: Ignore, results: string[]): Promise<void> {
  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(root, fullPath);

    if (entry.isDirectory()) {
      if (ig.ignores(relativePath + "/")) {
        continue;
      }
      await walk(root, fullPath, ig, results);
    } else {
      if (!ig.ignores(relativePath)) {
        results.push(relativePath);
      }
    }
  }
}

async function loadGitignoreRules(root: string): Promise<Ignore> {
  const ig = ignore();

  ig.add(".git");

  const gitignorePath = path.join(root, ".gitignore");
  const gitignoreContent = await readFileIfExists(gitignorePath);
  if (gitignoreContent) {
    ig.add(gitignoreContent);
  }

  const infoExcludePath = path.join(root, ".git", "info", "exclude");
  const excludeContent = await readFileIfExists(infoExcludePath);
  if (excludeContent) {
    ig.add(excludeContent);
  }

  return ig;
}

async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}
