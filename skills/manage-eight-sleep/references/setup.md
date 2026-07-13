# Setup and authentication

## Requirements

- Node.js 22 or newer.
- An Eight Sleep account belonging to the person running the skill.
- Network access to the Eight Sleep mobile-app API domains.

Install the skill from the repository root:

```bash
./install.sh codex
./install.sh hermes
./install.sh both
```

The installer refuses to replace an existing skill unless `--force` is present.

## Create a token

This project does not accept or store an email or password. It can reuse the token file produced by a separate, pinned community setup utility. On a fresh machine, run it once:

```bash
npx -y eight-sleep-mcp-unofficial@0.2.5 setup --client generic --privacy-mode summary
```

Answer **No** when it asks whether to enable its write tools. The upstream `setup` command is interactive, stores the user's Eight Sleep credentials in `~/.eight-sleep-mcp/config.json`, writes a generic MCP snippet under `~/.eight-sleep-mcp/mcp-configs/`, and automatically performs the initial login. `--client generic` prevents it from editing Codex or Hermes configuration or installing a second Hermes skill. That behavior belongs to the third-party utility, not this skill. Review its documentation and security policy before using it.

This skill only reads `~/.eight-sleep-mcp/tokens.json`; it never refreshes, rewrites, or deletes that file. On macOS or Linux, restrict both files to the current user:

```bash
chmod 600 ~/.eight-sleep-mcp/config.json ~/.eight-sleep-mcp/tokens.json
```

Never paste a password, token file, access token, user ID, device ID, or sleep payload into a GitHub issue or chat.

## Token-only environment option

Advanced users may inject both `EIGHT_SLEEP_ACCESS_TOKEN` and `EIGHT_SLEEP_USER_ID` into one local process using a trusted local secret manager. Do not type a literal access token into a shell command, because it can be retained in shell history or exposed by process inspection.

Do not put these values in a repository, shell profile, command screenshot, or shared script. If either variable is present, both are required; the skill never combines an environment token with a file-based user ID. Unset them after the one intended process.

## Verify readiness

Run the offline check first:

```bash
node <skill-directory>/scripts/eight-sleep.mjs doctor --json
```

Then opt into read-only network checks:

```bash
node <skill-directory>/scripts/eight-sleep.mjs doctor --check-api --json
```

The JSON result must have both `ok: true` and `credentials.ready: true`; automation should not infer readiness from human-readable text. If the token is expired, run only `npx -y eight-sleep-mcp-unofficial@0.2.5 login`. This skill does not fall back to password authentication.

## Uninstall

Remove only the installed skill directory for the relevant agent. Do not remove `~/.eight-sleep-mcp` unless the user separately intends to delete their community-client configuration and tokens.
