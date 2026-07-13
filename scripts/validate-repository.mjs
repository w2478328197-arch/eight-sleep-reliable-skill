#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = path.join(root, "skills", "manage-eight-sleep");
const required = [
  "README.md",
  "LICENSE",
  "SECURITY.md",
  "PRIVACY.md",
  "install.sh",
  "skills/manage-eight-sleep/SKILL.md",
  "skills/manage-eight-sleep/agents/openai.yaml",
  "skills/manage-eight-sleep/references/setup.md",
  "skills/manage-eight-sleep/references/api-behavior.md",
  "skills/manage-eight-sleep/scripts/eight-sleep.mjs",
  "skills/manage-eight-sleep/scripts/eight-sleep-lib.mjs",
];

const failures = [];
for (const relative of required) {
  try {
    await access(path.join(root, relative));
  } catch {
    failures.push(`missing required file: ${relative}`);
  }
}

const skill = await readFile(path.join(skillRoot, "SKILL.md"), "utf8");
const frontmatterMatch = skill.match(/^---\n([\s\S]*?)\n---\n/);
if (!frontmatterMatch) {
  failures.push("SKILL.md must start with YAML frontmatter");
} else {
  const fields = Object.fromEntries(frontmatterMatch[1].split("\n").map((line) => {
    const separator = line.indexOf(":");
    return separator < 0 ? [line.trim(), ""] : [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
  }));
  const allowed = new Set(["name", "description"]);
  for (const key of Object.keys(fields)) {
    if (!allowed.has(key)) failures.push(`unsupported SKILL.md frontmatter key: ${key}`);
  }
  if (fields.name !== "manage-eight-sleep") failures.push("SKILL.md name must be manage-eight-sleep");
  if (!fields.description || fields.description.length < 80) failures.push("SKILL.md description must clearly describe triggers and capabilities");
}

if (/\bTODO\b|\[TODO/.test(skill)) failures.push("SKILL.md still contains scaffold TODO text");
for (const relativeReference of ["references/setup.md", "references/api-behavior.md"]) {
  if (!skill.includes(`](${relativeReference})`)) failures.push(`SKILL.md must link ${relativeReference}`);
}

const agentConfig = await readFile(path.join(skillRoot, "agents", "openai.yaml"), "utf8");
for (const marker of ["display_name:", "short_description:", "default_prompt:", "$manage-eight-sleep"]) {
  if (!agentConfig.includes(marker)) failures.push(`agents/openai.yaml is missing ${marker}`);
}

const entrypoint = await readFile(path.join(skillRoot, "scripts", "eight-sleep.mjs"), "utf8");
if (!entrypoint.startsWith("#!/usr/bin/env node\n")) failures.push("CLI entrypoint is missing its Node shebang");
if (entrypoint.includes("EIGHT_SLEEP_CLIENT_SECRET")) failures.push("CLI must not accept an embedded OAuth client secret");

if (failures.length) {
  console.error("Repository validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Repository structure and skill metadata are valid.");
}
