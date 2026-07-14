# Setup and authentication

## Requirements

- Node.js 22 or newer.
- An Eight Sleep account personally controlled by the person running the skill. Authorization to operate a device does not authorize shared credentials.
- Network access to the Eight Sleep mobile-app API domains.

Install the skill from the repository root:

```bash
./install.sh codex
./install.sh hermes
./install.sh both
```

The installer refuses to replace an existing installation unless `--force` is present. For Hermes it also refuses to install beside known legacy Eight Sleep skills. After reviewing them, `--backup-conflicts` moves those directories into a timestamped backup outside the skill discovery tree under `${HERMES_HOME:-$HOME/.hermes}/backups/manage-eight-sleep/` instead of deleting them:

```bash
./install.sh hermes --backup-conflicts
```

The installer never edits Hermes `config.yaml`.

## Messaging channels are separate

Installing this skill does not install or configure a model provider, sign in to a messaging app, create a bot, or start a messaging gateway. A local Codex, Hermes, or other supported host can use the skill after installation, but WeChat, Feishu/Lark, Telegram, and other messaging apps remain disconnected until the selected agent or gateway is configured separately.

For Hermes, first finish model setup, Eight Sleep authentication, and the readiness checks below. Then run `hermes gateway setup`, choose a supported platform, restrict access to authorized user IDs, and keep `hermes gateway` running. Prefer direct messages and disable group access unless it is deliberately required because sleep data and Pod control are sensitive.

See the official Hermes guides for [Weixin](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/weixin), [Feishu/Lark](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/feishu), and [Telegram](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/telegram). Other agents and gateways require their own channel setup.

A messaging channel changes only where the request arrives. It never authorizes a write by itself and must not bypass the skill's dry run, exact current-turn confirmation, or App-backend and hardware verification. Never place Eight Sleep tokens, model keys, bot tokens, or channel secrets in chat messages.

## Create a token

This project does not accept or store an email or password. It can reuse the token file produced by the separate, pinned [`eight-sleep-mcp-unofficial@0.2.5`](https://www.npmjs.com/package/eight-sleep-mcp-unofficial/v/0.2.5) community setup utility. On a fresh machine, run it once:

```bash
npx -y eight-sleep-mcp-unofficial@0.2.5 setup --client generic --privacy-mode summary
```

Answer **No** when it asks whether to enable its write tools. The upstream `setup` command is interactive, stores the user's Eight Sleep credentials in `~/.eight-sleep-mcp/config.json`, writes a generic MCP snippet under `~/.eight-sleep-mcp/mcp-configs/`, and automatically performs the initial login. `--client generic` prevents it from editing Codex or Hermes configuration or installing a second Hermes skill. That behavior belongs to the third-party utility, not this skill. Review the [pinned package](https://www.npmjs.com/package/eight-sleep-mcp-unofficial/v/0.2.5), its security documentation, and its [source repository](https://github.com/davidmosiah/eight-sleep-mcp) before using it.

The **No** choice disables only the upstream MCP server's mutation tools. It does not remove the guarded CLI's separately gated write workflow. On this skill path, use the pinned utility only for local authentication; do not also configure its MCP server in the same agent host.

By default, the bundled CLI reads `~/.eight-sleep-mcp/tokens.json`; `EIGHT_SLEEP_TOKEN_PATH` can select another token file. If either `EIGHT_SLEEP_ACCESS_TOKEN` or `EIGHT_SLEEP_USER_ID` is present, both are required and that environment pair takes precedence over any token file. The CLI never refreshes, rewrites, or deletes token files. On macOS or Linux, restrict both setup files to the current user:

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

For Hermes, also audit the active host without printing any credential values:

```bash
node <skill-directory>/scripts/eight-sleep.mjs doctor --check-hermes --json
```

The Hermes audit scans skill paths plus risk markers in `${HERMES_HOME:-$HOME/.hermes}/config.yaml` and `${HERMES_HOME:-$HOME/.hermes}/.env` locally. It detects competing `eight-sleep-mcp` or direct-API skills, legacy MCP blocks, persistent Eight Sleep credential keys, and a persistently enabled mutation flag. It returns no configuration values and does not persist or send scanned contents. A safe setup has `hermes.ready_for_single_skill_use: true`. If the audit finds an old MCP block, back up `config.yaml`, remove or disable that entire Eight Sleep block, and restart Hermes. Do not copy its values into a new file or chat. Use a token file or the explicit single-process environment credential pair described above; do not persist the pair in Hermes configuration.

The JSON result must have both `ok: true` and `credentials.ready: true`; automation should not infer readiness from human-readable text. For a token file on macOS or Linux, `credentials.secure_permissions` must also be `true`; top-level `ok` is false when the file is readable by group or other local users.

Recover expired authentication according to its source:

- For the default token file, run `npx -y eight-sleep-mcp-unofficial@0.2.5 login`.
- For a custom file, run `EIGHT_SLEEP_TOKEN_PATH="/absolute/path/to/tokens.json" npx -y eight-sleep-mcp-unofficial@0.2.5 login` with the same path.
- For a single-process environment pair, replace both `EIGHT_SLEEP_ACCESS_TOKEN` and `EIGHT_SLEEP_USER_ID` together through the trusted secret manager, or unset both to use a token file. The login command cannot refresh injected values.

Run `doctor --json` again after recovery. This skill does not fall back to password authentication.

## Uninstall

Remove only the installed skill directory for the relevant agent. Do not remove `~/.eight-sleep-mcp` unless the user separately intends to delete their community-client configuration and tokens.
