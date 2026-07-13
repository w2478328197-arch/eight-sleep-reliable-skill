import { readFile, stat } from "node:fs/promises";
import { Buffer } from "node:buffer";
import os from "node:os";
import path from "node:path";

export const DEFAULT_CLIENT_BASE = "https://client-api.8slp.net";
export const DEFAULT_APP_BASE = "https://app-api.8slp.net";
export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_ATTEMPTS = 3;

export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
}

export class ApiError extends Error {
  constructor(message, { status = 0, retryable = false, outcomeUnknown = false } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryable = retryable;
    this.outcomeUnknown = outcomeUnknown;
  }
}

function redactAssignments(value, keys, replacement) {
  const names = keys.join("|");
  return value
    .replace(new RegExp(`((?:["']?(?:${names})["']?)\\s*[:=]\\s*)(["'])([^"'\\r\\n]*)\\2`, "gi"), `$1$2${replacement}$2`)
    .replace(new RegExp(`((?:["']?(?:${names})["']?)\\s*[:=]\\s*)(?!["'])([^\\s,;}]+)`, "gi"), `$1${replacement}`);
}

export function redactSecrets(value) {
  let redacted = String(value ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <redacted>")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "<redacted-jwt>")
    .replace(/\b[0-9A-F]{8}-[0-9A-F]{4}-[1-5][0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}\b/gi, "<redacted-uuid>")
    .replace(/\b[A-F0-9]{48,128}\b/gi, "<redacted-long-secret>")
    .replace(/(^|[^A-Za-z0-9+/_=-])([A-Za-z0-9+/_=-]{68,})(?=$|[^A-Za-z0-9+/_=-])/g, "$1<redacted-long-secret>")
    .replace(/\/(users|devices)\/[^/?#\s"']+/gi, "/$1/<redacted>")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "<redacted-email>");
  redacted = redactAssignments(redacted, [
    "access_token",
    "refresh_token",
    "password",
    "client_secret",
    "EIGHT_SLEEP_ACCESS_TOKEN",
    "EIGHT_SLEEP_PASSWORD",
    "EIGHT_SLEEP_CLIENT_SECRET",
  ], "<redacted>");
  return redactAssignments(redacted, [
    "user_id",
    "userId",
    "device_id",
    "deviceId",
    "serialNumber",
    "serial",
    "EIGHT_SLEEP_USER_ID",
  ], "<redacted-id>");
}

export function parseOptions(argv) {
  const positionals = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const raw = token.slice(2);
    const equals = raw.indexOf("=");
    if (equals >= 0) {
      options[raw.slice(0, equals)] = raw.slice(equals + 1);
      continue;
    }
    const next = argv[index + 1];
    const nextIsValue = next !== undefined && (!next.startsWith("--") || /^-\d/.test(next));
    if (nextIsValue) {
      options[raw] = next;
      index += 1;
    } else {
      options[raw] = true;
    }
  }
  return { positionals, options };
}

export function boolFrom(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

export function numberOption(value, name, { integer = true, min, max, fallback } = {}) {
  if (value === undefined) {
    if (fallback !== undefined) return fallback;
    throw new UsageError(`Missing --${name}.`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed))) {
    throw new UsageError(`--${name} must be ${integer ? "an integer" : "a number"}.`);
  }
  if (min !== undefined && parsed < min) throw new UsageError(`--${name} must be at least ${min}.`);
  if (max !== undefined && parsed > max) throw new UsageError(`--${name} must be at most ${max}.`);
  return parsed;
}

export function validateDate(value, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) {
    throw new UsageError(`--${name} must use YYYY-MM-DD.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new UsageError(`--${name} is not a valid calendar date.`);
  }
  return value;
}

export function validateTimezone(value) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(new Date());
    return value;
  } catch {
    throw new UsageError(`Invalid IANA timezone: ${value}`);
  }
}

export function dateInTimezone(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type) => parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function addDays(dateOnly, days) {
  const value = new Date(`${validateDate(dateOnly, "date")}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function resolveDateRange(options, now = new Date()) {
  const timezone = validateTimezone(String(options.timezone ?? "UTC"));
  if ((options.from && !options.to) || (!options.from && options.to)) {
    throw new UsageError("Use --from and --to together, or omit both and use --days.");
  }
  if (options.from && options.to) {
    const from = validateDate(String(options.from), "from");
    const to = validateDate(String(options.to), "to");
    if (from >= to) throw new UsageError("--to must be later than --from.");
    return { from, to, timezone };
  }
  const days = numberOption(options.days, "days", { min: 1, max: 90, fallback: 7 });
  const today = dateInTimezone(now, timezone);
  return { from: addDays(today, -(days - 1)), to: addDays(today, 1), timezone };
}

export function appLevelToRaw(appLevel) {
  const value = Number(appLevel);
  if (!Number.isInteger(value) || value < -10 || value > 10) {
    throw new UsageError("App level must be an integer from -10 to 10.");
  }
  return value * 10;
}

export function rawLevelToApp(rawLevel) {
  return typeof rawLevel === "number" && Number.isFinite(rawLevel)
    ? Math.round((rawLevel / 10) * 10) / 10
    : undefined;
}

function tokenPathFor(env, home) {
  const configured = env.EIGHT_SLEEP_TOKEN_PATH;
  if (!configured) return path.join(home, ".eight-sleep-mcp", "tokens.json");
  if (configured === "~") return home;
  if (configured.startsWith("~/")) return path.join(home, configured.slice(2));
  return path.resolve(configured);
}

async function readTokenDocument(tokenPath) {
  const raw = await readFile(tokenPath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new UsageError("The Eight Sleep token file is not valid JSON. Re-run the login command.");
  }
  return parsed;
}

export async function inspectCredentials({ env = process.env, home = os.homedir(), now = Date.now() } = {}) {
  const envToken = env.EIGHT_SLEEP_ACCESS_TOKEN;
  const envUser = env.EIGHT_SLEEP_USER_ID;
  if (envToken || envUser) {
    const complete = Boolean(envToken && envUser);
    return {
      source: "environment",
      ready: complete,
      token_present: Boolean(envToken),
      user_id_present: Boolean(envUser),
      token_expired: false,
      secure_permissions: undefined,
      message: complete ? "Environment credentials are present." : "Set both EIGHT_SLEEP_ACCESS_TOKEN and EIGHT_SLEEP_USER_ID.",
    };
  }

  const tokenPath = tokenPathFor(env, home);
  const tokenPathDisplay = env.EIGHT_SLEEP_TOKEN_PATH ? "<custom token path>" : "~/.eight-sleep-mcp/tokens.json";
  try {
    const [document, metadata] = await Promise.all([readTokenDocument(tokenPath), stat(tokenPath)]);
    const token = document.access_token;
    const userId = document.user_id ?? document.userId;
    const expiresAt = Number(document.expires_at);
    const expired = Number.isFinite(expiresAt) && expiresAt <= Math.floor(now / 1000) + 30;
    const secure = process.platform === "win32" ? undefined : (metadata.mode & 0o077) === 0;
    return {
      source: "token_file",
      token_path: tokenPathDisplay,
      ready: Boolean(token && userId && !expired),
      token_present: Boolean(token),
      user_id_present: Boolean(userId),
      token_expired: expired,
      secure_permissions: secure,
      message: expired
        ? "The cached token is expired; re-run Eight Sleep login."
        : token && userId
          ? "Cached credentials are ready."
          : "The token file is missing access_token or user_id.",
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        source: "missing",
        token_path: tokenPathDisplay,
        ready: false,
        token_present: false,
        user_id_present: false,
        token_expired: false,
        secure_permissions: undefined,
        message: "No token found. On a new machine, run the pinned community setup once, then run its login command.",
      };
    }
    if (error instanceof UsageError) throw error;
    throw new UsageError("Cannot inspect the token file. Check that it is readable by the current user and contains valid JSON.");
  }
}

export async function loadCredentials(options = {}) {
  const { env = process.env, home = os.homedir(), now = Date.now() } = options;
  const inspection = await inspectCredentials({ env, home, now });
  if (!inspection.ready) throw new UsageError(inspection.message);
  if (inspection.source === "environment") {
    return {
      accessToken: env.EIGHT_SLEEP_ACCESS_TOKEN,
      userId: env.EIGHT_SLEEP_USER_ID,
      source: inspection.source,
    };
  }
  let document;
  try {
    document = await readTokenDocument(tokenPathFor(env, home));
  } catch (error) {
    if (error instanceof UsageError) throw error;
    throw new UsageError("The token file became unavailable. Check its permissions and retry.");
  }
  return {
    accessToken: document.access_token,
    userId: document.user_id ?? document.userId,
    expiresAt: Number.isFinite(Number(document.expires_at)) ? Number(document.expires_at) : undefined,
    source: inspection.source,
  };
}

function delayFromRetryAfter(value, attempt, random) {
  if (value) {
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.min(Math.max(seconds * 1000, 250), 30_000);
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return Math.min(Math.max(timestamp - Date.now(), 250), 30_000);
  }
  return Math.min(500 * 2 ** attempt + Math.floor(random() * 200), 5_000);
}

function headerValue(headers, name) {
  if (typeof headers?.get === "function") return headers.get(name);
  const entry = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry ? String(entry[1]) : undefined;
}

function requestSensitiveValues(url, headers) {
  const values = [];
  const authorization = headerValue(headers, "authorization");
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) values.push(bearer);
  try {
    const segments = new URL(String(url)).pathname.split("/").filter(Boolean);
    for (let index = 0; index < segments.length - 1; index += 1) {
      if (!["users", "devices"].includes(segments[index].toLowerCase())) continue;
      values.push(segments[index + 1]);
      try {
        values.push(decodeURIComponent(segments[index + 1]));
      } catch {
        // Keep the encoded segment only.
      }
    }
  } catch {
    // Production callers pass a valid URL; omit exact-value scrubbing if a test double does not.
  }
  return [...new Set(values.filter((value) => typeof value === "string" && value.length >= 4))]
    .sort((left, right) => right.length - left.length);
}

function redactRequestValues(value, sensitiveValues) {
  let output = redactSecrets(value);
  for (const sensitive of sensitiveValues) output = output.split(sensitive).join("<redacted-request-value>");
  return output;
}

function errorDetail(payload, fallback, sensitiveValues) {
  if (payload && typeof payload === "object") {
    const candidate = payload.error ?? payload.message ?? payload.detail;
    if (typeof candidate === "string") return redactRequestValues(candidate, sensitiveValues).slice(0, 300);
  }
  return redactRequestValues(fallback || "Request failed", sensitiveValues).slice(0, 300);
}

async function readLimitedResponseText(response, maxResponseBytes, isWrite) {
  const outcomeUnknown = isWrite && (response.ok || response.status === 408 || response.status >= 500);
  const tooLarge = () => new ApiError(`Eight Sleep response exceeds the ${maxResponseBytes}-byte safety limit.`, {
    status: response.status,
    outcomeUnknown,
  });
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
    try {
      await response.body?.cancel?.();
    } catch {
      // The size error remains the useful failure even if cancellation also fails.
    }
    throw tooLarge();
  }

  if (!response.body || typeof response.body.getReader !== "function") {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxResponseBytes) throw tooLarge();
    return text;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      totalBytes += chunk.byteLength;
      if (totalBytes > maxResponseBytes) {
        try {
          await reader.cancel();
        } catch {
          // The size error remains the useful failure even if cancellation also fails.
        }
        throw tooLarge();
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes).toString("utf8");
}

export async function fetchJsonWithRetry(url, {
  method = "GET",
  headers = {},
  body,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  attempts = DEFAULT_ATTEMPTS,
  fetchImpl = globalThis.fetch,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  random = Math.random,
  retryWrites = false,
  maxResponseBytes = 20_000_000,
} = {}) {
  if (typeof fetchImpl !== "function") throw new UsageError("This Node.js runtime does not provide fetch(). Use Node 22 or newer.");
  const safeMethod = String(method).toUpperCase();
  const isWrite = safeMethod !== "GET" && safeMethod !== "HEAD";
  const canRetry = safeMethod === "GET" || safeMethod === "HEAD" || retryWrites;
  const totalAttempts = canRetry ? attempts : 1;
  const sensitiveValues = requestSensitiveValues(url, headers);
  let lastError;

  for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: safeMethod,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        redirect: isWrite ? "error" : "follow",
      });
      const text = await readLimitedResponseText(response, maxResponseBytes, isWrite);
      let payload = null;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          if (response.ok) {
            throw new ApiError("Eight Sleep returned a non-JSON success response.", {
              status: response.status,
              outcomeUnknown: isWrite,
            });
          }
        }
      }
      if (response.ok) return payload ?? {};

      const retryableStatus = response.status === 408 || response.status === 429 || response.status >= 500;
      const detail = errorDetail(payload, response.statusText, sensitiveValues);
      lastError = new ApiError(`Eight Sleep API HTTP ${response.status}: ${detail}`, {
        status: response.status,
        retryable: retryableStatus,
        outcomeUnknown: isWrite && (response.status === 408 || response.status >= 500),
      });
      if (!canRetry || !retryableStatus || attempt === totalAttempts - 1) throw lastError;
      await sleep(delayFromRetryAfter(response.headers.get("retry-after"), attempt, random));
    } catch (error) {
      if (error instanceof ApiError) throw error;
      const timedOut = error?.name === "AbortError";
      const networkCode = String(error?.cause?.code ?? error?.code ?? "").match(/^[A-Z0-9_]{2,40}$/)?.[0];
      lastError = new ApiError(
        timedOut ? `Eight Sleep request timed out after ${timeoutMs} ms.` : `Eight Sleep network error${networkCode ? ` (${networkCode})` : ""}.`,
        { retryable: true, outcomeUnknown: isWrite },
      );
      if (!canRetry || attempt === totalAttempts - 1) throw lastError;
      await sleep(delayFromRetryAfter(null, attempt, random));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError ?? new ApiError("Eight Sleep request failed.");
}

function apiUrl(base, pathname, params) {
  const url = new URL(pathname, base.endsWith("/") ? base : `${base}/`);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  return url;
}

export function buildTrendsUrl({ clientBase = DEFAULT_CLIENT_BASE, userId, from, to, timezone, sessionMode = "main" }) {
  if (!userId) throw new UsageError("Missing Eight Sleep user id.");
  if (!["main", "all"].includes(sessionMode)) throw new UsageError("--session-mode must be main or all.");
  const params = {
    tz: validateTimezone(timezone),
    from: validateDate(from, "from"),
    to: validateDate(to, "to"),
    "model-version": "v2",
  };
  params[sessionMode === "main" ? "include-main" : "include-all-sessions"] = "true";
  return apiUrl(clientBase, `/v1/users/${encodeURIComponent(userId)}/trends`, params);
}

export class EightSleepClient {
  constructor({
    credentials,
    env = process.env,
    clientBase = DEFAULT_CLIENT_BASE,
    appBase = DEFAULT_APP_BASE,
    fetchImpl,
    sleep,
    random,
    timeoutMs,
  } = {}) {
    if (!credentials?.accessToken || !credentials?.userId) throw new UsageError("Eight Sleep credentials are incomplete.");
    this.credentials = credentials;
    this.clientBase = clientBase;
    this.appBase = appBase;
    this.fetchImpl = fetchImpl;
    this.sleep = sleep;
    this.random = random;
    this.timeoutMs = timeoutMs ?? numberOption(env.EIGHT_SLEEP_TIMEOUT_MS, "timeout", { min: 1000, max: 60_000, fallback: DEFAULT_TIMEOUT_MS });
  }

  headers() {
    return {
      Authorization: `Bearer ${this.credentials.accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "manage-eight-sleep/0.1.0",
    };
  }

  async request(base, pathname, { method = "GET", params, body, attempts, retryWrites = false } = {}) {
    return fetchJsonWithRetry(apiUrl(base, pathname, params), {
      method,
      headers: this.headers(),
      body,
      attempts,
      retryWrites,
      timeoutMs: this.timeoutMs,
      fetchImpl: this.fetchImpl,
      sleep: this.sleep,
      random: this.random,
    });
  }

  getProfile() {
    return this.request(this.clientBase, `/v1/users/${encodeURIComponent(this.credentials.userId)}`);
  }

  getTrends({ from, to, timezone, sessionMode = "main" }) {
    const url = buildTrendsUrl({
      clientBase: this.clientBase,
      userId: this.credentials.userId,
      from,
      to,
      timezone,
      sessionMode,
    });
    return fetchJsonWithRetry(url, {
      headers: this.headers(),
      timeoutMs: this.timeoutMs,
      fetchImpl: this.fetchImpl,
      sleep: this.sleep,
      random: this.random,
    });
  }

  getTemperature() {
    return this.request(this.appBase, `/v1/users/${encodeURIComponent(this.credentials.userId)}/temperature`);
  }

  getCurrentDevice() {
    return this.request(this.clientBase, `/v1/users/${encodeURIComponent(this.credentials.userId)}/current-device`);
  }

  getDevice(deviceId) {
    return this.request(this.clientBase, `/v1/devices/${encodeURIComponent(deviceId)}`);
  }

  setTemperature(body) {
    return this.request(this.appBase, `/v1/users/${encodeURIComponent(this.credentials.userId)}/temperature`, {
      method: "PUT",
      body,
      attempts: 1,
      retryWrites: false,
    });
  }

  turnOff() {
    return this.setTemperature({ currentState: { type: "off" } });
  }
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function minutes(value) {
  const numeric = finite(value);
  return numeric === undefined ? undefined : Math.round((numeric / 60) * 10) / 10;
}

function normalizeDay(value) {
  const summary = value?.summary && typeof value.summary === "object" ? value.summary : {};
  const source = { ...summary, ...value };
  const sleep = finite(source.sleepDuration);
  const presence = finite(source.presenceDuration);
  return {
    day: source.day,
    score: finite(source.score),
    sleep_minutes: minutes(sleep),
    in_bed_minutes: minutes(presence),
    efficiency_pct: sleep !== undefined && presence > 0 ? Math.round((sleep / presence) * 1000) / 10 : undefined,
    deep_minutes: minutes(source.deepDuration),
    light_minutes: minutes(source.lightDuration),
    rem_minutes: minutes(source.remDuration),
    snoring_minutes: minutes(source.snoreDuration),
    tosses_and_turns: finite(source.tnt),
    sleep_start_utc: typeof source.sleepStart === "string" ? source.sleepStart : undefined,
    sleep_end_utc: typeof source.sleepEnd === "string" ? source.sleepEnd : undefined,
  };
}

function mean(values) {
  return values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10 : undefined;
}

export function summarizeTrends(payload, window) {
  if (!Array.isArray(payload?.days)) {
    throw new ApiError("Eight Sleep trends response did not contain a days array; the private API schema may have changed.");
  }
  const days = payload.days.map(normalizeDay).filter((day) => day.day).sort((a, b) => a.day.localeCompare(b.day));
  const scored = days.filter((day) => day.score !== undefined);
  const best = scored.length ? scored.reduce((current, day) => day.score > current.score ? day : current, scored[0]) : undefined;
  const worst = scored.length ? scored.reduce((current, day) => day.score < current.score ? day : current, scored[0]) : undefined;
  return {
    kind: "eight_sleep_trends_summary",
    generated_at: new Date().toISOString(),
    window: {
      from: window.from,
      to_exclusive: window.to,
      timezone: window.timezone,
      session_mode: window.sessionMode,
      nights_returned: days.length,
    },
    mean_score: mean(scored.map((day) => day.score)),
    best: best ? { day: best.day, score: best.score } : undefined,
    worst: worst ? { day: worst.day, score: worst.score } : undefined,
    nights: days,
    notes: [
      "Scores and sleep stages come from Eight Sleep's private mobile-app API and are not clinical measurements.",
      window.sessionMode === "main"
        ? "Main-session mode favors the primary nightly sleep and may omit naps or secondary sessions."
        : "All-session mode may include naps or secondary sessions.",
    ],
  };
}

function valueAt(payload, keys) {
  const root = payload?.result && typeof payload.result === "object" ? payload.result : payload;
  for (const key of keys) {
    const segments = key.split(".");
    let value = root;
    for (const segment of segments) value = value?.[segment];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

export function summarizeTemperature(payload) {
  const rawCurrent = finite(valueAt(payload, ["currentLevel", "current.level"]));
  const rawDevice = finite(valueAt(payload, ["currentDeviceLevel", "current.deviceLevel"]));
  const stateType = valueAt(payload, ["currentState.type", "state.type"]);
  const timeLevel = finite(valueAt(payload, ["timeBased.level"]));
  const durationSeconds = finite(valueAt(payload, ["timeBased.durationSeconds"]));
  const smart = valueAt(payload, ["smart"]);
  return {
    state: typeof stateType === "string" ? stateType : undefined,
    is_on: typeof stateType === "string" ? stateType !== "off" : undefined,
    current_level_raw: rawCurrent,
    current_level_app: rawLevelToApp(rawCurrent),
    device_level_raw: rawDevice,
    device_level_app: rawLevelToApp(rawDevice),
    smart: smart && typeof smart === "object" ? {
      bedtime_app: rawLevelToApp(finite(smart.bedTimeLevel)),
      initial_sleep_app: rawLevelToApp(finite(smart.initialSleepLevel)),
      final_sleep_app: rawLevelToApp(finite(smart.finalSleepLevel)),
    } : undefined,
    time_based: timeLevel !== undefined || durationSeconds !== undefined ? {
      level_raw: timeLevel,
      level_app: rawLevelToApp(timeLevel),
      duration_seconds: durationSeconds,
    } : undefined,
  };
}

export function getDeviceId(payload) {
  return valueAt(payload, ["id", "deviceId", "device.id", "device.deviceId"]);
}

function resolveSide(currentDevice, device, userId) {
  const root = device?.result && typeof device.result === "object" ? device.result : device;
  if (root?.leftUserId === userId) return "left";
  if (root?.rightUserId === userId) return "right";
  if (root?.leftUserId || root?.rightUserId) return undefined;
  const declared = valueAt(currentDevice, ["side"]);
  if (["left", "right"].includes(declared)) return declared;
  return undefined;
}

function deviceSignal(device, side) {
  if (!device || !side) return {};
  const root = device?.result && typeof device.result === "object" ? device.result : device;
  const actualCandidates = [
    `${side}NowHeating`,
    `${side}CurrentLevel`,
    `${side}HeatingLevel`,
    `${side}.nowHeating`,
    `${side}.currentLevel`,
    `${side}.heatingLevel`,
  ];
  const targetCandidates = [
    `${side}TargetLevel`,
    `${side}.targetLevel`,
  ];
  const signal = {};
  for (const field of actualCandidates) {
    const value = finite(valueAt(root, [field]));
    if (value !== undefined) {
      signal.field = field;
      signal.value = value;
      break;
    }
  }
  for (const field of targetCandidates) {
    const value = finite(valueAt(root, [field]));
    if (value !== undefined) {
      signal.targetField = field;
      signal.targetValue = value;
      break;
    }
  }
  return signal;
}

function alignedWithTarget(observed, target) {
  if (observed === undefined) return false;
  if (target === 0) return observed === 0;
  return Math.abs(observed) >= 1 && Math.sign(observed) === Math.sign(target);
}

export function verifyTemperature({ temperature, currentDevice, device, targetRaw, expectedDuration, userId }) {
  const summary = summarizeTemperature(temperature);
  const stateSmart = typeof summary.state === "string" && [
    "smart",
    "smart:bedtime",
    "smart:initial",
    "smart:initialsleep",
    "smart:final",
    "smart:finalsleep",
  ].includes(summary.state.toLowerCase());
  const currentTargetRecorded = summary.current_level_raw === targetRaw;
  const durationSeconds = summary.time_based?.duration_seconds ?? 0;
  const durationMatches = expectedDuration === undefined
    ? durationSeconds > 0
    : durationSeconds > 0
      && durationSeconds <= expectedDuration
      && durationSeconds >= Math.max(1, expectedDuration - 120);
  const timedTargetRecorded = summary.time_based?.level_raw === targetRaw && durationMatches;
  const side = resolveSide(currentDevice, device, userId);
  const signal = deviceSignal(device, side);
  const temperatureHardware = alignedWithTarget(summary.device_level_raw, targetRaw);
  const deviceHardware = alignedWithTarget(signal.value, targetRaw);
  const hardwareVerified = Boolean(side && (signal.value !== undefined ? deviceHardware : temperatureHardware));
  const observedDeviceLevel = signal.value ?? summary.device_level_raw;
  return {
    accepted_by_api: Boolean(stateSmart && currentTargetRecorded && timedTargetRecorded),
    hardware_verified: hardwareVerified,
    observed_device_level_raw: observedDeviceLevel,
    observed_device_level_app: rawLevelToApp(observedDeviceLevel),
    device_signal: signal.field,
    device_target_signal: signal.targetField,
    reported_device_target_raw: signal.targetValue,
    side_resolved: Boolean(side),
    state: summary.state,
    requested_duration_seconds: expectedDuration,
    observed_duration_seconds: durationSeconds || undefined,
  };
}

export function verifyOff(input) {
  const structured = input?.temperature ? input : { temperature: input };
  const { temperature, currentDevice, device, userId } = structured;
  const summary = summarizeTemperature(temperature);
  const staleTimeBased = summary.time_based?.level_raw !== undefined && summary.time_based.level_raw !== 0;
  const side = resolveSide(currentDevice, device, userId);
  const signal = deviceSignal(device, side);
  const temperatureHardware = summary.device_level_raw === 0;
  const deviceHardware = signal.value === 0;
  const hardwareVerified = Boolean(side && (signal.value !== undefined ? deviceHardware : temperatureHardware));
  return {
    accepted_by_api: summary.state === "off",
    hardware_verified: summary.state === "off" && hardwareVerified,
    state: summary.state,
    observed_device_level_raw: signal.value ?? summary.device_level_raw,
    device_signal: signal.field,
    device_target_signal: signal.targetField,
    reported_device_target_raw: signal.targetValue,
    side_resolved: Boolean(side),
    stale_time_based_override: staleTimeBased,
  };
}

export function assertWriteGate(env, options, expectedConfirmation) {
  if (env.EIGHT_SLEEP_ALLOW_MUTATIONS !== "true") {
    throw new UsageError("Writes are disabled. Set EIGHT_SLEEP_ALLOW_MUTATIONS=true only for the intended command.");
  }
  if (options.apply !== true || options["confirm-write"] !== expectedConfirmation) {
    throw new UsageError(`A write requires --apply and --confirm-write=${expectedConfirmation} after explicit user approval.`);
  }
}

export function temperatureSetBody(appLevel, durationSeconds) {
  const rawLevel = appLevelToRaw(appLevel);
  const duration = numberOption(durationSeconds, "duration-seconds", { min: 60, max: 14_400, fallback: 3_600 });
  return {
    rawLevel,
    duration,
    steps: [
      { name: "enable_smart", body: { currentState: { type: "smart" } } },
      { name: "set_level", body: { currentLevel: rawLevel, currentState: { type: "smart" } } },
      { name: "set_timed_override", body: { timeBased: { level: rawLevel, durationSeconds: duration } } },
    ],
  };
}
