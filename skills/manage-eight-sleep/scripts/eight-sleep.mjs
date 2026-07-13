#!/usr/bin/env node

import os from "node:os";
import { pathToFileURL } from "node:url";
import {
  ApiError,
  EightSleepClient,
  UsageError,
  appLevelToRaw,
  assertWriteGate,
  getDeviceId,
  inspectCredentials,
  loadCredentials,
  parseOptions,
  redactSecrets,
  resolveDateRange,
  summarizeTemperature,
  summarizeTrends,
  temperatureSetBody,
  verifyOff,
  verifyTemperature,
} from "./eight-sleep-lib.mjs";

const VERSION = "0.1.0";

function usage() {
  return `Manage Eight Sleep ${VERSION}

Usage:
  eight-sleep.mjs doctor [--check-api] [--json]
  eight-sleep.mjs trends [--days 7 | --from YYYY-MM-DD --to YYYY-MM-DD]
                         [--timezone IANA] [--session-mode main|all] [--json]
  eight-sleep.mjs temperature get [--json]
  eight-sleep.mjs temperature verify --app-level -10..10 [--json]
  eight-sleep.mjs temperature set --app-level -10..10 [--duration-seconds 3600]
                                  [--apply --confirm-write=temperature:set:LEVEL:DURATION] [--json]
  eight-sleep.mjs temperature off [--apply --confirm-write=temperature:off] [--json]

Authentication:
  Reuses ~/.eight-sleep-mcp/tokens.json, or reads EIGHT_SLEEP_ACCESS_TOKEN and
  EIGHT_SLEEP_USER_ID. This tool never stores email or password.

Safety:
  Write commands are dry-run unless the apply flag and exact confirmation are present and
  EIGHT_SLEEP_ALLOW_MUTATIONS=true is set for that command.`;
}

function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined).map(([key, child]) => [key, clean(child)]));
  }
  return value;
}

function recognizedTemperature(summary) {
  return summary.state !== undefined
    || summary.current_level_raw !== undefined
    || summary.device_level_raw !== undefined
    || summary.time_based !== undefined;
}

function human(value, indent = "") {
  if (value === null || typeof value !== "object") return String(value);
  const lines = [];
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined) continue;
    if (Array.isArray(child)) {
      lines.push(`${indent}${key}:`);
      for (const item of child) lines.push(`${indent}  - ${typeof item === "object" ? JSON.stringify(clean(item)) : String(item)}`);
    } else if (child && typeof child === "object") {
      lines.push(`${indent}${key}:`);
      lines.push(human(child, `${indent}  `));
    } else {
      lines.push(`${indent}${key}: ${String(child)}`);
    }
  }
  return lines.join("\n");
}

async function makeClient(deps) {
  const credentials = await loadCredentials({ env: deps.env, home: deps.home, now: deps.now().getTime() });
  return {
    credentials,
    client: new EightSleepClient({
      credentials,
      env: deps.env,
      clientBase: deps.clientBase,
      appBase: deps.appBase,
      fetchImpl: deps.fetchImpl,
      sleep: deps.sleep,
      random: deps.random,
      timeoutMs: deps.timeoutMs,
    }),
  };
}

async function readDevice(client) {
  try {
    const currentDevice = await client.getCurrentDevice();
    const deviceId = getDeviceId(currentDevice);
    const device = deviceId ? await client.getDevice(deviceId) : undefined;
    return { currentDevice, device };
  } catch {
    return { currentDevice: undefined, device: undefined };
  }
}

async function pollTemperature(client, credentials, targetRaw, deps, expectedDuration) {
  let last;
  const attempts = deps.verifyAttempts;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await deps.sleep(deps.verifyIntervalMs);
    const temperature = await client.getTemperature();
    const { currentDevice, device } = await readDevice(client);
    last = verifyTemperature({
      temperature,
      currentDevice,
      device,
      targetRaw,
      expectedDuration,
      userId: credentials.userId,
    });
    if (last.accepted_by_api && last.hardware_verified) return last;
  }
  return last;
}

async function pollOff(client, credentials, deps) {
  let last;
  for (let attempt = 0; attempt < deps.verifyAttempts; attempt += 1) {
    if (attempt > 0) await deps.sleep(deps.verifyIntervalMs);
    const temperature = await client.getTemperature();
    const { currentDevice, device } = await readDevice(client);
    last = verifyOff({ temperature, currentDevice, device, userId: credentials.userId });
    if (last.hardware_verified) return last;
  }
  return last;
}

export async function run(argv, overrides = {}) {
  const deps = {
    env: overrides.env ?? process.env,
    home: overrides.home ?? os.homedir(),
    fetchImpl: overrides.fetchImpl ?? globalThis.fetch,
    sleep: overrides.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))),
    random: overrides.random ?? Math.random,
    now: overrides.now ?? (() => new Date()),
    timeoutMs: overrides.timeoutMs,
    clientBase: overrides.clientBase,
    appBase: overrides.appBase,
    verifyAttempts: overrides.verifyAttempts ?? 6,
    verifyIntervalMs: overrides.verifyIntervalMs ?? 10_000,
  };
  const { positionals, options } = parseOptions(argv);
  const command = positionals[0];
  const subcommand = positionals[1];

  if (!command || command === "help" || options.help) return { kind: "help", text: usage() };
  if (command === "version" || options.version) return { kind: "version", version: VERSION };

  if (command === "doctor") {
    const credentials = await inspectCredentials({ env: deps.env, home: deps.home, now: deps.now().getTime() });
    const nodeSupported = Number(process.versions.node.split(".")[0]) >= 22;
    let apiReachable;
    let apiError;
    let apiChecks;
    if (options["check-api"] && credentials.ready) {
      const { client } = await makeClient(deps);
      apiChecks = {};
      for (const [name, check] of [
        ["profile_read", () => client.getProfile()],
        ["temperature_read", async () => {
          const summary = summarizeTemperature(await client.getTemperature());
          if (!recognizedTemperature(summary)) throw new ApiError("Temperature response schema was not recognized.");
        }],
      ]) {
        try {
          await check();
          apiChecks[name] = { ok: true };
        } catch (error) {
          apiChecks[name] = { ok: false, error: redactSecrets(error?.message) };
        }
      }
      apiReachable = Object.values(apiChecks).every((check) => check.ok);
      apiError = apiReachable ? undefined : "One or more read-only API checks failed.";
    }
    return clean({
      kind: "doctor",
      ok: nodeSupported && credentials.ready && apiReachable !== false,
      node: { version: process.versions.node, supported: nodeSupported },
      credentials,
      mutations_enabled: deps.env.EIGHT_SLEEP_ALLOW_MUTATIONS === "true",
      privacy_default: "summary",
      api_reachable: apiReachable,
      api_checks: apiChecks,
      api_error: apiError,
    });
  }

  if (command === "trends") {
    const window = resolveDateRange(options, deps.now());
    const sessionMode = String(options["session-mode"] ?? "main");
    const { client } = await makeClient(deps);
    const payload = await client.getTrends({ ...window, sessionMode });
    return summarizeTrends(payload, { ...window, sessionMode });
  }

  if (command === "temperature" && subcommand === "get") {
    const { client } = await makeClient(deps);
    const summary = summarizeTemperature(await client.getTemperature());
    if (!recognizedTemperature(summary)) {
      throw new ApiError("Eight Sleep temperature response did not contain recognized fields; the private API schema may have changed.");
    }
    return { kind: "temperature", ...summary };
  }

  if (command === "temperature" && subcommand === "verify") {
    const targetAppLevel = Number(options["app-level"]);
    const targetRawLevel = appLevelToRaw(options["app-level"]);
    const { client, credentials } = await makeClient(deps);
    const verification = await pollTemperature(client, credentials, targetRawLevel, deps);
    return clean({
      kind: "temperature_verification",
      ok: Boolean(verification?.accepted_by_api && verification?.hardware_verified),
      target_app_level: targetAppLevel,
      target_raw_level: targetRawLevel,
      verification,
      warning: !verification?.accepted_by_api
        ? "The requested API state was not verified. No write was attempted."
        : verification?.hardware_verified
          ? undefined
          : "The API state matches, but hardware movement was not verified. No write was attempted.",
    });
  }

  if (command === "temperature" && subcommand === "set") {
    const plan = temperatureSetBody(options["app-level"], options["duration-seconds"]);
    const confirmation = `temperature:set:${Number(options["app-level"])}:${plan.duration}`;
    if (!options.apply) {
      return {
        kind: "temperature_set_plan",
        dry_run: true,
        target_app_level: Number(options["app-level"]),
        target_raw_level: plan.rawLevel,
        duration_seconds: plan.duration,
        writes_required: plan.steps.length,
        confirmation,
        next_step: `If the current turn already contains explicit authorization for this exact plan, set EIGHT_SLEEP_ALLOW_MUTATIONS=true for one process and add --apply --confirm-write=${confirmation}. Otherwise ask first.`,
      };
    }
    assertWriteGate(deps.env, options, confirmation);
    const posture = await inspectCredentials({ env: deps.env, home: deps.home, now: deps.now().getTime() });
    if (posture.source === "token_file" && posture.secure_permissions === false) {
      throw new UsageError("Refusing a write because the token file is readable by other local users. Set its permissions to 600 first.");
    }
    const { client, credentials } = await makeClient(deps);
    let writeError;
    let laterStepRejected = false;
    const completedSteps = [];
    for (const step of plan.steps) {
      try {
        await client.setTemperature(step.body);
        completedSteps.push(step.name);
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        if (!error.outcomeUnknown && completedSteps.length === 0) throw error;
        laterStepRejected = !error.outcomeUnknown;
        writeError = new ApiError(error.message, {
          status: error.status,
          outcomeUnknown: true,
        });
        break;
      }
    }
    let verification;
    try {
      verification = await pollTemperature(client, credentials, plan.rawLevel, deps, plan.duration);
    } catch (error) {
      throw new ApiError(`The temperature write may have applied, but read-back verification failed: ${redactSecrets(error?.message)}`, {
        status: error instanceof ApiError ? error.status : 0,
        outcomeUnknown: true,
      });
    }
    if (laterStepRejected) {
      throw new ApiError(`${writeError.message} An earlier step may have applied, but a later step was explicitly rejected; matching read-back cannot prove this command completed.`, {
        status: writeError.status,
        outcomeUnknown: true,
      });
    }
    if (writeError && !verification?.accepted_by_api) {
      throw new ApiError(`${writeError.message} The write outcome is unknown; it was not retried automatically.`, {
        status: writeError.status,
        outcomeUnknown: true,
      });
    }
    return clean({
      kind: "temperature_set_result",
      ok: Boolean(verification?.accepted_by_api && verification?.hardware_verified),
      target_app_level: Number(options["app-level"]),
      target_raw_level: plan.rawLevel,
      duration_seconds: plan.duration,
      completed_write_steps: completedSteps,
      write_transport_error_but_state_verified: Boolean(writeError && verification?.accepted_by_api),
      verification,
      warning: !verification?.accepted_by_api
        ? "The requested API state was not verified. The write may have partially applied; do not retry without a new current-turn instruction."
        : verification?.hardware_verified
          ? undefined
          : "The API state matches, but physical temperature movement was not verified. Do not claim success or retry automatically.",
    });
  }

  if (command === "temperature" && subcommand === "off") {
    if (!options.apply) {
      return {
        kind: "temperature_off_plan",
        dry_run: true,
        confirmation: "temperature:off",
        next_step: "If the current turn already contains explicit authorization to turn the Pod off, set EIGHT_SLEEP_ALLOW_MUTATIONS=true for one process and add --apply --confirm-write=temperature:off. Otherwise ask first.",
      };
    }
    assertWriteGate(deps.env, options, "temperature:off");
    const posture = await inspectCredentials({ env: deps.env, home: deps.home, now: deps.now().getTime() });
    if (posture.source === "token_file" && posture.secure_permissions === false) {
      throw new UsageError("Refusing a write because the token file is readable by other local users. Set its permissions to 600 first.");
    }
    const { client, credentials } = await makeClient(deps);
    let writeError;
    try {
      await client.turnOff();
    } catch (error) {
      writeError = error;
      if (!(error instanceof ApiError) || !error.outcomeUnknown) throw error;
    }
    let verification;
    try {
      verification = await pollOff(client, credentials, deps);
    } catch (error) {
      throw new ApiError(`The off command may have applied, but read-back verification failed: ${redactSecrets(error?.message)}`, {
        status: error instanceof ApiError ? error.status : 0,
        outcomeUnknown: true,
      });
    }
    if (writeError && !verification?.accepted_by_api) {
      throw new ApiError(`${writeError.message} The write outcome is unknown; it was not retried automatically.`, {
        status: writeError.status,
        outcomeUnknown: true,
      });
    }
    return clean({
      kind: "temperature_off_result",
      ok: Boolean(verification?.hardware_verified),
      write_transport_error_but_state_verified: Boolean(writeError && verification?.accepted_by_api),
      verification,
      warning: !verification?.accepted_by_api
        ? "The API off state was not verified. The command may have partially applied; do not retry without a new current-turn instruction."
        : !verification?.hardware_verified
          ? "The API reports off, but hardware reaching the off state was not verified. Do not claim success or retry automatically."
          : verification?.stale_time_based_override
            ? "The Pod is off and hardware state is verified, but a non-zero time-based override is still visible. Do not assume that the private API cleared it."
            : undefined,
    });
  }

  throw new UsageError(`Unknown command.\n\n${usage()}`);
}

export async function main(argv = process.argv.slice(2)) {
  const wantsJson = argv.includes("--json");
  try {
    const result = await run(argv);
    if (result.kind === "help") console.log(result.text);
    else console.log(wantsJson ? JSON.stringify(clean(result), null, 2) : human(clean(result)));
    if (result?.ok === false && ["temperature_set_result", "temperature_off_result", "temperature_verification"].includes(result.kind)) {
      process.exitCode = 4;
    } else if (result?.kind === "doctor" && result.ok === false) {
      process.exitCode = 2;
    }
  } catch (error) {
    const payload = {
      ok: false,
      error: error instanceof UsageError ? "usage_error" : error instanceof ApiError ? "api_error" : "unexpected_error",
      message: redactSecrets(error?.message),
      status: error instanceof ApiError && error.status ? error.status : undefined,
      outcome_unknown: error instanceof ApiError ? error.outcomeUnknown : undefined,
    };
    console.error(wantsJson ? JSON.stringify(clean(payload), null, 2) : human(clean(payload)));
    process.exitCode = error instanceof UsageError
      ? 2
      : error instanceof ApiError
        ? error.outcomeUnknown ? 4 : 3
        : 1;
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) await main();
