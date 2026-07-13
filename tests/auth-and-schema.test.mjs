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

test("temperature verify is read-only and reports matching API and device evidence", async () => {
  const methods = [];
  const result = await run(["temperature", "verify", "--app-level=-2", "--json"], {
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
  assert.deepEqual(methods, ["GET", "GET", "GET"]);
});
