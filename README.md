<div align="center">

# 🌙 Manage Eight Sleep

**Eight Sleep data and guarded Pod control across AI tools**

![Version](https://img.shields.io/badge/version-0.2.0-4f46e5?style=flat-square)
![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)
[![License](https://img.shields.io/github/license/w2478328197-arch/eight-sleep-reliable-skill?style=flat-square)](LICENSE)

[English](README.md) · [简体中文](README.zh-CN.md) · [Security](SECURITY.md) · [Privacy](PRIVACY.md)

</div>

> [!IMPORTANT]
> This is an unofficial community project and is not affiliated with Eight Sleep, Inc. It uses an undocumented mobile-app API that may change without notice. Use it only with an account and equipment you are authorized to operate.

This repository provides a guarded local Skill and CLI for Eight Sleep sleep summaries and temporary Pod control. For MCP clients, it also documents a separate pinned upstream MCP server. That external server is not part of this codebase and uses its own tools and write controls.

## Available paths

| Path | What it provides |
|---|---|
| Upstream `eight-sleep-mcp-unofficial` | Standard MCP tools for compatible clients, governed by the upstream project's privacy and mutation settings |
| This repository's guarded Skill/CLI | Sleep trends, current Pod state, bounded temporary temperature levels, strict off, and App-backend plus hardware verification |

## Requirements

- Node.js 22 or newer
- An AI tool that supports MCP or can invoke a local Skill/CLI, such as Codex, Hermes, WorkBuddy, Claude, or ChatGPT; the connection method varies by client
- An Eight Sleep account controlled by the person using the skill
- macOS or Linux when using this repository's `install.sh`; direct MCP support depends on the selected client and platform
- Messaging apps are optional and configured separately in the selected agent or gateway. Installing this repository does not connect WeChat, Feishu/Lark, Telegram, or any other chat service

Only one AI host is required. Codex and Hermes are integration examples, not project dependencies.

## Connection options

Choose one Eight Sleep control path inside each AI host:

| Environment | Connection |
|---|---|
| Claude Desktop and other clients that support a local command-based `stdio` MCP server | Run the pinned upstream MCP server through the client's MCP configuration |
| WorkBuddy, CodeBuddy, or another MCP client | Use only a transport and configuration format supported by that specific client; confirm local-command support before using the JSON below |
| Codex | Use this repository's guarded Skill/CLI installer, or configure the upstream MCP server if the client supports it |
| Hermes | Use the guarded Skill/CLI or upstream MCP; separately configure the Hermes gateway when WeChat, Feishu/Lark, Telegram, or another supported channel is needed |
| ChatGPT Web or a custom ChatGPT app | Requires remote MCP on a supported plan. Neither this repository nor the upstream package provides a hardened public endpoint |

Do not load the direct upstream MCP and this repository's guarded Skill/CLI in the same host at the same time. They are separate control paths with different write controls.

### Messaging apps are a separate step

Installing the Skill or adding the MCP server connects an AI host to Eight Sleep only. It does **not** install or configure an AI model, sign in to a messaging app, create a bot, or start a messaging gateway. WeChat, Feishu/Lark, Telegram, and other apps become usable only after a compatible agent or gateway has been configured for that channel and is running.

```text
WeChat / Feishu/Lark / Telegram / another supported app
                              ↕
                         Agent or gateway
                          ├── model provider
                          └── Eight Sleep guarded Skill/CLI or upstream MCP
```

Codex and Claude Code can use the guarded Skill locally, but installing it does not turn either client into a messaging bot. Hermes is one optional gateway with documented Weixin, Feishu/Lark, and Telegram adapters. Another agent or gateway is also suitable when it supports both the selected messaging channel and one of this project's Eight Sleep connection paths.

The model provider, messaging channel, and Eight Sleep connection are three independent choices. This repository configures only the Eight Sleep part. Actual model or messaging cost depends on the selected provider, account, and plan.

Eight Sleep token files stay on the machine running the connector or guarded CLI and must never be sent to the model or messaging platform. Requests and returned sleep summaries may still be processed or retained by the selected agent, model provider, and messaging app under their own policies; review those services before enabling a channel.

### 1. Prepare the local Eight Sleep connection

Create the local token and generic MCP configuration with the pinned connector:

```bash
npx -y eight-sleep-mcp-unofficial@0.2.5 setup \
  --client generic --privacy-mode summary

chmod 600 ~/.eight-sleep-mcp/config.json \
  ~/.eight-sleep-mcp/tokens.json
```

Choose **No** if the setup utility asks whether to enable mutation tools. This disables only the upstream MCP server's write tools. The guarded Skill/CLI can still perform a later temperature change through its separate dry-run, confirmation, and verification workflow. On the guarded Skill/CLI path, this utility is used only to create local authentication files; do not also load its MCP server into the same host.

Credential files remain on the local machine. Authentication still contacts Eight Sleep, and requested results may be processed by the selected agent or model provider. Never commit, upload, screenshot, or share the token files.

### 2A. Connect a local MCP client

Use the generic MCP configuration generated by setup, or add the equivalent entry to a client that supports a local command-based `stdio` server:

```json
{
  "mcpServers": {
    "eight_sleep": {
      "command": "npx",
      "args": ["-y", "eight-sleep-mcp-unofficial@0.2.5"]
    }
  }
}
```

This path runs the independent [`eight-sleep-mcp-unofficial`](https://github.com/davidmosiah/eight-sleep-mcp) project directly. Its tools and mutation gate are separate from this repository's guarded Skill/CLI workflow.

[Claude Desktop supports local MCP servers](https://support.anthropic.com/en/articles/10949351). For WorkBuddy, CodeBuddy, or another client, translate the command into that client's supported MCP format; use a secure remote adapter if it cannot start a local `stdio` process.

ChatGPT Web and custom ChatGPT apps connect to remote MCP rather than starting this local `stdio` process. Plan and action availability vary; see [OpenAI's current requirements](https://help.openai.com/en/articles/12584461). This repository and the upstream package do not ship an authenticated public deployment. Use a supported secure tunnel or a separately hardened TLS-and-authenticated remote service, and never expose the connector's default local HTTP mode directly to the public internet.

### 2B. Install the guarded Skill/CLI for Codex or Hermes

```bash
git clone https://github.com/w2478328197-arch/eight-sleep-reliable-skill.git
cd eight-sleep-reliable-skill
chmod +x install.sh
```

Choose an installation target:

```bash
./install.sh codex
./install.sh hermes
./install.sh both
```

| Host | Default directory |
|---|---|
| Codex | `${CODEX_HOME:-$HOME/.codex}/skills/manage-eight-sleep` |
| Hermes | `${HERMES_HOME:-$HOME/.hermes}/skills/manage-eight-sleep` |

The installer does not overwrite an existing installation unless `--force` is supplied. If Hermes reports a conflicting Eight Sleep skill, review the paths and rerun with `--backup-conflicts`. Start a new Codex or Hermes session after installation.

At this point the local Eight Sleep Skill is installed, but no messaging app is connected. Complete the checks below first. Configure an optional messaging channel only after the local setup is ready.

### 3. Check the guarded Skill/CLI

Set the installed skill path for the current shell:

```bash
# Codex
SKILL_DIR="${CODEX_HOME:-$HOME/.codex}/skills/manage-eight-sleep"

# Hermes: use this instead
# SKILL_DIR="${HERMES_HOME:-$HOME/.hermes}/skills/manage-eight-sleep"
```

Run the checks you need:

```bash
# Local credentials and permissions
node "$SKILL_DIR/scripts/eight-sleep.mjs" doctor --json

# Read-only API connectivity
node "$SKILL_DIR/scripts/eight-sleep.mjs" doctor --check-api --json

# Hermes installation and configuration
node "$SKILL_DIR/scripts/eight-sleep.mjs" doctor --check-hermes --json
```

The setup is ready when `doctor` returns `ok: true`. On Hermes, `hermes.ready_for_single_skill_use` must also be `true`. Follow the returned recommendations and restart Hermes if the audit reports a configuration issue.

Refresh an expired default token with:

```bash
npx -y eight-sleep-mcp-unofficial@0.2.5 login
```

### 4. Optional: connect a messaging app

Use this step only when the user wants to chat through WeChat, Feishu/Lark, Telegram, or another supported app. The agent or gateway—not this repository—owns the messaging connection.

For Hermes:

1. Confirm that the selected model works in a normal Hermes conversation and that the Eight Sleep checks above pass.
2. Run `hermes gateway setup` and select Weixin, Feishu/Lark, Telegram, or another supported platform.
3. Restrict the platform to the authorized user account. Because sleep data and Pod control are sensitive, prefer direct messages and keep group access disabled unless it is deliberately required.
4. Start and keep the gateway running with `hermes gateway`.
5. Send a read-only request from the messaging app, such as “Check my current Pod temperature state,” before attempting a temperature change.

Minimum Hermes channel restrictions:

| Channel | Minimum restriction before use |
|---|---|
| Personal WeChat through Weixin | Set `WEIXIN_DM_POLICY=allowlist`, list the authorized IDs in `WEIXIN_ALLOWED_USERS`, and keep `WEIXIN_GROUP_POLICY=disabled`. This uses a separate iLink bot identity; direct messages are the reliable path, and ordinary WeChat groups may not deliver events. |
| Feishu/Lark | Set `FEISHU_ALLOWED_USERS` and keep `FEISHU_GROUP_POLICY=disabled` unless an approved group is deliberately required. |
| Telegram | Set `TELEGRAM_ALLOWED_USERS`; do not add or authorize the bot in groups unless group access is deliberately required. |

See the official Hermes guides for [Weixin](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/weixin), [Feishu/Lark](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/feishu), and [Telegram](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/telegram). Other agents and gateways must be configured through their own channel documentation.

For Tencent WorkBuddy, importing a Skill or adding an MCP server still does not connect a bot. Configure the supported bot or channel separately in WorkBuddy; availability and setup may vary by client version and region. See the official [WorkBuddy documentation](https://www.workbuddy.cn/).

Messaging access never bypasses the guarded write workflow. A temperature change still requires an exact current-turn level and duration, a dry run, a separate confirmation, and successful App-backend plus hardware verification. Do not share Eight Sleep tokens, model keys, bot tokens, or channel secrets in chat.

## Use with an agent

After connecting one of the paths above, ask naturally:

- “Summarize my sleep for the last seven days.”
- “Include naps in this week's sleep summary.”
- “Check my current Pod temperature state.”
- “Set my temperature level to `-2` for one hour.”
- “Turn my temperature control off.”

For direct MCP, use the upstream project's tool controls and keep mutation tools disabled unless they have been deliberately reviewed and enabled. In the guarded Skill/CLI, temperature changes require an explicit level and duration—or an explicit off request—in the current turn, followed by a separate confirmed execution step.

## Guarded CLI usage

### Sleep trends

```bash
node "$SKILL_DIR/scripts/eight-sleep.mjs" \
  trends --days 7 --timezone Asia/Shanghai

node "$SKILL_DIR/scripts/eight-sleep.mjs" \
  trends --days 7 --timezone Asia/Shanghai --session-mode all
```

`main` is the default session mode. Use `all` to include naps and secondary sessions. When using a date range, `--to` is an exclusive boundary.

### Temperature status

```bash
node "$SKILL_DIR/scripts/eight-sleep.mjs" temperature get --json

node "$SKILL_DIR/scripts/eight-sleep.mjs" \
  temperature verify --app-level -2 --duration-seconds 3600 --json

node "$SKILL_DIR/scripts/eight-sleep.mjs" \
  temperature verify --off --json
```

### Set a temporary temperature level

Eight Sleep App levels are relative values from `-10` to `+10`, not Celsius or Fahrenheit. Level `0` is neutral smart control, not off.

First create a dry run:

```bash
node "$SKILL_DIR/scripts/eight-sleep.mjs" \
  temperature set --app-level -2 --duration-seconds 3600 --json
```

Then execute the exact confirmed plan:

```bash
EIGHT_SLEEP_ALLOW_MUTATIONS=true \
node "$SKILL_DIR/scripts/eight-sleep.mjs" \
  temperature set --app-level -2 --duration-seconds 3600 \
  --apply --confirm-write=temperature:set:-2:3600 --json
```

### Turn temperature control off

```bash
# Dry run
node "$SKILL_DIR/scripts/eight-sleep.mjs" temperature off --json

# Confirmed execution
EIGHT_SLEEP_ALLOW_MUTATIONS=true \
node "$SKILL_DIR/scripts/eight-sleep.mjs" \
  temperature off --apply --confirm-write=temperature:off --json
```

After a timeout or unclear result, run a read-only verification command instead of repeating the write.

## Privacy and limitations

- Sleep data, health metrics, presence data, and tokens are sensitive. Keep all output private unless it has been reviewed and redacted.
- The project does not expose a linked sleeper's identity or measurements.
- The private API may change, reject requests, or revoke authentication at any time.
- The project reads backend state and Pod telemetry; it does not inspect the phone screen.
- Direct MCP use runs an independent upstream project; review its tools, privacy behavior, and mutation settings separately.
- This is not a medical device and must not be used for diagnosis, treatment, emergency response, or clinical decisions.

See [SECURITY.md](SECURITY.md) and [PRIVACY.md](PRIVACY.md) for the complete policies.

## Development

```bash
npm test
npm run validate
```

Tests run offline and do not require Eight Sleep credentials. Detailed skill behavior is documented in [SKILL.md](skills/manage-eight-sleep/SKILL.md), [setup.md](skills/manage-eight-sleep/references/setup.md), and [api-behavior.md](skills/manage-eight-sleep/references/api-behavior.md).

## Credits and license

The generic MCP connection and local authentication are provided by the MIT-licensed [`eight-sleep-mcp-unofficial@0.2.5`](https://www.npmjs.com/package/eight-sleep-mcp-unofficial/v/0.2.5) community package. This repository provides the separate guarded Skill/CLI layer and is released under the [MIT License](LICENSE).
