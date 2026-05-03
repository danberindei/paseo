import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { removeSkill, syncSkills } from "./sync";

interface Sandbox {
  root: string;
  sourceDir: string;
  agentsDir: string;
  claudeDir: string;
  codexDir: string;
  antigravityDir: string;
  installDirs: string[];
}

async function makeSandbox(): Promise<Sandbox> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paseo-skill-sync-"));
  const sourceDir = path.join(root, "bundle");
  const agentsDir = path.join(root, "home", ".agents", "skills");
  const claudeDir = path.join(root, "home", ".claude", "skills");
  const codexDir = path.join(root, "home", ".codex", "skills");
  const antigravityDir = path.join(root, "home", ".gemini", "config", "skills");
  const installDirs = [agentsDir, claudeDir, antigravityDir];
  await fs.mkdir(sourceDir, { recursive: true });
  return { root, sourceDir, agentsDir, claudeDir, codexDir, antigravityDir, installDirs };
}

async function writeBundleSkill(
  sourceDir: string,
  name: string,
  files: Record<string, string>,
): Promise<void> {
  const skillDir = path.join(sourceDir, name);
  await fs.mkdir(skillDir, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(skillDir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content);
  }
}

describe("syncSkills", () => {
  let sandbox: Sandbox;

  beforeEach(async () => {
    sandbox = await makeSandbox();
  });

  afterEach(async () => {
    await fs.rm(sandbox.root, { recursive: true, force: true });
  });

  it("updates an existing managed Claude directory and continues with other skills", async () => {
    await writeBundleSkill(sandbox.sourceDir, "paseo", {
      "SKILL.md": "old",
      "stale.md": "stale",
      "modified.md": "original",
    });
    await syncSkills({ ...sandbox, installDirs: [sandbox.claudeDir], skillNames: ["paseo"] });
    const claudeSkill = path.join(sandbox.claudeDir, "paseo");
    await fs.writeFile(path.join(claudeSkill, "notes.md"), "user notes");
    await fs.writeFile(path.join(claudeSkill, "modified.md"), "user edit");
    await fs.writeFile(path.join(claudeSkill, "new.md"), "user file");
    await fs.mkdir(path.join(sandbox.agentsDir, "paseo"), { recursive: true });
    await fs.writeFile(path.join(sandbox.agentsDir, "paseo", "notes.md"), "shared notes");
    await fs.rm(path.join(sandbox.sourceDir, "paseo", "stale.md"));
    await writeBundleSkill(sandbox.sourceDir, "paseo", {
      "SKILL.md": "new",
      "modified.md": "updated",
      "new.md": "bundled file",
    });
    await writeBundleSkill(sandbox.sourceDir, "paseo-loop", { "SKILL.md": "loop" });

    const result = await syncSkills({ ...sandbox, skillNames: ["paseo", "paseo-loop"] });

    expect(result.processedSkills).toBe(2);
    expect(await fs.readFile(path.join(claudeSkill, "SKILL.md"), "utf-8")).toBe("new");
    expect(await fs.readFile(path.join(claudeSkill, "notes.md"), "utf-8")).toBe("user notes");
    expect(await fs.readFile(path.join(claudeSkill, "modified.md"), "utf-8")).toBe("user edit");
    expect(await fs.readFile(path.join(claudeSkill, "new.md"), "utf-8")).toBe("user file");
    await expect(fs.access(path.join(claudeSkill, "stale.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await fs.readFile(path.join(sandbox.claudeDir, "paseo-loop", "SKILL.md"), "utf-8")).toBe(
      "loop",
    );
    await fs.rm(path.join(sandbox.agentsDir, "paseo", "notes.md"));
    await fs.rm(path.join(sandbox.sourceDir, "paseo", "modified.md"));
    await fs.rm(path.join(sandbox.sourceDir, "paseo", "new.md"));
    await syncSkills({ ...sandbox, skillNames: ["paseo"] });
    expect(await fs.readFile(path.join(claudeSkill, "notes.md"), "utf-8")).toBe("user notes");
    expect(await fs.readFile(path.join(claudeSkill, "modified.md"), "utf-8")).toBe("user edit");
    expect(await fs.readFile(path.join(claudeSkill, "new.md"), "utf-8")).toBe("user file");
  });

  it("updates healthy roots when the shared skill target fails", async () => {
    await writeBundleSkill(sandbox.sourceDir, "paseo", { "SKILL.md": "content" });
    await fs.mkdir(sandbox.agentsDir, { recursive: true });
    await fs.writeFile(path.join(sandbox.agentsDir, "paseo"), "blocking file");
    const errors: string[] = [];

    await syncSkills({
      ...sandbox,
      skillNames: ["paseo"],
      onSkillError: (name) => errors.push(name),
    });

    expect(errors).toEqual(["paseo"]);
    expect(await fs.readFile(path.join(sandbox.claudeDir, "paseo", "SKILL.md"), "utf-8")).toBe(
      "content",
    );
    expect(await fs.readFile(path.join(sandbox.antigravityDir, "paseo", "SKILL.md"), "utf-8")).toBe(
      "content",
    );
  });

  it("preserves a usable Claude link when the shared skill target fails", async () => {
    await writeBundleSkill(sandbox.sourceDir, "paseo", { "SKILL.md": "bundle" });
    const sharedSkill = path.join(sandbox.agentsDir, "paseo");
    const claudeSkill = path.join(sandbox.claudeDir, "paseo");
    await fs.mkdir(path.join(sharedSkill, "SKILL.md"), { recursive: true });
    await fs.writeFile(path.join(sharedSkill, "notes.md"), "existing skill content");
    await fs.mkdir(sandbox.claudeDir, { recursive: true });
    await fs.symlink(sharedSkill, claudeSkill, "junction");
    const errors: string[] = [];

    await syncSkills({
      ...sandbox,
      skillNames: ["paseo"],
      onSkillError: (name) => errors.push(name),
    });

    expect(errors).toEqual(["paseo"]);
    expect((await fs.lstat(claudeSkill)).isSymbolicLink()).toBe(true);
    expect(await fs.readlink(claudeSkill)).toBe(sharedSkill);
    expect(await fs.readFile(path.join(claudeSkill, "notes.md"), "utf-8")).toBe(
      "existing skill content",
    );
  });

  it("preserves a Claude directory without a manifest and processes later skills", async () => {
    await writeBundleSkill(sandbox.sourceDir, "paseo", { "SKILL.md": "bundle" });
    await writeBundleSkill(sandbox.sourceDir, "paseo-loop", { "SKILL.md": "loop" });
    const claudeSkill = path.join(sandbox.claudeDir, "paseo");
    await fs.mkdir(claudeSkill, { recursive: true });
    await fs.writeFile(path.join(claudeSkill, "SKILL.md"), "user file");
    const errors: string[] = [];

    const result = await syncSkills({
      ...sandbox,
      skillNames: ["paseo", "paseo-loop"],
      onSkillError: (name) => errors.push(name),
    });

    expect(errors).toEqual(["paseo"]);
    expect(result.processedSkills).toBe(1);
    expect(await fs.readFile(path.join(claudeSkill, "SKILL.md"), "utf-8")).toBe("user file");
    expect(await fs.readFile(path.join(sandbox.claudeDir, "paseo-loop", "SKILL.md"), "utf-8")).toBe(
      "loop",
    );
  });

  it("overwrites on-disk skill content when the bundle differs", async () => {
    await writeBundleSkill(sandbox.sourceDir, "paseo", {
      "SKILL.md": "new paseo content",
    });
    const onDiskSkill = path.join(sandbox.agentsDir, "paseo");
    await fs.mkdir(onDiskSkill, { recursive: true });
    await fs.writeFile(path.join(onDiskSkill, "SKILL.md"), "old paseo content");

    const result = await syncSkills({
      sourceDir: sandbox.sourceDir,
      installDirs: sandbox.installDirs,
      codexDir: sandbox.codexDir,
      skillNames: ["paseo"],
    });

    expect(result.processedSkills).toBe(1);
    expect(result.changedFiles).toBeGreaterThan(0);
    const agentsContent = await fs.readFile(
      path.join(sandbox.agentsDir, "paseo", "SKILL.md"),
      "utf-8",
    );
    expect(agentsContent).toBe("new paseo content");
    const claudeContent = await fs.readFile(
      path.join(sandbox.claudeDir, "paseo", "SKILL.md"),
      "utf-8",
    );
    expect(claudeContent).toBe("new paseo content");
    const antigravityContent = await fs.readFile(
      path.join(sandbox.antigravityDir, "paseo", "SKILL.md"),
      "utf-8",
    );
    expect(antigravityContent).toBe("new paseo content");
    await expect(fs.stat(path.join(sandbox.codexDir, "paseo", "SKILL.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("installs new bundled skills, including references/, when not present on disk", async () => {
    await writeBundleSkill(sandbox.sourceDir, "paseo-committee", {
      "SKILL.md": "committee content",
      "references/roles.md": "roles content",
    });

    await syncSkills({
      sourceDir: sandbox.sourceDir,
      installDirs: sandbox.installDirs,
      codexDir: sandbox.codexDir,
      skillNames: ["paseo-committee"],
    });

    expect(
      await fs.readFile(path.join(sandbox.agentsDir, "paseo-committee", "SKILL.md"), "utf-8"),
    ).toBe("committee content");
    expect(
      await fs.readFile(
        path.join(sandbox.agentsDir, "paseo-committee", "references", "roles.md"),
        "utf-8",
      ),
    ).toBe("roles content");
    await expect(fs.stat(path.join(sandbox.codexDir, "paseo-committee"))).rejects.toMatchObject({
      code: "ENOENT",
    });

    // claudeDir/<skill> is a symlink pointing at the real skill directory under
    // agentsDir; the skill files are reachable through the link.
    const claudeSkillDir = path.join(sandbox.claudeDir, "paseo-committee");
    expect((await fs.lstat(claudeSkillDir)).isSymbolicLink()).toBe(true);
    expect(await fs.readlink(claudeSkillDir)).toBe(path.join(sandbox.agentsDir, "paseo-committee"));
    expect(await fs.readFile(path.join(claudeSkillDir, "SKILL.md"), "utf-8")).toBe(
      "committee content",
    );
    expect(await fs.readFile(path.join(claudeSkillDir, "references", "roles.md"), "utf-8")).toBe(
      "roles content",
    );

    const antigravitySkillDir = path.join(sandbox.antigravityDir, "paseo-committee");
    expect((await fs.lstat(antigravitySkillDir)).isDirectory()).toBe(true);
    expect(await fs.readFile(path.join(antigravitySkillDir, "SKILL.md"), "utf-8")).toBe(
      "committee content",
    );
    expect(
      await fs.readFile(path.join(antigravitySkillDir, "references", "roles.md"), "utf-8"),
    ).toBe("roles content");
  });

  it("leaves on-disk skills not in the bundle untouched", async () => {
    await writeBundleSkill(sandbox.sourceDir, "paseo", { "SKILL.md": "new" });
    const customSkill = path.join(sandbox.agentsDir, "user-custom-skill");
    await fs.mkdir(customSkill, { recursive: true });
    await fs.writeFile(path.join(customSkill, "SKILL.md"), "user content");
    const antigravityCustomSkill = path.join(sandbox.antigravityDir, "user-antigravity-skill");
    await fs.mkdir(antigravityCustomSkill, { recursive: true });
    await fs.writeFile(path.join(antigravityCustomSkill, "SKILL.md"), "antigravity user content");

    await syncSkills({
      sourceDir: sandbox.sourceDir,
      installDirs: sandbox.installDirs,
      codexDir: sandbox.codexDir,
      skillNames: ["paseo"],
    });

    expect(await fs.readFile(path.join(customSkill, "SKILL.md"), "utf-8")).toBe("user content");
    expect(await fs.readFile(path.join(antigravityCustomSkill, "SKILL.md"), "utf-8")).toBe(
      "antigravity user content",
    );
  });

  it("removes stale files previously written to managed skill dirs", async () => {
    await writeBundleSkill(sandbox.sourceDir, "paseo", {
      "SKILL.md": "old",
      "references/stale.md": "stale",
    });
    const onDiskSkill = path.join(sandbox.agentsDir, "paseo");

    await syncSkills({
      sourceDir: sandbox.sourceDir,
      installDirs: sandbox.installDirs,
      codexDir: sandbox.codexDir,
      skillNames: ["paseo"],
    });

    await fs.rm(path.join(sandbox.sourceDir, "paseo"), { recursive: true, force: true });
    await writeBundleSkill(sandbox.sourceDir, "paseo", { "SKILL.md": "new" });

    await syncSkills({
      sourceDir: sandbox.sourceDir,
      installDirs: sandbox.installDirs,
      codexDir: sandbox.codexDir,
      skillNames: ["paseo"],
    });

    expect(await fs.readFile(path.join(onDiskSkill, "SKILL.md"), "utf-8")).toBe("new");
    await expect(fs.access(path.join(onDiskSkill, "references", "stale.md"))).rejects.toThrow();
    await expect(fs.access(path.join(onDiskSkill, "references"))).rejects.toThrow();
    const antigravitySkill = path.join(sandbox.antigravityDir, "paseo");
    expect(await fs.readFile(path.join(antigravitySkill, "SKILL.md"), "utf-8")).toBe("new");
    await expect(
      fs.access(path.join(antigravitySkill, "references", "stale.md")),
    ).rejects.toThrow();
    await expect(fs.access(path.join(antigravitySkill, "references"))).rejects.toThrow();
  });

  it("preserves user-added files in managed skill dirs", async () => {
    await writeBundleSkill(sandbox.sourceDir, "paseo", { "SKILL.md": "new" });
    const onDiskSkill = path.join(sandbox.agentsDir, "paseo");
    await fs.mkdir(path.join(onDiskSkill, "references"), { recursive: true });
    await fs.writeFile(path.join(onDiskSkill, "SKILL.md"), "old");
    await fs.writeFile(path.join(onDiskSkill, "my-context.md"), "user context");
    await fs.writeFile(path.join(onDiskSkill, "references", "notes.md"), "user notes");
    const antigravitySkill = path.join(sandbox.antigravityDir, "paseo");
    await fs.mkdir(path.join(antigravitySkill, "references"), { recursive: true });
    await fs.writeFile(path.join(antigravitySkill, "SKILL.md"), "old");
    await fs.writeFile(path.join(antigravitySkill, "my-context.md"), "antigravity user context");

    await syncSkills({
      sourceDir: sandbox.sourceDir,
      installDirs: sandbox.installDirs,
      codexDir: sandbox.codexDir,
      skillNames: ["paseo"],
    });

    expect(await fs.readFile(path.join(onDiskSkill, "SKILL.md"), "utf-8")).toBe("new");
    expect(await fs.readFile(path.join(onDiskSkill, "my-context.md"), "utf-8")).toBe(
      "user context",
    );
    expect(await fs.readFile(path.join(onDiskSkill, "references", "notes.md"), "utf-8")).toBe(
      "user notes",
    );
    expect(await fs.readFile(path.join(antigravitySkill, "SKILL.md"), "utf-8")).toBe("new");
    expect(await fs.readFile(path.join(antigravitySkill, "my-context.md"), "utf-8")).toBe(
      "antigravity user context",
    );
  });

  it.skipIf(process.platform === "win32")(
    "rejects managed paths that would write through a symlink",
    async () => {
      await writeBundleSkill(sandbox.sourceDir, "paseo", {
        "SKILL.md": "new skill",
        "references/guide.md": "new guide",
      });
      const onDiskSkill = path.join(sandbox.agentsDir, "paseo");
      const externalReferences = path.join(sandbox.root, "external-references");
      await fs.mkdir(onDiskSkill, { recursive: true });
      await fs.mkdir(externalReferences, { recursive: true });
      await fs.writeFile(path.join(onDiskSkill, "SKILL.md"), "old skill");
      await fs.writeFile(path.join(externalReferences, "guide.md"), "external guide");
      await fs.symlink(externalReferences, path.join(onDiskSkill, "references"), "dir");

      await expect(
        syncSkills({
          sourceDir: sandbox.sourceDir,
          installDirs: sandbox.installDirs,
          codexDir: sandbox.codexDir,
          skillNames: ["paseo"],
        }),
      ).rejects.toThrow("Cannot sync through symbolic link");

      expect(await fs.readFile(path.join(onDiskSkill, "SKILL.md"), "utf-8")).toBe("old skill");
      expect(await fs.readFile(path.join(externalReferences, "guide.md"), "utf-8")).toBe(
        "external guide",
      );
      expect((await fs.lstat(path.join(onDiskSkill, "references"))).isSymbolicLink()).toBe(true);
    },
  );

  it.skipIf(process.platform === "win32")(
    "rejects managed paths that would write through a symlink in Antigravity",
    async () => {
      await writeBundleSkill(sandbox.sourceDir, "paseo", {
        "SKILL.md": "new skill",
        "references/guide.md": "new guide",
      });
      const onDiskSkill = path.join(sandbox.antigravityDir, "paseo");
      const externalReferences = path.join(sandbox.root, "external-antigravity-references");
      await fs.mkdir(onDiskSkill, { recursive: true });
      await fs.mkdir(externalReferences, { recursive: true });
      await fs.writeFile(path.join(onDiskSkill, "SKILL.md"), "old skill");
      await fs.writeFile(path.join(externalReferences, "guide.md"), "external guide");
      await fs.symlink(externalReferences, path.join(onDiskSkill, "references"), "dir");

      await expect(
        syncSkills({
          sourceDir: sandbox.sourceDir,
          installDirs: sandbox.installDirs,
          codexDir: sandbox.codexDir,
          skillNames: ["paseo"],
        }),
      ).rejects.toThrow("Cannot sync through symbolic link");

      expect(await fs.readFile(path.join(onDiskSkill, "SKILL.md"), "utf-8")).toBe("old skill");
      expect(await fs.readFile(path.join(externalReferences, "guide.md"), "utf-8")).toBe(
        "external guide",
      );
      expect((await fs.lstat(path.join(onDiskSkill, "references"))).isSymbolicLink()).toBe(true);
    },
  );

  it("reports zero changed files on a no-op resync", async () => {
    await writeBundleSkill(sandbox.sourceDir, "paseo", {
      "SKILL.md": "content",
      "references/extra.md": "ref",
    });

    const first = await syncSkills({
      sourceDir: sandbox.sourceDir,
      installDirs: sandbox.installDirs,
      codexDir: sandbox.codexDir,
      skillNames: ["paseo"],
    });
    expect(first.changedFiles).toBeGreaterThan(0);

    const second = await syncSkills({
      sourceDir: sandbox.sourceDir,
      installDirs: sandbox.installDirs,
      codexDir: sandbox.codexDir,
      skillNames: ["paseo"],
    });
    expect(second.changedFiles).toBe(0);
  });

  it("skips skills listed in skillNames that are missing from the bundle without raising", async () => {
    await writeBundleSkill(sandbox.sourceDir, "paseo", { "SKILL.md": "content" });
    // "paseo-removed" is in skillNames but not in the bundle on disk.

    const errors: Array<{ name: string; error: unknown }> = [];
    const result = await syncSkills({
      sourceDir: sandbox.sourceDir,
      installDirs: sandbox.installDirs,
      codexDir: sandbox.codexDir,
      skillNames: ["paseo", "paseo-removed"],
      onSkillError: (name, error) => errors.push({ name, error }),
    });

    expect(errors).toEqual([]);
    expect(result.processedSkills).toBe(1);
    expect(await fs.readFile(path.join(sandbox.agentsDir, "paseo", "SKILL.md"), "utf-8")).toBe(
      "content",
    );
    await expect(fs.access(path.join(sandbox.agentsDir, "paseo-removed"))).rejects.toThrow();
  });

  it("leaves on-disk skill content alone when the skill has been removed from the bundle", async () => {
    await writeBundleSkill(sandbox.sourceDir, "paseo", { "SKILL.md": "current" });
    const deprecatedDir = path.join(sandbox.agentsDir, "paseo-deprecated");
    await fs.mkdir(deprecatedDir, { recursive: true });
    await fs.writeFile(path.join(deprecatedDir, "SKILL.md"), "old content");

    await syncSkills({
      sourceDir: sandbox.sourceDir,
      installDirs: sandbox.installDirs,
      codexDir: sandbox.codexDir,
      skillNames: ["paseo", "paseo-deprecated"],
    });

    expect(await fs.readFile(path.join(deprecatedDir, "SKILL.md"), "utf-8")).toBe("old content");
  });

  it("skips symlink creation when claudeDir is a symlink to agentsDir", async () => {
    await writeBundleSkill(sandbox.sourceDir, "paseo", { "SKILL.md": "content" });

    // Simulate ~/.claude/skills -> ~/.agents/skills
    const claudeDirParent = path.dirname(sandbox.claudeDir);
    await fs.mkdir(claudeDirParent, { recursive: true });
    await fs.mkdir(sandbox.agentsDir, { recursive: true });
    await fs.symlink(sandbox.agentsDir, sandbox.claudeDir);

    await syncSkills({
      sourceDir: sandbox.sourceDir,
      installDirs: sandbox.installDirs,
      codexDir: sandbox.codexDir,
      skillNames: ["paseo"],
    });

    // The skill file should be written to agentsDir
    expect(await fs.readFile(path.join(sandbox.agentsDir, "paseo", "SKILL.md"), "utf-8")).toBe(
      "content",
    );

    // No self-referential symlink should exist inside agentsDir
    const lstat = await fs.lstat(path.join(sandbox.agentsDir, "paseo"));
    expect(lstat.isSymbolicLink()).toBe(false);
    expect(lstat.isDirectory()).toBe(true);
  });

  it("does not crash when the source bundle directory is missing", async () => {
    const missingSourceDir = path.join(sandbox.root, "no-bundle-here");

    const errors: string[] = [];
    const result = await syncSkills({
      sourceDir: missingSourceDir,
      installDirs: sandbox.installDirs,
      codexDir: sandbox.codexDir,
      skillNames: ["paseo"],
      onSkillError: (skillName) => errors.push(skillName),
    });

    expect(errors).toEqual([]);
    expect(result).toEqual({ changedFiles: 0, processedSkills: 0 });
  });

  it("reports per-skill errors via onSkillError without throwing", async () => {
    await writeBundleSkill(sandbox.sourceDir, "paseo", { "SKILL.md": "content" });
    // Make agents skill path a file (not a directory) to force a write error
    await fs.mkdir(sandbox.agentsDir, { recursive: true });
    await fs.writeFile(path.join(sandbox.agentsDir, "paseo"), "blocking file");

    const errors: string[] = [];
    const result = await syncSkills({
      sourceDir: sandbox.sourceDir,
      installDirs: sandbox.installDirs,
      codexDir: sandbox.codexDir,
      skillNames: ["paseo"],
      onSkillError: (skillName) => errors.push(skillName),
    });

    expect(errors).toContain("paseo");
    expect(result.processedSkills).toBe(0);
  });
});

describe("removeSkill", () => {
  let sandbox: Sandbox;

  beforeEach(async () => {
    sandbox = await makeSandbox();
  });

  afterEach(async () => {
    await fs.rm(sandbox.root, { recursive: true, force: true });
  });

  it("removes the skill from all targets when present", async () => {
    await writeBundleSkill(sandbox.sourceDir, "paseo", { "SKILL.md": "content" });
    await syncSkills({
      sourceDir: sandbox.sourceDir,
      installDirs: sandbox.installDirs,
      codexDir: sandbox.codexDir,
      skillNames: ["paseo"],
    });

    await removeSkill("paseo", {
      installDirs: sandbox.installDirs,
      codexDir: sandbox.codexDir,
    });

    await expect(fs.access(path.join(sandbox.agentsDir, "paseo"))).rejects.toThrow();
    await expect(fs.access(path.join(sandbox.claudeDir, "paseo"))).rejects.toThrow();
    await expect(fs.access(path.join(sandbox.codexDir, "paseo"))).rejects.toThrow();
    await expect(fs.access(path.join(sandbox.antigravityDir, "paseo"))).rejects.toThrow();
  });

  it("does not throw when targets are missing", async () => {
    await expect(
      removeSkill("does-not-exist", {
        installDirs: sandbox.installDirs,
        codexDir: sandbox.codexDir,
      }),
    ).resolves.toBeUndefined();
  });
});
