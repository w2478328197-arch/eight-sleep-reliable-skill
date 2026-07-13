import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { run } from "../skills/manage-eight-sleep/scripts/eight-sleep.mjs";
import {
  ApiError,
  UsageError,
  appLevelToRaw,
  buildTrendsUrl,
  fetchJsonWithRetry,
  redactSecrets,
  resolveDateRange,
  temperatureSetBody,
  verifyOff,
  verifyTemperature,
} from "../skills/manage-eight-sleep/scripts/eight-sleep-lib.mjs";

const CLIENT_BASE = "https://client.mock.invalid";
const APP_BASE = "https://app.mock.invalid";
const USER_ID = "synthetic-user-001";
const DEVICE_ID = "synthetic-device-001";
const ACCESS_TOKEN = "synthetic-access-token-never-use";

const originalFetch = globalThis.fetch;
let unexpectedGlobalFetches = 0;

before(() => {
  globalThis.fetch = async () => {
    unexpectedGlobalFetches += 1;
    throw new Error("UNEXPECTED_REAL_NETWORK");
  };
});

after(() => {
  try {
    assert.equal(unexpectedGlobalFetches, 0, "tests must never fall through to global fetch");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function recordingFetch(handler) {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const call = {
      url: String(input),
      method: String(init.method ?? "GET").toUpperCase(),
      headers: init.headers ?? {},
      body: init.body,
      redirect: init.redirect,
    };
    calls.push(call);
    return handler(call, calls.length - 1);
  };
  return { calls, fetchImpl };
}

function commandDeps(fetchImpl, overrides = {}) {
  return {
    env: {
      EIGHT_SLEEP_ACCESS_TOKEN: ACCESS_TOKEN,
      EIGHT_SLEEP_USER_ID: USER_ID,
      EIGHT_SLEEP_ALLOW_MUTATIONS: "true",
    },
    home: "/synthetic-home-that-must-not-be-read",
    fetchImpl,
    clientBase: CLIENT_BASE,
    appBase: APP_BASE,
    timeoutMs: 1_000,
    verifyAttempts: 1,
    verifyIntervalMs: 0,
    sleep: async () => {},
    random: () => 0,
    now: () => new Date("2026-07-13T12:00:00.000Z"),
    ...overrides,
  };
}

function setArguments(extra = []) {
  return [
    "temperature",
    "set",
    "--app-level=-2",
    "--duration-seconds=3600",
    "--apply",
    "--confirm-write=temperature:set:-2:3600",
    ...extra,
  ];
}

function successfulDevicePayload(level) {
  return {
    leftUserId: USER_ID,
    rightUserId: "synthetic-other-user",
    leftNowHeating: level,
    rightNowHeating: 0,
  };
}

test("trends main and all modes emit exactly one mutually exclusive query parameter", () => {
  const common = {
    clientBase: CLIENT_BASE,
    userId: USER_ID,
    from: "2026-07-01",
    to: "2026-07-14",
    timezone: "Asia/Shanghai",
  };

  const main = new URL(buildTrendsUrl({ ...common, sessionMode: "main" }));
  assert.equal(main.searchParams.get("include-main"), "true");
  assert.equal(main.searchParams.has("include-all-sessions"), false);
  assert.deepEqual(
    [...main.searchParams.keys()].filter((key) => key.startsWith("include-")),
    ["include-main"],
  );

  const all = new URL(buildTrendsUrl({ ...common, sessionMode: "all" }));
  assert.equal(all.searchParams.get("include-all-sessions"), "true");
  assert.equal(all.searchParams.has("include-main"), false);
  assert.deepEqual(
    [...all.searchParams.keys()].filter((key) => key.startsWith("include-")),
    ["include-all-sessions"],
  );

  assert.throws(
    () => buildTrendsUrl({ ...common, sessionMode: "both" }),
    (error) => error instanceof UsageError && /main or all/.test(error.message),
  );
});

test("calendar dates, ranges, App levels, and override durations are validated", () => {
  assert.throws(
    () => resolveDateRange({ from: "2026-02-30", to: "2026-03-02", timezone: "UTC" }),
    (error) => error instanceof UsageError && /valid calendar date/.test(error.message),
  );
  assert.throws(
    () => resolveDateRange({ from: "2026-07-13", to: "2026-07-13", timezone: "UTC" }),
    (error) => error instanceof UsageError && /later than/.test(error.message),
  );
  assert.throws(
    () => resolveDateRange({ from: "2026-07-01", timezone: "UTC" }),
    (error) => error instanceof UsageError && /together/.test(error.message),
  );

  assert.equal(appLevelToRaw(-10), -100);
  assert.equal(appLevelToRaw(-2), -20);
  assert.equal(appLevelToRaw(0), 0);
  assert.equal(appLevelToRaw(10), 100);
  assert.throws(() => appLevelToRaw(-2.5), UsageError);
  assert.throws(() => appLevelToRaw(-11), UsageError);
  assert.throws(() => appLevelToRaw(11), UsageError);
  assert.throws(() => temperatureSetBody(-2, 0), /at least 60/);
  assert.throws(() => temperatureSetBody(-2, 14_401), /at most 14400/);
});

test("doctor is offline by default and does not expose credential values", async () => {
  let injectedFetchCalls = 0;
  const result = await run(["doctor", "--json"], commandDeps(async () => {
    injectedFetchCalls += 1;
    throw new Error("doctor must remain offline");
  }, {
    env: {
      EIGHT_SLEEP_ACCESS_TOKEN: ACCESS_TOKEN,
      EIGHT_SLEEP_USER_ID: USER_ID,
    },
  }));

  assert.equal(injectedFetchCalls, 0);
  assert.equal(result.kind, "doctor");
  assert.equal(result.ok, true);
  assert.equal(result.credentials.source, "environment");
  assert.equal(result.credentials.ready, true);
  assert.equal("api_reachable" in result, false);
  assert.equal(JSON.stringify(result).includes(ACCESS_TOKEN), false);
});

test("dry-run and write gates finish before token-file access or networking", async () => {
  let fetchCalls = 0;
  const noTouch = async () => {
    fetchCalls += 1;
    throw new Error("network must not be touched");
  };
  const inaccessibleAuth = {
    env: { EIGHT_SLEEP_TOKEN_PATH: "/synthetic/path/that/must/not/be/read.json" },
    home: "/synthetic-home-that-must-not-be-read",
    fetchImpl: noTouch,
  };

  const plan = await run([
    "temperature",
    "set",
    "--app-level=-2",
    "--duration-seconds=3600",
  ], inaccessibleAuth);
  assert.equal(plan.kind, "temperature_set_plan");
  assert.equal(plan.dry_run, true);
  assert.equal(plan.writes_required, 3);
  assert.equal(plan.confirmation, "temperature:set:-2:3600");
  assert.equal(fetchCalls, 0);

  await assert.rejects(
    run(setArguments(), inaccessibleAuth),
    (error) => error instanceof UsageError && /Writes are disabled/.test(error.message),
  );
  assert.equal(fetchCalls, 0);

  await assert.rejects(
    run([
      "temperature",
      "set",
      "--app-level=-2",
      "--duration-seconds=3600",
      "--apply",
      "--confirm-write=wrong",
    ], {
      ...inaccessibleAuth,
      env: {
        EIGHT_SLEEP_ALLOW_MUTATIONS: "true",
        EIGHT_SLEEP_TOKEN_PATH: "/synthetic/path/that/must/not/be/read.json",
      },
    }),
    (error) => error instanceof UsageError && /requires --apply and --confirm-write/.test(error.message),
  );
  assert.equal(fetchCalls, 0);
});

test("temperature set performs the three guarded writes in order and verifies physical movement", async () => {
  const mock = recordingFetch((call) => {
    const url = new URL(call.url);
    if (call.method === "PUT" && url.origin === APP_BASE) return jsonResponse({ accepted: true });
    if (call.method === "GET" && url.origin === APP_BASE && url.pathname.endsWith("/temperature")) {
      return jsonResponse({
        currentState: { type: "smart" },
        currentLevel: -20,
        currentDeviceLevel: 0,
        timeBased: { level: -20, durationSeconds: 3_600 },
      });
    }
    if (call.method === "GET" && url.pathname.endsWith("/current-device")) {
      return jsonResponse({ id: DEVICE_ID, side: "solo" });
    }
    if (call.method === "GET" && url.pathname === `/v1/devices/${DEVICE_ID}`) {
      return jsonResponse(successfulDevicePayload(-5));
    }
    throw new Error(`Unexpected synthetic request: ${call.method} ${call.url}`);
  });

  const result = await run(setArguments(), commandDeps(mock.fetchImpl));
  const putCalls = mock.calls.filter((call) => call.method === "PUT");

  assert.equal(result.kind, "temperature_set_result");
  assert.equal(result.ok, true);
  assert.equal(result.verification.accepted_by_api, true);
  assert.equal(result.verification.hardware_verified, true);
  assert.equal(result.verification.side_resolved, true);
  assert.equal(result.verification.observed_device_level_raw, -5);
  assert.equal(putCalls.length, 3);
  assert.equal(putCalls.every((call) => call.redirect === "error"), true);
  assert.deepEqual(putCalls.map((call) => JSON.parse(call.body)), [
    { currentState: { type: "smart" } },
    { currentLevel: -20, currentState: { type: "smart" } },
    { timeBased: { level: -20, durationSeconds: 3_600 } },
  ]);
  assert.equal(JSON.stringify(result).includes(ACCESS_TOKEN), false);
});

test("device user-id mapping overrides a conflicting declared side and target-only fields do not prove movement", () => {
  const common = {
    temperature: {
      currentState: { type: "smart" },
      currentLevel: -20,
      currentDeviceLevel: 0,
      timeBased: { level: -20, durationSeconds: 900 },
    },
    currentDevice: { side: "right" },
    targetRaw: -20,
    userId: USER_ID,
  };

  const mapped = verifyTemperature({
    ...common,
    device: {
      leftUserId: USER_ID,
      rightUserId: "synthetic-other-user",
      leftNowHeating: -4,
      rightNowHeating: 5,
    },
  });
  assert.equal(mapped.hardware_verified, true);
  assert.equal(mapped.device_signal, "leftNowHeating");
  assert.equal(mapped.observed_device_level_raw, -4);

  const targetOnly = verifyTemperature({
    ...common,
    device: {
      leftUserId: USER_ID,
      rightUserId: "synthetic-other-user",
      leftTargetLevel: -20,
    },
  });
  assert.equal(targetOnly.accepted_by_api, true);
  assert.equal(targetOnly.hardware_verified, false);
  assert.equal(targetOnly.device_signal, undefined);
  assert.equal(targetOnly.device_target_signal, "leftTargetLevel");

  const wrongDuration = verifyTemperature({
    ...common,
    expectedDuration: 3_600,
    temperature: {
      ...common.temperature,
      timeBased: { level: -20, durationSeconds: 900 },
    },
    device: {
      leftUserId: USER_ID,
      rightUserId: "synthetic-other-user",
      leftNowHeating: -4,
    },
  });
  assert.equal(wrongDuration.accepted_by_api, false);
  assert.equal(wrongDuration.hardware_verified, true);

  for (const durationSeconds of [0, 180]) {
    const invalidShortPlanState = verifyTemperature({
      ...common,
      expectedDuration: 60,
      temperature: {
        ...common.temperature,
        timeBased: { level: -20, durationSeconds },
      },
      device: {
        leftUserId: USER_ID,
        rightUserId: "synthetic-other-user",
        leftNowHeating: -4,
      },
    });
    assert.equal(invalidShortPlanState.accepted_by_api, false);
  }

  const unknownSmartLikeState = verifyTemperature({
    ...common,
    temperature: {
      ...common.temperature,
      currentState: { type: "not-smart" },
    },
    device: {
      leftUserId: USER_ID,
      rightUserId: "synthetic-other-user",
      leftNowHeating: -4,
    },
  });
  assert.equal(unknownSmartLikeState.accepted_by_api, false);

  const conflictingActualSignals = verifyTemperature({
    ...common,
    temperature: {
      ...common.temperature,
      currentDeviceLevel: -4,
    },
    device: {
      leftUserId: USER_ID,
      rightUserId: "synthetic-other-user",
      leftNowHeating: 5,
    },
  });
  assert.equal(conflictingActualSignals.hardware_verified, false);
  assert.equal(conflictingActualSignals.observed_device_level_raw, 5);

  const conflictingOffSignals = verifyOff({
    temperature: { currentState: { type: "off" }, currentDeviceLevel: 0 },
    currentDevice: { side: "solo" },
    device: {
      leftUserId: USER_ID,
      rightUserId: "synthetic-other-user",
      leftNowHeating: 5,
    },
    userId: USER_ID,
  });
  assert.equal(conflictingOffSignals.accepted_by_api, true);
  assert.equal(conflictingOffSignals.hardware_verified, false);
  assert.equal(conflictingOffSignals.observed_device_level_raw, 5);

  const unresolved = verifyTemperature({
    ...common,
    currentDevice: { side: "solo" },
    device: {
      leftUserId: "different-user",
      rightUserId: "synthetic-other-user",
      leftNowHeating: -4,
    },
  });
  assert.equal(unresolved.side_resolved, false);
  assert.equal(unresolved.hardware_verified, false);
});

test("an explicitly rejected later write step cannot be reported as successful from pre-existing matching state", async () => {
  let putNumber = 0;
  const mock = recordingFetch((call) => {
    const url = new URL(call.url);
    if (call.method === "PUT") {
      putNumber += 1;
      return putNumber === 1
        ? jsonResponse({ accepted: true })
        : jsonResponse({ error: "synthetic rejection" }, 400);
    }
    if (url.origin === APP_BASE && url.pathname.endsWith("/temperature")) {
      return jsonResponse({
        currentState: { type: "smart" },
        currentLevel: -20,
        currentDeviceLevel: -4,
        timeBased: { level: -20, durationSeconds: 3_600 },
      });
    }
    if (url.pathname.endsWith("/current-device")) return jsonResponse({ id: DEVICE_ID, side: "solo" });
    if (url.pathname === `/v1/devices/${DEVICE_ID}`) return jsonResponse(successfulDevicePayload(-4));
    throw new Error(`Unexpected synthetic request: ${call.method} ${call.url}`);
  });

  await assert.rejects(run(setArguments(), commandDeps(mock.fetchImpl)), (error) => {
    assert.equal(error instanceof ApiError, true);
    assert.equal(error.outcomeUnknown, true);
    assert.match(error.message, /later step was explicitly rejected/);
    return true;
  });
  assert.equal(mock.calls.filter((call) => call.method === "PUT").length, 2);
});

test("temperature set reports API acceptance without claiming success when physical verification never completes", async () => {
  const mock = recordingFetch((call) => {
    const url = new URL(call.url);
    if (call.method === "PUT") return jsonResponse({ accepted: true });
    if (url.origin === APP_BASE && url.pathname.endsWith("/temperature")) {
      return jsonResponse({
        currentState: { type: "smart" },
        currentLevel: -20,
        currentDeviceLevel: 0,
        timeBased: { level: -20, durationSeconds: 3_600 },
      });
    }
    if (url.pathname.endsWith("/current-device")) return jsonResponse({ id: DEVICE_ID, side: "solo" });
    if (url.pathname === `/v1/devices/${DEVICE_ID}`) return jsonResponse(successfulDevicePayload(0));
    throw new Error(`Unexpected synthetic request: ${call.method} ${call.url}`);
  });

  const result = await run(setArguments(), commandDeps(mock.fetchImpl, { verifyAttempts: 2 }));

  assert.equal(result.ok, false);
  assert.equal(result.verification.accepted_by_api, true);
  assert.equal(result.verification.hardware_verified, false);
  assert.match(result.warning, /Do not claim success/);
  assert.equal(mock.calls.filter((call) => call.method === "PUT").length, 3);
  assert.equal(mock.calls.filter((call) => call.method === "GET").length, 6);
});

test("temperature off verifies the mapped physical side at zero and warns about a stale override", async () => {
  const mock = recordingFetch((call) => {
    const url = new URL(call.url);
    if (call.method === "PUT") return jsonResponse({ accepted: true });
    if (url.origin === APP_BASE && url.pathname.endsWith("/temperature")) {
      return jsonResponse({
        currentState: { type: "off" },
        timeBased: { level: -20, durationSeconds: 1_200 },
      });
    }
    if (url.pathname.endsWith("/current-device")) return jsonResponse({ id: DEVICE_ID, side: "solo" });
    if (url.pathname === `/v1/devices/${DEVICE_ID}`) return jsonResponse(successfulDevicePayload(0));
    throw new Error(`Unexpected synthetic request: ${call.method} ${call.url}`);
  });

  const result = await run([
    "temperature",
    "off",
    "--apply",
    "--confirm-write=temperature:off",
  ], commandDeps(mock.fetchImpl));

  const putCalls = mock.calls.filter((call) => call.method === "PUT");
  assert.equal(putCalls.length, 1);
  assert.deepEqual(JSON.parse(putCalls[0].body), { currentState: { type: "off" } });
  assert.equal(result.kind, "temperature_off_result");
  assert.equal(result.ok, true);
  assert.equal(result.verification.accepted_by_api, true);
  assert.equal(result.verification.hardware_verified, true);
  assert.equal(result.verification.stale_time_based_override, true);
  assert.match(result.warning, /non-zero time-based override/);
  assert.equal(mock.calls.some((call) => new URL(call.url).pathname.endsWith("/current-device")), true);
  assert.equal(mock.calls.some((call) => new URL(call.url).pathname === `/v1/devices/${DEVICE_ID}`), true);
});

test("GET retries transient network failures with synthetic backoff", async () => {
  let attempts = 0;
  const sleeps = [];
  const payload = await fetchJsonWithRetry("https://retry.mock.invalid/resource", {
    attempts: 3,
    timeoutMs: 1_000,
    random: () => 0,
    sleep: async (milliseconds) => sleeps.push(milliseconds),
    fetchImpl: async (_url, init) => {
      assert.equal(init.redirect, "follow");
      attempts += 1;
      if (attempts < 3) throw new Error("synthetic transient network failure");
      return jsonResponse({ ok: true });
    },
  });

  assert.deepEqual(payload, { ok: true });
  assert.equal(attempts, 3);
  assert.deepEqual(sleeps, [500, 1_000]);
});

test("PUT is never retried after an ambiguous server failure", async () => {
  let attempts = 0;
  const sleeps = [];

  await assert.rejects(
    fetchJsonWithRetry("https://write.mock.invalid/resource", {
      method: "PUT",
      body: { synthetic: true },
      attempts: 3,
      timeoutMs: 1_000,
      sleep: async (milliseconds) => sleeps.push(milliseconds),
      fetchImpl: async (_url, init) => {
        assert.equal(init.redirect, "error");
        attempts += 1;
        return jsonResponse({ error: "synthetic upstream failure" }, 503);
      },
    }),
    (error) => {
      assert.equal(error instanceof ApiError, true);
      assert.equal(error.status, 503);
      assert.equal(error.outcomeUnknown, true);
      return true;
    },
  );

  assert.equal(attempts, 1);
  assert.deepEqual(sleeps, []);
});

test("write-side HTTP 408 and malformed success responses are treated as unknown outcomes", async () => {
  for (const response of [
    () => jsonResponse({ error: "synthetic timeout" }, 408),
    () => new Response("not-json", { status: 200, headers: { "content-type": "text/plain" } }),
  ]) {
    let attempts = 0;
    await assert.rejects(fetchJsonWithRetry("https://write.mock.invalid/resource", {
      method: "PUT",
      body: { synthetic: true },
      attempts: 3,
      timeoutMs: 1_000,
      fetchImpl: async () => {
        attempts += 1;
        return response();
      },
    }), (error) => error instanceof ApiError && error.outcomeUnknown === true);
    assert.equal(attempts, 1);
  }
});

test("response streaming enforces the byte limit before accepting an oversized body", async () => {
  await assert.rejects(fetchJsonWithRetry("https://size.mock.invalid/resource", {
    attempts: 1,
    maxResponseBytes: 10,
    fetchImpl: async () => new Response("12345678901", {
      status: 200,
      headers: { "content-type": "text/plain" },
    }),
  }), (error) => error instanceof ApiError && /safety limit/.test(error.message));

  let canceled = false;
  const declaredOversizeBody = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("small"));
    },
    cancel() {
      canceled = true;
    },
  });
  await assert.rejects(fetchJsonWithRetry("https://size.mock.invalid/declared", {
    attempts: 1,
    maxResponseBytes: 10,
    fetchImpl: async () => new Response(declaredOversizeBody, {
      status: 200,
      headers: { "content-length": "100" },
    }),
  }), (error) => error instanceof ApiError && /safety limit/.test(error.message));
  assert.equal(canceled, true);
});

test("HTTP errors scrub exact request tokens and path identifiers even in plain prose", async () => {
  const userId = "123e4567-e89b-12d3-a456-426614174000";
  const opaqueToken = "opaque-request-token-123";
  await assert.rejects(fetchJsonWithRetry(`https://client.mock.invalid/v1/users/${userId}`, {
    attempts: 1,
    headers: { Authorization: `Bearer ${opaqueToken}` },
    fetchImpl: async () => jsonResponse({
      error: `Unknown user ${userId}; rejected credential ${opaqueToken}`,
    }, 404),
  }), (error) => {
    assert.equal(error instanceof ApiError, true);
    assert.equal(error.message.includes(userId), false);
    assert.equal(error.message.includes(opaqueToken), false);
    assert.match(error.message, /redacted/);
    return true;
  });
});

test("secret redaction covers authorization, JWTs, credential fields, emails, and network errors", async () => {
  const jwt = "eyJabcdefghijk.abcdefghijk.abcdefghijk";
  const token68 = "ab+/".repeat(18) + "==";
  const unquotedAssignment = ["access", "token"].join("_") + "=" + ["unquoted", "secret", "value", "123456789"].join("-");
  const symbolPassword = ["pass", "word"].join("") + "=\"" + ["sym", "bol!", "secret#", "value$", "123"].join("") + "\"";
  const longBareSecret = "a".repeat(72);
  const source = [
    "Authorization: Bearer bearer-secret-123",
    `Authorization: Bearer ${token68}`,
    jwt,
    "{\"access_token\":\"json-token-secret\",\"password\":\"password-secret\",\"client_secret\":\"client-secret-value\"}",
    unquotedAssignment,
    symbolPassword,
    longBareSecret,
    "owner@example.com",
  ].join(" ");
  const redacted = redactSecrets(source);

  for (const secret of ["bearer-secret-123", token68, jwt, "json-token-secret", "password-secret", "client-secret-value", unquotedAssignment.split("=")[1], symbolPassword.split("=\"")[1].slice(0, -1), longBareSecret, "owner@example.com"]) {
    assert.equal(redacted.includes(secret), false, `redacted output leaked ${secret}`);
  }
  assert.match(redacted, /<redacted/);

  await assert.rejects(
    fetchJsonWithRetry("https://redaction.mock.invalid/resource", {
      attempts: 1,
      timeoutMs: 1_000,
      fetchImpl: async () => {
        throw new Error(source);
      },
    }),
    (error) => {
      assert.equal(error instanceof ApiError, true);
      assert.equal(error.message.includes("bearer-secret-123"), false);
      assert.equal(error.message.includes(jwt), false);
      assert.equal(error.message.includes("owner@example.com"), false);
      return true;
    },
  );
});
