import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "skills", "manage-eight-sleep", "scripts", "eight-sleep.mjs");
const home = await mkdtemp(path.join(os.tmpdir(), "manage-eight-sleep-cli-"));

after(async () => {
  await rm(home, { recursive: true, force: true });
});

function invoke(arguments_) {
  const env = { ...process.env, HOME: home };
  for (const key of ["EIGHT_SLEEP_ACCESS_TOKEN", "EIGHT_SLEEP_USER_ID", "EIGHT_SLEEP_TOKEN_PATH", "EIGHT_SLEEP_ALLOW_MUTATIONS"]) {
    delete env[key];
  }
  return spawnSync(process.execPath, [cli, ...arguments_], { cwd: root, env, encoding: "utf8" });
}

test("doctor uses a non-zero exit when credentials are not ready", () => {
  const result = invoke(["doctor", "--json"]);
  assert.equal(result.status, 2, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.kind, "doctor");
  assert.equal(payload.ok, false);
  assert.equal(payload.credentials.ready, false);
});

test("local write dry-run succeeds without credentials or network", () => {
  const result = invoke(["temperature", "set", "--app-level=-2", "--duration-seconds=3600", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.dry_run, true);
  assert.equal(payload.confirmation, "temperature:set:-2:3600");
});
