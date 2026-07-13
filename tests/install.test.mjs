import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = await mkdtemp(path.join(os.tmpdir(), "manage-eight-sleep-install-"));
const codexHome = path.join(home, "custom-codex-home");
const hermesHome = path.join(home, "custom-hermes-home");

after(async () => {
  await rm(home, { recursive: true, force: true });
});

function install(...arguments_) {
  return spawnSync("bash", [path.join(root, "install.sh"), ...arguments_], {
    cwd: root,
    env: {
      ...process.env,
      HOME: home,
      CODEX_HOME: codexHome,
      HERMES_HOME: hermesHome,
    },
    encoding: "utf8",
  });
}

test("installer handles both hosts atomically and refuses accidental replacement", async () => {
  const first = install("both");
  assert.equal(first.status, 0, first.stderr);

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
});
