import assert from "node:assert/strict";
import { access, chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = await mkdtemp(path.join(os.tmpdir(), "manage-eight-sleep-install-"));
const legacyHome = await mkdtemp(path.join(os.tmpdir(), "manage-eight-sleep-legacy-install-"));
const transactionHome = await mkdtemp(path.join(os.tmpdir(), "manage-eight-sleep-transaction-install-"));
const codexHome = path.join(home, "custom-codex-home");
const hermesHome = path.join(home, "custom-hermes-home");

after(async () => {
  await Promise.all([
    rm(home, { recursive: true, force: true }),
    rm(legacyHome, { recursive: true, force: true }),
    rm(transactionHome, { recursive: true, force: true }),
  ]);
});

function installWithHomes(customHome, customCodexHome, customHermesHome, ...arguments_) {
  return spawnSync("bash", [path.join(root, "install.sh"), ...arguments_], {
    cwd: root,
    env: {
      ...process.env,
      HOME: customHome,
      CODEX_HOME: customCodexHome,
      HERMES_HOME: customHermesHome,
    },
    encoding: "utf8",
  });
}

function installAt(customHome, ...arguments_) {
  return installWithHomes(
    customHome,
    path.join(customHome, "custom-codex-home"),
    path.join(customHome, "custom-hermes-home"),
    ...arguments_,
  );
}

function install(...arguments_) {
  return installAt(home, ...arguments_);
}

async function entriesOrEmpty(directory) {
  try {
    return await readdir(directory);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return [];
    throw error;
  }
}

test("installer handles both hosts atomically and refuses accidental replacement", async () => {
  const first = install("both");
  assert.equal(first.status, 0, first.stderr);
  assert.ok(first.stdout.includes(path.join(hermesHome, "skills", "manage-eight-sleep", "scripts", "eight-sleep.mjs")));
  assert.match(first.stdout, /does not connect WeChat/);
  assert.match(first.stdout, /Feishu\/Lark, Telegram/);
  assert.match(first.stdout, /hermes gateway setup/);

  const codexSkill = path.join(codexHome, "skills", "manage-eight-sleep", "SKILL.md");
  const hermesSkill = path.join(hermesHome, "skills", "manage-eight-sleep", "SKILL.md");
  await Promise.all([access(codexSkill), access(hermesSkill)]);
  const before = await readFile(codexSkill, "utf8");

  const blocked = install("both");
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /Nothing was installed/);
  assert.equal(await readFile(codexSkill, "utf8"), before);

  const forced = install("both", "--force");
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(await readFile(codexSkill, "utf8"), before);
});

test("installer requires an explicit valid target", () => {
  const missing = install();
  assert.equal(missing.status, 2);
  const invalid = install("somewhere-else");
  assert.equal(invalid.status, 2);
  const misplacedConflictFlag = install("codex", "--backup-conflicts");
  assert.equal(misplacedConflictFlag.status, 2);
});

test("Hermes install blocks competing Eight Sleep skills and can back them up reversibly", async () => {
  const customHermesHome = path.join(legacyHome, "custom-hermes-home");
  const legacySkill = path.join(customHermesHome, "skills", "smart-home", "eight-sleep");
  await mkdir(legacySkill, { recursive: true });
  await writeFile(path.join(legacySkill, "SKILL.md"), "# legacy direct API skill\n");
  await writeFile(path.join(customHermesHome, "config.yaml"), [
    "mcp_servers:",
    "  eight_sleep:",
    "    env:",
    "      EIGHT_SLEEP_ALLOW_MUTATIONS: true",
  ].join("\n"));

  const blocked = installAt(legacyHome, "hermes");
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /conflicting Hermes Eight Sleep skills/);
  await access(path.join(legacySkill, "SKILL.md"));

  const migrated = installAt(legacyHome, "hermes", "--backup-conflicts");
  assert.equal(migrated.status, 0, migrated.stderr);
  assert.match(migrated.stderr, /config.yaml still contains a legacy Eight Sleep marker/);
  await access(path.join(customHermesHome, "skills", "manage-eight-sleep", "SKILL.md"));

  const backupRoot = path.join(customHermesHome, "backups", "manage-eight-sleep");
  const backups = await readdir(backupRoot);
  assert.equal(backups.length, 1);
  await access(path.join(backupRoot, backups[0], "smart-home", "eight-sleep", "SKILL.md"));
  await assert.rejects(access(path.join(customHermesHome, "skills", "smart-home", "eight-sleep", "SKILL.md")));
  assert.equal(path.relative(path.join(customHermesHome, "skills"), backupRoot).startsWith(".."), true);
});

test("both stages every target before commit and leaves no partial Codex install when Hermes preparation fails", async () => {
  const caseHome = path.join(transactionHome, "second-target-staging-failure");
  const customCodexHome = path.join(caseHome, "codex");
  const blockedHermesHome = path.join(caseHome, "hermes-home-is-a-file");
  await mkdir(caseHome, { recursive: true });
  await writeFile(blockedHermesHome, "not a directory\n");

  const result = installWithHomes(caseHome, customCodexHome, blockedHermesHome, "both");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /restoring the previous state/);
  await assert.rejects(access(path.join(customCodexHome, "skills", "manage-eight-sleep", "SKILL.md")));
  assert.equal((await entriesOrEmpty(path.join(customCodexHome, "skills"))).some((entry) => entry.startsWith(".manage-eight-sleep.stage.")), false);
});

test("a staging failure does not move a reviewed Hermes conflict", async () => {
  const caseHome = path.join(transactionHome, "conflict-before-staging-failure");
  const blockedCodexHome = path.join(caseHome, "codex-home-is-a-file");
  const customHermesHome = path.join(caseHome, "hermes");
  const conflict = path.join(customHermesHome, "skills", "eight-sleep", "SKILL.md");
  await mkdir(path.dirname(conflict), { recursive: true });
  await writeFile(blockedCodexHome, "not a directory\n");
  await writeFile(conflict, "# legacy\n");

  const result = installWithHomes(caseHome, blockedCodexHome, customHermesHome, "both", "--backup-conflicts");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /restoring the previous state/);
  assert.equal(await readFile(conflict, "utf8"), "# legacy\n");
  await assert.rejects(access(path.join(customHermesHome, "skills", "manage-eight-sleep", "SKILL.md")));
  assert.deepEqual(await entriesOrEmpty(path.join(customHermesHome, "backups", "manage-eight-sleep")), []);
});

test("a partial Hermes conflict-backup failure restores conflicts already moved", async () => {
  const caseHome = path.join(transactionHome, "partial-conflict-backup-failure");
  const customCodexHome = path.join(caseHome, "codex");
  const customHermesHome = path.join(caseHome, "hermes");
  const skillsRoot = path.join(customHermesHome, "skills");
  const conflicts = [
    path.join(skillsRoot, "eight-sleep-mcp", "SKILL.md"),
    path.join(skillsRoot, "eight-sleep", "SKILL.md"),
    path.join(skillsRoot, "smart-home", "eight-sleep", "SKILL.md"),
  ];
  for (const [index, conflict] of conflicts.entries()) {
    await mkdir(path.dirname(conflict), { recursive: true });
    await writeFile(conflict, `# legacy ${index}\n`);
  }
  const lockedParent = path.join(skillsRoot, "smart-home");
  await chmod(lockedParent, 0o500);

  const result = installWithHomes(caseHome, customCodexHome, customHermesHome, "hermes", "--backup-conflicts");
  await chmod(lockedParent, 0o700);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /cannot back up conflicting Hermes skill/);
  assert.match(result.stderr, /restoring the previous state/);
  for (const [index, conflict] of conflicts.entries()) {
    assert.equal(await readFile(conflict, "utf8"), `# legacy ${index}\n`);
  }
  await assert.rejects(access(path.join(skillsRoot, "manage-eight-sleep", "SKILL.md")));
  assert.deepEqual(await entriesOrEmpty(path.join(customHermesHome, "backups", "manage-eight-sleep")), []);
});

test("a mid-commit failure restores an earlier force replacement and its moved Hermes conflict", async () => {
  const caseHome = path.join(transactionHome, "mid-commit-rollback");
  const customCodexHome = path.join(caseHome, "codex");
  const codexDestination = path.join(customCodexHome, "skills", "manage-eight-sleep");
  // This intentionally overlapping custom Hermes home makes its staged copy
  // move with the old Codex destination during the first commit. The second
  // commit then fails deterministically after the first one succeeded.
  const customHermesHome = codexDestination;
  const originalSkill = path.join(codexDestination, "SKILL.md");
  const conflict = path.join(customHermesHome, "skills", "eight-sleep", "SKILL.md");
  await mkdir(path.dirname(conflict), { recursive: true });
  await writeFile(originalSkill, "# original Codex skill\n");
  await writeFile(conflict, "# original Hermes conflict\n");

  const result = installWithHomes(
    caseHome,
    customCodexHome,
    customHermesHome,
    "both",
    "--force",
    "--backup-conflicts",
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /cannot commit the staged skill/);
  assert.match(result.stderr, /restoring the previous state/);
  assert.equal(await readFile(originalSkill, "utf8"), "# original Codex skill\n");
  assert.equal(await readFile(conflict, "utf8"), "# original Hermes conflict\n");
  await assert.rejects(access(path.join(customHermesHome, "skills", "manage-eight-sleep", "SKILL.md")));

  const codexParentEntries = await readdir(path.dirname(codexDestination));
  assert.equal(codexParentEntries.some((entry) => entry.startsWith(".manage-eight-sleep.")), false);
  const restoredHermesSkillsEntries = await readdir(path.join(customHermesHome, "skills"));
  assert.equal(restoredHermesSkillsEntries.some((entry) => entry.startsWith(".manage-eight-sleep.")), false);
  assert.deepEqual(await entriesOrEmpty(path.join(customHermesHome, "backups", "manage-eight-sleep")), []);
});

test("failure to delete an obsolete rollback copy never rolls back the committed replacement", async () => {
  const caseHome = path.join(transactionHome, "post-commit-cleanup-failure");
  const customCodexHome = path.join(caseHome, "codex");
  const customHermesHome = path.join(caseHome, "hermes");
  const destination = path.join(customCodexHome, "skills", "manage-eight-sleep");
  const lockedDirectory = path.join(destination, "locked");
  await mkdir(lockedDirectory, { recursive: true });
  await writeFile(path.join(destination, "SKILL.md"), "# obsolete skill\n");
  await writeFile(path.join(lockedDirectory, "undeletable-during-install"), "fixture\n");
  await chmod(lockedDirectory, 0o500);

  const result = installWithHomes(caseHome, customCodexHome, customHermesHome, "codex", "--force");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /old rollback container could not be removed; it was retained outside the skills tree/);
  assert.notEqual(await readFile(path.join(destination, "SKILL.md"), "utf8"), "# obsolete skill\n");

  const skillsEntries = await readdir(path.dirname(destination));
  assert.equal(skillsEntries.some((entry) => entry.startsWith(".manage-eight-sleep.rollback.")), false);

  const retainedParent = path.join(customCodexHome, "backups", "manage-eight-sleep", "rollback-cleanup");
  const retainedRoots = await readdir(retainedParent);
  assert.equal(retainedRoots.length, 1);
  const retainedOriginal = path.join(retainedParent, retainedRoots[0], "container", "original");
  assert.equal(await readFile(path.join(retainedOriginal, "locked", "undeletable-during-install"), "utf8"), "fixture\n");
  await chmod(path.join(retainedOriginal, "locked"), 0o700);
  await rm(path.join(retainedParent, retainedRoots[0]), { recursive: true, force: true });
});
