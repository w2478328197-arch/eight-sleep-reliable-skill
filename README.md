<div align="center">

# 🌙 Manage Eight Sleep

**Read Eight Sleep data and control Pod temperature safely with AI**

![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)
[![License](https://img.shields.io/github/license/w2478328197-arch/eight-sleep-reliable-skill?style=flat-square)](LICENSE)

[English](README.md) · [简体中文](README.zh-CN.md) · [Security](SECURITY.md) · [Privacy](PRIVACY.md)

</div>

Query sleep trends, check Pod state, and make temporary temperature changes with confirmation and verification. Codex and Hermes have direct installers; Claude Code, Claude Desktop, WorkBuddy, and other tools can use the connection options below.

> [!IMPORTANT]
> This is an unofficial community project that uses an undocumented Eight Sleep App API which may change. Use it only with your own account and equipment you own or are authorized to operate.

## What it can do

- Summarize recent sleep and naps
- Check the current Pod temperature state
- Set a temporary temperature level from `-10` to `+10`
- Turn temperature control off
- Accept requests from WeChat, Feishu/Lark, Telegram, or another messaging app after a gateway is configured separately

## Before you start

- macOS or Linux when using the Codex/Hermes installer
- Node.js 22 or newer
- Codex, Hermes, or another AI tool that is installed and can already hold a normal conversation
- An Eight Sleep account controlled by the person using the project

Each user must sign in on their own computer. Never share an Eight Sleep token.

## Quick install

This path supports **Codex** and **Hermes**.

### 1. Download the project and sign in to Eight Sleep

```bash
git clone https://github.com/w2478328197-arch/eight-sleep-reliable-skill.git
cd eight-sleep-reliable-skill

npx -y eight-sleep-mcp-unofficial@0.2.5 setup \
  --client generic --privacy-mode summary

chmod 600 ~/.eight-sleep-mcp/config.json \
  ~/.eight-sleep-mcp/tokens.json
```

Choose **No** if the setup tool asks whether to enable mutation tools. This disables upstream MCP writes only; the guarded Skill can still change temperature through its own confirmation flow.

### 2. Install the Skill

Choose your AI tool:

```bash
./install.sh codex
./install.sh hermes
./install.sh both
```

Start a new Codex or Hermes session after installation.

### 3. Check the installation

```bash
# Codex
node "${CODEX_HOME:-$HOME/.codex}/skills/manage-eight-sleep/scripts/eight-sleep.mjs" \
  doctor --check-api --json

# Hermes
node "${HERMES_HOME:-$HOME/.hermes}/skills/manage-eight-sleep/scripts/eight-sleep.mjs" \
  doctor --check-api --check-hermes --json
```

The setup is ready when `ok` is `true`. Hermes also requires `ready_for_single_skill_use` to be `true`.

## Other AI tools

Every path first needs the download and sign-in step above. Choose one Eight Sleep connection per AI tool; do not load both the guarded Skill and upstream MCP in the same host.

| AI tool | Connection |
|---|---|
| Codex | Run `./install.sh codex` for the guarded Skill |
| Hermes | Run `./install.sh hermes` for the guarded Skill |
| [Claude Code](https://code.claude.com/docs/en/skills) | Run `mkdir -p ~/.claude/skills && cp -R skills/manage-eight-sleep ~/.claude/skills/` for the guarded Skill |
| [Claude Desktop](https://support.claude.com/en/articles/10949351) | Add the read-only upstream MCP configuration below |
| [WorkBuddy](https://www.workbuddy.cn/) | Add the read-only upstream MCP configuration below through Settings → MCP |
| ChatGPT Web / custom app | Requires a separately deployed authenticated remote MCP; this project does not provide a public service |

Claude Desktop, WorkBuddy, and other clients that support local `stdio` MCP can use:

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

This configuration is read-only by default and can query sleep and Pod state. It runs the independent upstream MCP and does not include this project's guarded dry run, separate confirmation, or dual verification.

## Messaging apps are a separate step

Installing a Skill or MCP does **not** install or configure an AI model. It also does not automatically connect WeChat, Feishu/Lark, or Telegram, create a bot, or start a gateway.

To connect a messaging app through Hermes:

```bash
hermes gateway setup
hermes gateway
```

Select the messaging platform, allow only your own account, prefer direct messages, and keep group access disabled. `hermes gateway` must remain running. Test with a read-only request such as “Check my current Pod temperature state” first.

Official setup guides: [Weixin](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/weixin) · [Feishu/Lark](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/feishu) · [Telegram](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/telegram)

Another agent can connect a messaging channel only when it supports that channel; otherwise pair it with a compatible gateway such as Hermes.

**Guarded Skill/CLI only:** Messaging access never bypasses the guarded write workflow. Temperature changes still require an exact level and duration, a dry run, separate confirmation, and result verification.

## Try asking

- “Summarize my sleep for the last seven days.”
- “Include naps in this week's sleep summary.”
- “Check my current Pod temperature state.”

With the guarded Skill, you can also ask:

- “Set my temperature level to `-2` for one hour.”
- “Turn temperature control off.”

## Important notes

- App levels from `-10` to `+10` are relative values, not Celsius or Fahrenheit.
- Level `0` means neutral smart control; it does not mean off.
- Never share tokens, model keys, or bot secrets in chat, screenshots, or GitHub issues.
- Sleep data is sensitive. This project is not for diagnosis, emergency response, or clinical decisions.
- The private API may change. After a timeout or unclear result, check state instead of repeating a write.

## More documentation

- [Setup, authentication, and troubleshooting](skills/manage-eight-sleep/references/setup.md)
- [Skill workflow](skills/manage-eight-sleep/SKILL.md)
- [API behavior and guarded writes](skills/manage-eight-sleep/references/api-behavior.md)
- [Security policy](SECURITY.md) · [Privacy notice](PRIVACY.md)

Development checks: `npm test` and `npm run validate`. Released under the [MIT License](LICENSE).
