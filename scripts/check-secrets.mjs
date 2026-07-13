#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ignoredDirectories = new Set([".git", "node_modules", "coverage", "dist"]);
const maxFileBytes = 5_000_000;

const checks = [
  {
    name: "private key material",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    name: "personal macOS home path",
    pattern: /\/Users\/(?!example(?:\/|$)|username(?:\/|$)|<)/,
  },
  {
    name: "personal Windows home path",
    pattern: /[A-Za-z]:\\Users\\(?!example(?:\\|$)|username(?:\\|$)|<)/,
  },
  {
    name: "hard-coded local proxy",
    pattern: /(?:127\.0\.0\.1|localhost):7890/,
  },
  {
    name: "bearer token",
    pattern: /Bearer\s+(?!<redacted>)[A-Za-z0-9._~+/=-]{24,}/i,
  },
  {
    name: "JWT",
    pattern: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/,
  },
  {
    name: "credential-like assignment",
    pattern: /["']?(?:EIGHT_SLEEP_ACCESS_TOKEN|EIGHT_SLEEP_PASSWORD|EIGHT_SLEEP_CLIENT_SECRET|access_token|refresh_token|client_secret|password)["']?\s*[:=]\s*["']?(?!(?:<|synthetic|fake|test|example|json-token-secret|password-secret|client-secret-value))[A-Za-z0-9._~+\/-]{16,}/i,
  },
  {
    name: "quoted credential assignment",
    pattern: /["']?(?:EIGHT_SLEEP_ACCESS_TOKEN|EIGHT_SLEEP_PASSWORD|EIGHT_SLEEP_CLIENT_SECRET|access_token|refresh_token|client_secret|password)["']?\s*[:=]\s*(["'])(?!(?:<|synthetic|fake|test|example|json-token-secret|password-secret|client-secret-value))[^"'\r\n]{12,}\1/i,
  },
  {
    name: "long hex credential candidate",
    pattern: /\b[A-F0-9]{48,128}\b/i,
  },
  {
    name: "long token-shaped string",
    pattern: /(^|[^A-Za-z0-9+/_=-])[A-Za-z0-9+/_=-]{68,}(?=$|[^A-Za-z0-9+/_=-])/m,
  },
  {
    name: "unresolved security contact placeholder",
    pattern: new RegExp(["SECURITY", "CONTACT", "TBD"].join("_")),
  },
];

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collect(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

const findings = [];
const files = await collect(root);
for (const filename of files) {
  const metadata = await stat(filename);
  const relative = path.relative(root, filename);
  if (metadata.size > maxFileBytes) {
    findings.push(`${relative}: file exceeds ${maxFileBytes} bytes and was not safely inspectable`);
    continue;
  }
  const text = await readFile(filename, "utf8");
  for (const check of checks) {
    if (check.pattern.test(text)) findings.push(`${relative}: possible ${check.name}`);
  }
}

if (findings.length) {
  console.error("Potential publication blockers found:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log(`Secret scan passed for ${files.length} repository files.`);
}
