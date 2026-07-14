#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ApiError,
  EightSleepClient,
  UsageError,
  appLevelToRaw,
  assertWriteGate,
  getDeviceId,
  inspectCredentials,
  loadCredentials,
  numberOption,
  parseOptions,
  redactSecrets,
  resolveDateRange,
  summarizeTemperature,
  summarizeTrends,
  temperatureSetBody,
  verifyOff,
  verifyTemperature,
} from "./eight-sleep-lib.mjs";

const VERSION = "0.2.0";

function usage() {
  return `Manage Eight Sleep ${VERSION}

Usage:
  eight-sleep.mjs doctor [--check-api] [--check-hermes] [--json]
  eight-sleep.mjs trends [--days 7 | --from YYYY-MM-DD --to YYYY-MM-DD]
                         [--timezone IANA] [--session-mode main|all] [--json]
  eight-sleep.mjs temperature get [--json]
  eight-sleep.mjs temperature verify --app-level -10..10 [--duration-seconds 3600] [--json]
  eight-sleep.mjs temperature verify --off [--json]
  eight-sleep.mjs temperature set --app-level -10..10 --duration-seconds 60..14400
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

function assertCommandShape(positionals, options, {
  positionalCount,
  allowedOptions,
  booleanOptions = [],
}) {
  if (positionals.length !== positionalCount) {
    throw new UsageError("Unexpected positional argument. Check the command usage.");
  }
  const allowed = new Set(allowedOptions);
  const unknown = Object.keys(options).filter((name) => !allowed.has(name));
  if (unknown.length > 0) {
    throw new UsageError(`Unknown option --${unknown[0]}. Check the option spelling.`);
  }
  for (const name of booleanOptions) {
    if (options[name] !== undefined && options[name] !== true) {
      throw new UsageError(`--${name} does not take a value.`);
    }
  }
}

async function pathExists(filename) {
  try {
    await access(filename);
    return true;
  } catch {
    return false;
  }
}

function persistentMutationEnabled(text) {
  return /\bEIGHT_SLEEP_ALLOW_MUTATIONS\b["']?\s*(?::|=)\s*["']?true(?:["'](?=\s|[,}\]#]|$)|(?=\s|[,}\]#]|$))/i.test(text);
}

function persistentCredentialKeysPresent(text) {
  return /\bEIGHT_SLEEP_(?:EMAIL|PASSWORD|ACCESS_TOKEN|USER_ID)\b/i.test(text);
}

function inspectDotEnv(text) {
  let mutationsEnabled = false;
  let credentialKeysPresent = false;
  for (const rawLine of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    line = line.replace(/^export\s+/i, "");
    const assignment = line.match(/^(?:["']([A-Za-z_][A-Za-z0-9_]*)["']|([A-Za-z_][A-Za-z0-9_]*))\s*=\s*(.*)$/);
    if (!assignment) continue;
    const name = (assignment[1] ?? assignment[2]).toUpperCase();
    const rawValue = assignment[3];
    if ([
      "EIGHT_SLEEP_EMAIL",
      "EIGHT_SLEEP_PASSWORD",
      "EIGHT_SLEEP_ACCESS_TOKEN",
      "EIGHT_SLEEP_USER_ID",
    ].includes(name)) {
      credentialKeysPresent = true;
    }
    if (name === "EIGHT_SLEEP_ALLOW_MUTATIONS"
      && /^(?:"true"|'true'|true)(?:\s*(?:#.*)?)?$/i.test(rawValue.trim())) {
      mutationsEnabled = true;
    }
  }
  return { mutationsEnabled, credentialKeysPresent };
}

async function inspectHermesEnvironment({ env, home }) {
  const configuredHome = env.HERMES_HOME;
  const hermesHome = path.resolve(configuredHome || path.join(home, ".hermes"));
  const skillsRoot = path.join(hermesHome, "skills");
  const targetSkill = path.join(skillsRoot, "manage-eight-sleep", "SKILL.md");
  const conflictCandidates = [
    path.join("eight-sleep-mcp", "SKILL.md"),
    path.join("eight-sleep", "SKILL.md"),
    path.join("smart-home", "eight-sleep", "SKILL.md"),
  ];
  const conflictingSkillPaths = [];
  for (const relative of conflictCandidates) {
    if (await pathExists(path.join(skillsRoot, relative))) {
      conflictingSkillPaths.push(path.posix.join("skills", ...relative.split(path.sep)));
    }
  }

  const configPath = path.join(hermesHome, "config.yaml");
  const configExists = await pathExists(configPath);
  let configReadable = configExists ? false : undefined;
  let config = "";
  if (configExists) {
    try {
      config = await readFile(configPath, "utf8");
      configReadable = true;
    } catch {
      configReadable = false;
    }
  }

  const legacyMcpConfigPresent = /^[ \t]*["']?(?:eight[-_]sleep|eight-sleep-mcp)["']?\s*:/im.test(config)
    || /eight-sleep-mcp-(?:unofficial|server)/i.test(config)
    || /\beight_sleep_(?:connection_status|get_|set_|turn_)/i.test(config);
  const configCredentialsPresent = persistentCredentialKeysPresent(config);
  const configMutationsEnabled = persistentMutationEnabled(config);

  const envFilePath = path.join(hermesHome, ".env");
  const envFileExists = await pathExists(envFilePath);
  let envFileReadable = envFileExists ? false : undefined;
  let envFileInspection = { mutationsEnabled: false, credentialKeysPresent: false };
  if (envFileExists) {
    try {
      envFileInspection = inspectDotEnv(await readFile(envFilePath, "utf8"));
      envFileReadable = true;
    } catch {
      envFileReadable = false;
    }
  }

  const accountCredentialsPresent = configCredentialsPresent || envFileInspection.credentialKeysPresent;
  const persistentMutationsEnabled = configMutationsEnabled || envFileInspection.mutationsEnabled;
  const currentProcessMutationsEnabled = env.EIGHT_SLEEP_ALLOW_MUTATIONS === "true";
  const environmentSafe = conflictingSkillPaths.length === 0
    && configReadable !== false
    && envFileReadable !== false
    && !legacyMcpConfigPresent
    && !accountCredentialsPresent
    && !persistentMutationsEnabled
    && !currentProcessMutationsEnabled;
  const targetSkillInstalled = await pathExists(targetSkill);
  const recommendations = [];
  if (conflictingSkillPaths.length > 0) {
    recommendations.push("Back up or disable the listed legacy Eight Sleep skills before using Hermes temperature writes.");
  }
  if (legacyMcpConfigPresent) {
    recommendations.push("Back up config.yaml, then remove or disable the legacy Eight Sleep MCP block so Hermes has one control path.");
  }
  if (configExists && configReadable === false) {
    recommendations.push("Hermes config.yaml could not be read safely. Fix its local file permissions or audit it manually before enabling writes; do not print its contents.");
  }
  if (envFileExists && envFileReadable === false) {
    recommendations.push("Hermes .env could not be read safely. Fix its local file permissions or audit its key names manually before enabling writes; do not print its contents.");
  }
  if (accountCredentialsPresent) {
    recommendations.push("Remove persistent Eight Sleep credential entries from Hermes config.yaml or .env after token-file setup succeeds.");
  }
  if (persistentMutationsEnabled) {
    recommendations.push("Remove the persistent EIGHT_SLEEP_ALLOW_MUTATIONS setting; enable it only for one confirmed CLI process.");
  }
  if (currentProcessMutationsEnabled) {
    recommendations.push("Run the Hermes audit without EIGHT_SLEEP_ALLOW_MUTATIONS; enable it only for the separately confirmed write process.");
  }
  if (!targetSkillInstalled) {
    recommendations.push("Install manage-eight-sleep into this Hermes home before relying on the integration.");
  }
  if (recommendations.length === 0 && environmentSafe) {
    recommendations.push("No conflicting Eight Sleep skills or legacy Hermes mutation settings were detected.");
  }

  return {
    checked: true,
    home: configuredHome ? "$HERMES_HOME" : "~/.hermes",
    target_skill_installed: targetSkillInstalled,
    conflicting_skill_paths: conflictingSkillPaths,
    config_exists: configExists,
    config_readable: configReadable,
    legacy_mcp_config_present: legacyMcpConfigPresent,
    config_contains_account_credentials: configCredentialsPresent,
    config_persistent_mutations_enabled: configMutationsEnabled,
    env_file: configuredHome ? "$HERMES_HOME/.env" : "~/.hermes/.env",
    env_file_exists: envFileExists,
    env_file_readable: envFileReadable,
    env_contains_account_credentials: envFileInspection.credentialKeysPresent,
    env_persistent_mutations_enabled: envFileInspection.mutationsEnabled,
    persistent_credentials_present: accountCredentialsPresent,
    persistent_mutations_enabled: persistentMutationsEnabled,
    current_process_mutations_enabled: currentProcessMutationsEnabled,
    environment_safe: environmentSafe,
    ready_for_single_skill_use: environmentSafe && targetSkillInstalled,
    recommendations,
  };
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

async function pollTemperature(
  client,
  credentials,
  targetRaw,
  deps,
  expectedDuration,
  planStartedAtMs,
  planSettledAtMs,
) {
  let last;
  const attempts = deps.verifyAttempts;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await deps.sleep(deps.verifyIntervalMs);
    const temperature = await client.getTemperature();
    const checkedAt = deps.now();
    const { currentDevice, device } = await readDevice(client);
    last = verifyTemperature({
      temperature,
      currentDevice,
      device,
      targetRaw,
      expectedDuration,
      verificationElapsedSeconds: planStartedAtMs === undefined
        ? undefined
        : (checkedAt.getTime() - planStartedAtMs) / 1_000,
      verificationMinimumElapsedSeconds: planSettledAtMs === undefined
        ? undefined
        : (checkedAt.getTime() - planSettledAtMs) / 1_000,
      userId: credentials.userId,
      checkedAt: checkedAt.toISOString(),
    });
    if (last.hardware_verified) {
      const finalTemperature = await client.getTemperature();
      const finalCheckedAt = deps.now();
      last = verifyTemperature({
        temperature: finalTemperature,
        currentDevice,
        device,
        targetRaw,
        expectedDuration,
        verificationElapsedSeconds: planStartedAtMs === undefined
          ? undefined
          : (finalCheckedAt.getTime() - planStartedAtMs) / 1_000,
        verificationMinimumElapsedSeconds: planSettledAtMs === undefined
          ? undefined
          : (finalCheckedAt.getTime() - planSettledAtMs) / 1_000,
        userId: credentials.userId,
        checkedAt: finalCheckedAt.toISOString(),
      });
      last.app_state_confirmed_after_hardware = last.app_state_verified;
      if (last.app_state_verified && last.hardware_verified) return last;
    }
  }
  return last;
}

async function pollOff(client, credentials, deps) {
  let last;
  for (let attempt = 0; attempt < deps.verifyAttempts; attempt += 1) {
    if (attempt > 0) await deps.sleep(deps.verifyIntervalMs);
    const temperature = await client.getTemperature();
    const checkedAt = deps.now();
    const { currentDevice, device } = await readDevice(client);
    last = verifyOff({
      temperature,
      currentDevice,
      device,
      userId: credentials.userId,
      checkedAt: checkedAt.toISOString(),
    });
    if (last.hardware_verified) {
      const finalTemperature = await client.getTemperature();
      last = verifyOff({
        temperature: finalTemperature,
        currentDevice,
        device,
        userId: credentials.userId,
        checkedAt: deps.now().toISOString(),
      });
      last.app_state_confirmed_after_hardware = last.app_state_verified;
      if (last.app_state_verified && last.hardware_verified) return last;
    }
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
    assertCommandShape(positionals, options, {
      positionalCount: 1,
      allowedOptions: ["check-api", "check-hermes", "json"],
      booleanOptions: ["check-api", "check-hermes", "json"],
    });
    const credentials = await inspectCredentials({ env: deps.env, home: deps.home, now: deps.now().getTime() });
    const nodeSupported = Number(process.versions.node.split(".")[0]) >= 22;
    let apiReachable;
    let apiError;
    let apiChecks;
    let hermes;
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
    if (options["check-hermes"]) {
      hermes = await inspectHermesEnvironment(deps);
    }
    return clean({
      kind: "doctor",
      ok: nodeSupported
        && credentials.ready
        && credentials.secure_permissions !== false
        && apiReachable !== false
        && hermes?.ready_for_single_skill_use !== false,
      node: { version: process.versions.node, supported: nodeSupported },
      credentials,
      mutations_enabled: deps.env.EIGHT_SLEEP_ALLOW_MUTATIONS === "true",
      privacy_default: "summary",
      api_reachable: apiReachable,
      api_checks: apiChecks,
      api_error: apiError,
      hermes,
    });
  }

  if (command === "trends") {
    assertCommandShape(positionals, options, {
      positionalCount: 1,
      allowedOptions: ["days", "from", "to", "timezone", "session-mode", "json"],
      booleanOptions: ["json"],
    });
    const window = resolveDateRange(options, deps.now());
    const sessionMode = String(options["session-mode"] ?? "main");
    const { client } = await makeClient(deps);
    const payload = await client.getTrends({ ...window, sessionMode });
    return summarizeTrends(payload, { ...window, sessionMode });
  }

  if (command === "temperature" && subcommand === "get") {
    assertCommandShape(positionals, options, {
      positionalCount: 2,
      allowedOptions: ["json"],
      booleanOptions: ["json"],
    });
    const { client } = await makeClient(deps);
    const summary = summarizeTemperature(await client.getTemperature());
    if (!recognizedTemperature(summary)) {
      throw new ApiError("Eight Sleep temperature response did not contain recognized fields; the private API schema may have changed.");
    }
    return {
      kind: "temperature",
      app_state_source: "app_api_readback",
      app_verification_scope: "backend_snapshot_not_phone_ui",
      app_ui_observed: false,
      checked_at: deps.now().toISOString(),
      ...summary,
    };
  }

  if (command === "temperature" && subcommand === "verify") {
    assertCommandShape(positionals, options, {
      positionalCount: 2,
      allowedOptions: ["app-level", "duration-seconds", "off", "json"],
      booleanOptions: ["off", "json"],
    });
    if (options.off !== undefined) {
      if (options["app-level"] !== undefined || options["duration-seconds"] !== undefined) {
        throw new UsageError("Use either temperature verify --off or --app-level, not both.");
      }
      const { client, credentials } = await makeClient(deps);
      const verification = await pollOff(client, credentials, deps);
      return clean({
        kind: "temperature_off_verification",
        ok: Boolean(verification?.app_state_verified && verification?.hardware_verified),
        verification_scope: "app_backend_and_hardware_off_state",
        verification,
        warning: !verification?.app_state_verified
          ? "The App-facing backend off state was not fully synchronized. No write was attempted."
          : verification?.hardware_verified
            ? undefined
            : "The App-facing backend reports off, but hardware reaching the off state was not verified. No write was attempted.",
      });
    }
    const targetAppLevel = Number(options["app-level"]);
    const targetRawLevel = appLevelToRaw(options["app-level"]);
    const expectedDuration = options["duration-seconds"] === undefined
      ? undefined
      : numberOption(options["duration-seconds"], "duration-seconds", { min: 60, max: 14_400 });
    const { client, credentials } = await makeClient(deps);
    const verification = await pollTemperature(client, credentials, targetRawLevel, deps, expectedDuration);
    return clean({
      kind: "temperature_verification",
      ok: Boolean(verification?.app_state_verified && verification?.hardware_verified),
      target_app_level: targetAppLevel,
      target_raw_level: targetRawLevel,
      requested_duration_seconds: expectedDuration,
      verification_scope: expectedDuration === undefined
        ? "target_hardware_and_active_override"
        : "target_hardware_and_requested_duration",
      verification,
      warning: !verification?.app_state_verified
        ? "The requested App-facing backend state was not verified. No write was attempted."
        : verification?.hardware_verified
          ? undefined
          : "The App-facing backend state matches, but hardware movement was not verified. No write was attempted.",
    });
  }

  if (command === "temperature" && subcommand === "set") {
    assertCommandShape(positionals, options, {
      positionalCount: 2,
      allowedOptions: ["app-level", "duration-seconds", "apply", "confirm-write", "json"],
      booleanOptions: ["apply", "json"],
    });
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
        app_sync_required: true,
        hardware_verification_required: true,
        app_level_semantics: "relative thermal level, not Celsius or Fahrenheit",
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
    let writeErrorStep;
    let writeErrorStepIndex;
    let timedOverrideStartedAtMs;
    let timedOverrideSettledAtMs;
    let laterStepRejected = false;
    const completedSteps = [];
    for (const [stepIndex, step] of plan.steps.entries()) {
      try {
        if (step.name === "set_timed_override") timedOverrideStartedAtMs = deps.now().getTime();
        await client.setTemperature(step.body);
        if (step.name === "set_timed_override") timedOverrideSettledAtMs = deps.now().getTime();
        completedSteps.push(step.name);
      } catch (error) {
        if (step.name === "set_timed_override") timedOverrideSettledAtMs = deps.now().getTime();
        if (!(error instanceof ApiError)) throw error;
        if (!error.outcomeUnknown && completedSteps.length === 0) throw error;
        laterStepRejected = !error.outcomeUnknown;
        writeErrorStep = step.name;
        writeErrorStepIndex = stepIndex;
        writeError = new ApiError(error.message, {
          status: error.status,
          outcomeUnknown: true,
        });
        break;
      }
    }
    let verification;
    try {
      verification = await pollTemperature(
        client,
        credentials,
        plan.rawLevel,
        deps,
        plan.duration,
        timedOverrideStartedAtMs,
        timedOverrideSettledAtMs,
      );
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
    if (writeError && writeErrorStepIndex < plan.steps.length - 1) {
      throw new ApiError(`${writeError.message} The ${writeErrorStep} step had an unknown outcome and later required steps were not attempted; matching read-back cannot prove this command completed.`, {
        status: writeError.status,
        outcomeUnknown: true,
      });
    }
    if (writeError && !verification?.app_state_verified) {
      throw new ApiError(`${writeError.message} The write outcome is unknown; it was not retried automatically.`, {
        status: writeError.status,
        outcomeUnknown: true,
      });
    }
    return clean({
      kind: "temperature_set_result",
      ok: Boolean(verification?.app_state_verified && verification?.hardware_verified),
      target_app_level: Number(options["app-level"]),
      target_raw_level: plan.rawLevel,
      duration_seconds: plan.duration,
      completed_write_steps: completedSteps,
      uncertain_write_step: writeErrorStep,
      write_transport_error_but_state_verified: Boolean(writeError && verification?.app_state_verified),
      verification,
      warning: !verification?.app_state_verified
        ? "The requested App-facing backend state was not verified. The write may have partially applied; do not retry without a new current-turn instruction."
        : verification?.hardware_verified
          ? undefined
          : "The App-facing backend state matches, but physical temperature movement was not verified. Do not claim success or retry automatically.",
    });
  }

  if (command === "temperature" && subcommand === "off") {
    assertCommandShape(positionals, options, {
      positionalCount: 2,
      allowedOptions: ["apply", "confirm-write", "json"],
      booleanOptions: ["apply", "json"],
    });
    if (!options.apply) {
      return {
        kind: "temperature_off_plan",
        dry_run: true,
        confirmation: "temperature:off",
        app_sync_required: true,
        hardware_verification_required: true,
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
    if (writeError && !verification?.app_state_verified) {
      throw new ApiError(`${writeError.message} The write outcome is unknown; it was not retried automatically.`, {
        status: writeError.status,
        outcomeUnknown: true,
      });
    }
    return clean({
      kind: "temperature_off_result",
      ok: Boolean(verification?.app_state_verified && verification?.hardware_verified),
      write_transport_error_but_state_verified: Boolean(writeError && verification?.app_state_verified),
      verification,
      warning: !verification?.app_state_verified
        ? verification?.stale_time_based_override
          ? "The App-facing backend reports off, but a timed override remains. Synchronization is incomplete; do not retry without a new current-turn instruction."
          : "The App-facing backend off state was not fully synchronized. The command may have partially applied; do not retry without a new current-turn instruction."
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
    if (result?.ok === false && [
      "temperature_set_result",
      "temperature_off_result",
      "temperature_verification",
      "temperature_off_verification",
    ].includes(result.kind)) {
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

function invokedAsMain(metaUrl, entrypoint) {
  if (!entrypoint) return false;
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(entrypoint);
  } catch {
    return false;
  }
}

const invokedDirectly = invokedAsMain(import.meta.url, process.argv[1]);
if (invokedDirectly) await main();
