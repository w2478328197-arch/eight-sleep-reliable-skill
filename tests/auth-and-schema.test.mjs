import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { run } from "../skills/manage-eight-sleep/scripts/eight-sleep.mjs";
import { ApiError, UsageError, inspectCredentials } from "../skills/manage-eight-sleep/scripts/eight-sleep-lib.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function tokenHome(mode = 0o600, expiresAt = 2_000_000_000) {
  const home = await mkdtemp(path.join(os.tmpdir(), "manage-eight-sleep-auth-"));
  temporaryDirectories.push(home);
  const directory = path.join(home, ".eight-sleep-mcp");
  await mkdir(directory);
  const filename = path.join(directory, "tokens.json");
  await writeFile(filename, JSON.stringify({
    access_token: "synthetic-token-for-local-tests",
    user_id: "synthetic-user-for-local-tests",
    expires_at: expiresAt,
  }), { mode: 0o600 });
  await chmod(filename, mode);
  return home;
}

test("credential inspection reports safe metadata without returning token or user id", async () => {
  const home = await tokenHome();
  const result = await inspectCredentials({ home, env: {}, now: 1_900_000_000_000 });
  assert.equal(result.ready, true);
  assert.equal(result.secure_permissions, process.platform === "win32" ? undefined : true);
  assert.equal(result.token_path, "~/.eight-sleep-mcp/tokens.json");
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("synthetic-token"), false);
  assert.equal(serialized.includes("synthetic-user"), false);
});

test("write refuses a token file readable by other local users before networking", async (context) => {
  if (process.platform === "win32") return context.skip("POSIX permission test");
  const home = await tokenHome(0o644);
  let fetchCalls = 0;
  await assert.rejects(run([
    "temperature", "off", "--apply", "--confirm-write=temperature:off",
  ], {
    home,
    env: { EIGHT_SLEEP_ALLOW_MUTATIONS: "true" },
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("network should not be reached");
    },
  }), (error) => error instanceof UsageError && /permissions to 600/.test(error.message));
  assert.equal(fetchCalls, 0);
});

test("doctor is not ready when a token file is readable by other local users", async (context) => {
  if (process.platform === "win32") return context.skip("POSIX permission test");
  const home = await tokenHome(0o644);
  const result = await run(["doctor", "--json"], { home, env: {} });

  assert.equal(result.credentials.ready, true);
  assert.equal(result.credentials.secure_permissions, false);
  assert.equal(result.ok, false);
});

test("mutation gate accepts only the exact lowercase true value", async () => {
  let fetchCalls = 0;
  await assert.rejects(run([
    "temperature", "off", "--apply", "--confirm-write=temperature:off",
  ], {
    home: "/synthetic-home",
    env: { EIGHT_SLEEP_ALLOW_MUTATIONS: "TRUE" },
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("network should not be reached");
    },
  }), (error) => error instanceof UsageError && /Writes are disabled/.test(error.message));
  assert.equal(fetchCalls, 0);
});

test("recognized-schema checks fail closed when private API payloads drift", async () => {
  const dependencies = {
    env: {
      EIGHT_SLEEP_ACCESS_TOKEN: "synthetic-token",
      EIGHT_SLEEP_USER_ID: "synthetic-user",
    },
    clientBase: "https://client.mock.invalid",
    appBase: "https://app.mock.invalid",
    fetchImpl: async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    now: () => new Date("2026-07-13T12:00:00.000Z"),
  };

  await assert.rejects(run(["trends", "--days=7", "--timezone=UTC"], dependencies), (error) => {
    assert.equal(error instanceof ApiError, true);
    assert.match(error.message, /days array/);
    return true;
  });
  await assert.rejects(run(["temperature", "get"], dependencies), (error) => {
    assert.equal(error instanceof ApiError, true);
    assert.match(error.message, /recognized fields/);
    return true;
  });
});

test("doctor online checks use read-only requests only", async () => {
  const methods = [];
  const result = await run(["doctor", "--check-api", "--json"], {
    env: {
      EIGHT_SLEEP_ACCESS_TOKEN: "synthetic-token",
      EIGHT_SLEEP_USER_ID: "synthetic-user",
    },
    clientBase: "https://client.mock.invalid",
    appBase: "https://app.mock.invalid",
    fetchImpl: async (url, init = {}) => {
      methods.push(init.method ?? "GET");
      const payload = String(url).includes("/temperature")
        ? { currentState: { type: "off" }, currentDeviceLevel: 0 }
        : {};
      return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.api_reachable, true);
  assert.deepEqual(methods, ["GET", "GET"]);
});

test("Hermes doctor audit reports legacy conflicts without exposing config values", async () => {
  const unsafeHome = await tokenHome();
  const unsafeHermes = path.join(unsafeHome, ".hermes");
  await mkdir(path.join(unsafeHermes, "skills", "eight-sleep-mcp"), { recursive: true });
  await writeFile(path.join(unsafeHermes, "skills", "eight-sleep-mcp", "SKILL.md"), "# legacy\n");
  const emailKey = ["EIGHT_SLEEP", "EMAIL"].join("_");
  const passwordKey = ["EIGHT_SLEEP", "PASSWORD"].join("_");
  const mutationKey = ["EIGHT_SLEEP", "ALLOW_MUTATIONS"].join("_");
  await writeFile(path.join(unsafeHermes, "config.yaml"), [
    "mcp_servers:",
    "  eight_sleep:",
    "    env:",
    `      ${emailKey}: private-owner@example.invalid`,
    `      ${passwordKey}: private-password-value`,
    `      ${mutationKey}: true`,
  ].join("\n"));

  const unsafe = await run(["doctor", "--check-hermes", "--json"], { home: unsafeHome, env: {} });
  assert.equal(unsafe.ok, false);
  assert.equal(unsafe.hermes.environment_safe, false);
  assert.equal(unsafe.hermes.ready_for_single_skill_use, false);
  assert.deepEqual(unsafe.hermes.conflicting_skill_paths, ["skills/eight-sleep-mcp/SKILL.md"]);
  assert.equal(unsafe.hermes.legacy_mcp_config_present, true);
  assert.equal(unsafe.hermes.config_contains_account_credentials, true);
  assert.equal(unsafe.hermes.persistent_mutations_enabled, true);
  const serialized = JSON.stringify(unsafe);
  assert.equal(serialized.includes("private-owner"), false);
  assert.equal(serialized.includes("private-password"), false);

  const safeHome = await tokenHome();
  const safeSkill = path.join(safeHome, ".hermes", "skills", "manage-eight-sleep");
  await mkdir(safeSkill, { recursive: true });
  await writeFile(path.join(safeSkill, "SKILL.md"), "# current\n");
  const safe = await run(["doctor", "--check-hermes", "--json"], { home: safeHome, env: {} });
  assert.equal(safe.ok, true);
  assert.equal(safe.hermes.environment_safe, true);
  assert.equal(safe.hermes.ready_for_single_skill_use, true);

  const unsafeProcess = await run(["doctor", "--check-hermes", "--json"], {
    home: safeHome,
    env: { EIGHT_SLEEP_ALLOW_MUTATIONS: "true" },
  });
  assert.equal(unsafeProcess.ok, false);
  assert.equal(unsafeProcess.hermes.current_process_mutations_enabled, true);
  assert.equal(unsafeProcess.hermes.environment_safe, false);
  assert.equal(unsafeProcess.hermes.ready_for_single_skill_use, false);
});

test("Hermes doctor distinguishes credential keys from a legacy MCP controller", async () => {
  const customHome = await tokenHome();
  const customHermes = path.join(customHome, ".hermes");
  const targetSkill = path.join(customHermes, "skills", "manage-eight-sleep");
  await mkdir(targetSkill, { recursive: true });
  await writeFile(path.join(targetSkill, "SKILL.md"), "# current\n");
  const emailKey = ["EIGHT_SLEEP", "EMAIL"].join("_");
  await writeFile(path.join(customHermes, "config.yaml"), [
    "environment:",
    `  ${emailKey}: private-owner@example.invalid`,
  ].join("\n"));

  const result = await run(["doctor", "--check-hermes", "--json"], { home: customHome, env: {} });
  assert.equal(result.hermes.legacy_mcp_config_present, false);
  assert.equal(result.hermes.config_contains_account_credentials, true);
  assert.equal(result.hermes.environment_safe, false);
  assert.equal(JSON.stringify(result).includes("private-owner"), false);
});

test("Hermes doctor detects block, list, and inline persistent mutation settings", async () => {
  for (const config of [
    "environment:\n  \"EIGHT_SLEEP_ALLOW_MUTATIONS\": \"true\"\n",
    "environment:\n  - EIGHT_SLEEP_ALLOW_MUTATIONS=true\n",
    "environment: { EIGHT_SLEEP_ALLOW_MUTATIONS: true }\n",
  ]) {
    const customHome = await tokenHome();
    const customHermes = path.join(customHome, ".hermes");
    const targetSkill = path.join(customHermes, "skills", "manage-eight-sleep");
    await mkdir(targetSkill, { recursive: true });
    await writeFile(path.join(targetSkill, "SKILL.md"), "# current\n");
    await writeFile(path.join(customHermes, "config.yaml"), config);

    const result = await run(["doctor", "--check-hermes", "--json"], { home: customHome, env: {} });
    assert.equal(result.ok, false);
    assert.equal(result.hermes.persistent_mutations_enabled, true);
    assert.equal(result.hermes.environment_safe, false);
  }
});

test("Hermes doctor audits persistent .env keys without returning their values", async () => {
  const customHome = await tokenHome();
  const customHermes = path.join(customHome, ".hermes");
  const targetSkill = path.join(customHermes, "skills", "manage-eight-sleep");
  await mkdir(targetSkill, { recursive: true });
  await writeFile(path.join(targetSkill, "SKILL.md"), "# current\n");
  await writeFile(path.join(customHermes, ".env"), [
    "  export \"EIGHT_SLEEP_ALLOW_MUTATIONS\" = \"true\" # persistent and unsafe",
    "export 'EIGHT_SLEEP_ACCESS_TOKEN' = synthetic-private-env-token",
    "EIGHT_SLEEP_USER_ID = synthetic-private-env-user",
    "EIGHT_SLEEP_EMAIL=synthetic-private-env-owner@example.invalid",
  ].join("\n"));

  const result = await run(["doctor", "--check-hermes", "--json"], { home: customHome, env: {} });
  assert.equal(result.ok, false);
  assert.equal(result.hermes.env_file, "~/.hermes/.env");
  assert.equal(result.hermes.env_file_exists, true);
  assert.equal(result.hermes.env_file_readable, true);
  assert.equal(result.hermes.env_persistent_mutations_enabled, true);
  assert.equal(result.hermes.env_contains_account_credentials, true);
  assert.equal(result.hermes.persistent_credentials_present, true);
  assert.equal(result.hermes.persistent_mutations_enabled, true);
  assert.equal(result.hermes.ready_for_single_skill_use, false);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("synthetic-private-env-token"), false);
  assert.equal(serialized.includes("synthetic-private-env-user"), false);
  assert.equal(serialized.includes("synthetic-private-env-owner"), false);
  assert.equal(serialized.includes(customHome), false);
});

test("Hermes doctor fails closed when .env cannot be read as a file", async () => {
  const customHome = await tokenHome();
  const customHermes = path.join(customHome, ".hermes");
  const targetSkill = path.join(customHermes, "skills", "manage-eight-sleep");
  await mkdir(targetSkill, { recursive: true });
  await writeFile(path.join(targetSkill, "SKILL.md"), "# current\n");
  await mkdir(path.join(customHermes, ".env"));

  const result = await run(["doctor", "--check-hermes", "--json"], { home: customHome, env: {} });
  assert.equal(result.ok, false);
  assert.equal(result.hermes.env_file_exists, true);
  assert.equal(result.hermes.env_file_readable, false);
  assert.equal(result.hermes.environment_safe, false);
  assert.equal(result.hermes.recommendations.some((entry) => /\.env could not be read safely/.test(entry)), true);
});

test("Hermes doctor explains an unreadable config instead of reporting a clean environment", async () => {
  const customHome = await tokenHome();
  const customHermes = path.join(customHome, ".hermes");
  const targetSkill = path.join(customHermes, "skills", "manage-eight-sleep");
  await mkdir(targetSkill, { recursive: true });
  await writeFile(path.join(targetSkill, "SKILL.md"), "# current\n");
  await mkdir(path.join(customHermes, "config.yaml"));

  const result = await run(["doctor", "--check-hermes", "--json"], { home: customHome, env: {} });
  assert.equal(result.ok, false);
  assert.equal(result.hermes.config_exists, true);
  assert.equal(result.hermes.config_readable, false);
  assert.equal(result.hermes.environment_safe, false);
  assert.equal(result.hermes.ready_for_single_skill_use, false);
  assert.equal(result.hermes.recommendations.some((entry) => /could not be read safely/.test(entry)), true);
  assert.equal(result.hermes.recommendations.some((entry) => /No conflicting/.test(entry)), false);
});

test("temperature get labels a backend snapshot without claiming phone UI observation", async () => {
  const result = await run(["temperature", "get", "--json"], {
    env: {
      EIGHT_SLEEP_ACCESS_TOKEN: "synthetic-token",
      EIGHT_SLEEP_USER_ID: "synthetic-user",
    },
    appBase: "https://app.mock.invalid",
    now: () => new Date("2026-07-13T12:00:00.000Z"),
    fetchImpl: async () => new Response(JSON.stringify({
      currentState: { type: "smart" },
      currentLevel: -20,
      currentDeviceLevel: -4,
      timeBased: { level: -20, durationSeconds: 900 },
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });

  assert.equal(result.app_state_source, "app_api_readback");
  assert.equal(result.app_verification_scope, "backend_snapshot_not_phone_ui");
  assert.equal(result.app_ui_observed, false);
  assert.equal(result.checked_at, "2026-07-13T12:00:00.000Z");
});

test("temperature verify is read-only and can check the requested duration", async () => {
  const methods = [];
  const result = await run([
    "temperature", "verify", "--app-level=-2", "--duration-seconds=900", "--json",
  ], {
    env: {
      EIGHT_SLEEP_ACCESS_TOKEN: "synthetic-token",
      EIGHT_SLEEP_USER_ID: "synthetic-user",
    },
    clientBase: "https://client.mock.invalid",
    appBase: "https://app.mock.invalid",
    verifyAttempts: 1,
    fetchImpl: async (url, init = {}) => {
      methods.push(init.method ?? "GET");
      const pathname = new URL(url).pathname;
      let payload;
      if (pathname.endsWith("/temperature")) {
        payload = {
          currentState: { type: "smart" },
          currentLevel: -20,
          currentDeviceLevel: 0,
          timeBased: { level: -20, durationSeconds: 900 },
        };
      } else if (pathname.endsWith("/current-device")) {
        payload = { id: "synthetic-device", side: "solo" };
      } else {
        payload = { leftUserId: "synthetic-user", leftNowHeating: -4 };
      }
      return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  assert.equal(result.kind, "temperature_verification");
  assert.equal(result.ok, true);
  assert.equal(result.verification_scope, "target_hardware_and_requested_duration");
  assert.equal(result.verification.app_state_verified, true);
  assert.equal(result.verification.app_ui_observed, false);
  assert.equal(result.verification.duration_verified_against_plan, true);
  assert.deepEqual(methods, ["GET", "GET", "GET", "GET"]);
});

test("temperature verify --off performs a strict read-only App and hardware check", async () => {
  const methods = [];
  const result = await run(["temperature", "verify", "--off", "--json"], {
    env: {
      EIGHT_SLEEP_ACCESS_TOKEN: "synthetic-token",
      EIGHT_SLEEP_USER_ID: "synthetic-user",
    },
    clientBase: "https://client.mock.invalid",
    appBase: "https://app.mock.invalid",
    verifyAttempts: 1,
    fetchImpl: async (url, init = {}) => {
      methods.push(init.method ?? "GET");
      const pathname = new URL(url).pathname;
      let payload;
      if (pathname.endsWith("/temperature")) {
        payload = {
          currentState: { type: "off" },
          currentLevel: 0,
          currentDeviceLevel: 0,
          timeBased: { level: 0, durationSeconds: 0 },
        };
      } else if (pathname.endsWith("/current-device")) {
        payload = { id: "synthetic-device", side: "solo" };
      } else {
        payload = { leftUserId: "synthetic-user", leftNowHeating: 0 };
      }
      return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  assert.equal(result.kind, "temperature_off_verification");
  assert.equal(result.ok, true);
  assert.equal(result.verification_scope, "app_backend_and_hardware_off_state");
  assert.equal(result.verification.app_state_verified, true);
  assert.equal(result.verification.hardware_verified, true);
  assert.deepEqual(methods, ["GET", "GET", "GET", "GET"]);
});

test("temperature verify rejects mixed off and level targets before networking", async () => {
  let fetchCalls = 0;
  await assert.rejects(run([
    "temperature", "verify", "--off", "--app-level=0",
  ], {
    home: "/synthetic-home",
    env: {},
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("network should not be reached");
    },
  }), (error) => error instanceof UsageError && /either temperature verify --off/.test(error.message));
  assert.equal(fetchCalls, 0);
});
