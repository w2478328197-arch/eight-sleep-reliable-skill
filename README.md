# Manage Eight Sleep

A shareable Codex and Hermes skill for cautious Eight Sleep reads and tightly gated Pod temperature changes. It runs on Node.js 22 or newer and has zero runtime dependencies.

> [!IMPORTANT]
> This is an unofficial community project. It is not affiliated with, endorsed by, or supported by Eight Sleep. It uses the private mobile-app API, which has no stability guarantee and can change without notice. Use it only with your own account and equipment.

## What this project improves

- Read operations are the default, and trends return a compact summary unless `--json` is requested.
- Trends send exactly one session selector. `main` is the default; `all` is available explicitly. This avoids the upstream request conflict caused by sending `include-main` and `include-all-sessions` together.
- Network reads use bounded timeouts, response-size limits, redacted errors, and conservative retries.
- Temperature writes use a dry-run-first workflow with three gates: current-turn user intent in the skill policy, plus a process-level mutation flag and exact CLI confirmation.
- Authentication is reused from a local token file; this skill does not collect or store an email or password.

The trends change is a targeted compatibility fix. It does **not** prove that this project is universally or permanently more stable than the upstream package. Authentication, response fields, and other private endpoints can still change.

## Requirements

- macOS or Linux
- Node.js 22+
- Your own Eight Sleep account
- Codex, Hermes, or both

## Install the skill

Clone or download this repository, then choose the host explicitly:

```bash
chmod +x install.sh
./install.sh codex
./install.sh hermes
./install.sh both
```

The installer copies `skills/manage-eight-sleep` to:

- Codex: `${CODEX_HOME:-$HOME/.codex}/skills/manage-eight-sleep`
- Hermes: `${HERMES_HOME:-$HOME/.hermes}/skills/manage-eight-sleep`

Existing installations are never overwritten by default. Review your local copy before deliberately replacing it:

```bash
./install.sh codex --force
./install.sh both --force
```

Restart the host or begin a new session after installation so it discovers the skill.

## Authenticate with your own account

Each person must create their own local token file. On a fresh machine, run the pinned upstream interactive setup once:

```bash
npx -y eight-sleep-mcp-unofficial@0.2.5 setup --client generic --privacy-mode summary
chmod 600 ~/.eight-sleep-mcp/config.json ~/.eight-sleep-mcp/tokens.json
```

Choose **No** when that utility asks whether to enable its own write tools. Its setup command saves account credentials in `~/.eight-sleep-mcp/config.json`, writes a generic MCP snippet under `~/.eight-sleep-mcp/mcp-configs/`, and automatically performs the first login. Using `--client generic` avoids editing Codex or Hermes configuration or installing a second Hermes skill. Review the upstream security documentation before use.

This skill reads only `~/.eight-sleep-mcp/tokens.json` and does not modify either file. Treat both files as secrets: do not commit them, paste them into a chat, or share them with another person. The underlying account token is not guaranteed to be scope-limited; read-only behavior comes from this skill's default policy and command design.

If you installed for Codex, check the local setup with:

```bash
node ~/.codex/skills/manage-eight-sleep/scripts/eight-sleep.mjs doctor
```

For Hermes, replace `~/.codex` with `~/.hermes`. If you use `CODEX_HOME` or `HERMES_HOME`, use that custom root in commands. If the token later expires, run only `npx -y eight-sleep-mcp-unofficial@0.2.5 login`.

## Read examples

```bash
# Seven-night, main-session summary (the default)
node ~/.codex/skills/manage-eight-sleep/scripts/eight-sleep.mjs trends --days 7

# Include main sleep and additional sessions such as naps
node ~/.codex/skills/manage-eight-sleep/scripts/eight-sleep.mjs trends --days 7 --session-mode all

# Structured, still summarized output
node ~/.codex/skills/manage-eight-sleep/scripts/eight-sleep.mjs trends --days 7 --json

# Current temperature state
node ~/.codex/skills/manage-eight-sleep/scripts/eight-sleep.mjs temperature get

# Read-only recheck that App level -2 is both recorded and moving at the device
node ~/.codex/skills/manage-eight-sleep/scripts/eight-sleep.mjs temperature verify --app-level -2
```

Use an IANA timezone when local calendar boundaries matter, for example `--timezone Asia/Shanghai`.

## Write-safety contract

Temperature changes are permitted only when all three conditions are true:

1. The user clearly asks for that exact change in the **current conversational turn**. Old approval, inferred intent, schedules, and general preferences do not count.
2. `EIGHT_SLEEP_ALLOW_MUTATIONS=true` is set for that one command.
3. The command includes both `--apply` and the exact `--confirm-write=...` value produced by its dry run.

First generate a plan without changing the Pod:

```bash
node ~/.codex/skills/manage-eight-sleep/scripts/eight-sleep.mjs \
  temperature set --app-level -2 --duration-seconds 3600
```

After the user confirms that exact action in the current turn, use the confirmation value emitted by the dry run:

```bash
EIGHT_SLEEP_ALLOW_MUTATIONS=true \
node ~/.codex/skills/manage-eight-sleep/scripts/eight-sleep.mjs \
  temperature set --app-level -2 --duration-seconds 3600 \
  --apply --confirm-write=temperature:set:-2:3600
```

Turning temperature control off follows the same process. Its exact confirmation is `temperature:off`.

Keep `EIGHT_SLEEP_ALLOW_MUTATIONS` command-scoped as shown; do not export it permanently. Write requests are not automatically retried when their outcome may be ambiguous, and a successful response is not reported as physical success until the follow-up state check supports it.

If a write remains unverified, the tool will not repeat it. A later `temperature verify` is read-only; any new write needs a new current-turn instruction and dry run.

## Privacy and limitations

- Summary output is the default to reduce unnecessary health-data exposure.
- `--json` is intended for local structured use; inspect it before sharing.
- The skill redacts common token, credential, and email shapes from error messages.
- `main` mode focuses nightly analysis on the principal sleep session. `all` may include naps or secondary sessions and can change aggregate interpretation.
- The private API can reject requests, alter fields, or revoke authentication at any time. Never present this tool as medical software or its output as a clinical conclusion.

## Development

```bash
npm test
npm run validate
```

The repository intentionally has no runtime dependencies. CI exercises the currently tested Node.js majors and validates the installer and command entry points without contacting Eight Sleep or requiring credentials.

Authentication setup is delegated to the MIT-licensed [`eight-sleep-mcp-unofficial`](https://github.com/davidmosiah/eight-sleep-mcp) community project. It is not a runtime dependency, and none of its source code is copied into this repository.

## Layout

```text
skills/manage-eight-sleep/
├── SKILL.md
├── agents/openai.yaml
├── references/
│   ├── api-behavior.md
│   └── setup.md
└── scripts/
    ├── eight-sleep-lib.mjs
    └── eight-sleep.mjs
```
