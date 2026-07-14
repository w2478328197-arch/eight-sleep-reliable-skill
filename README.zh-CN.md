<div align="center">

# 🌙 Manage Eight Sleep

**让 AI 读取 Eight Sleep 数据并安全控制 Pod 温度**

![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)
[![许可证](https://img.shields.io/github/license/w2478328197-arch/eight-sleep-reliable-skill?style=flat-square)](LICENSE)

[English](README.md) · [简体中文](README.zh-CN.md) · [安全](SECURITY.md) · [隐私](PRIVACY.md)

</div>

用于查询睡眠趋势、查看 Pod 状态，以及执行带确认和验证的临时温控。Codex 和 Hermes 可以直接安装；Claude Code、Claude Desktop、WorkBuddy 等工具也有对应接入方式。

> [!IMPORTANT]
> 本项目是非官方社区项目，使用可能变化的 Eight Sleep 私有 App API。只可操作本人账号和本人拥有或获授权使用的设备。

## 能做什么

- 总结最近几天的睡眠和小睡
- 查看当前 Pod 温控状态
- 设置 `-10` 到 `+10` 的临时温控档位
- 关闭温控
- 通过微信、飞书/Lark、Telegram 等消息 App 发起对话（需要另外配置网关）

## 开始前

- 使用 Codex/Hermes 安装器时需要 macOS 或 Linux
- Node.js 22 或更高版本
- 已安装并能正常对话的 Codex、Hermes 或其他 AI 工具
- 使用者本人控制的 Eight Sleep 账号

每位使用者都要在自己的电脑上完成登录。不要共享 Eight Sleep token。

## 快速安装

以下流程适用于 **Codex** 和 **Hermes**。

### 1. 下载项目并登录 Eight Sleep

```bash
git clone https://github.com/w2478328197-arch/eight-sleep-reliable-skill.git
cd eight-sleep-reliable-skill

npx -y eight-sleep-mcp-unofficial@0.2.5 setup \
  --client generic --privacy-mode summary

chmod 600 ~/.eight-sleep-mcp/config.json \
  ~/.eight-sleep-mcp/tokens.json
```

如果登录工具询问是否启用写入工具，请选择 **No**。这只会关闭上游 MCP 的写入；本项目的安全 Skill 仍可通过自己的确认流程调温。

### 2. 安装 Skill

选择自己的 AI 工具：

```bash
./install.sh codex
./install.sh hermes
./install.sh both
```

安装完成后重新打开 Codex 或 Hermes 会话。

### 3. 检查安装

```bash
# Codex
node "${CODEX_HOME:-$HOME/.codex}/skills/manage-eight-sleep/scripts/eight-sleep.mjs" \
  doctor --check-api --json

# Hermes
node "${HERMES_HOME:-$HOME/.hermes}/skills/manage-eight-sleep/scripts/eight-sleep.mjs" \
  doctor --check-api --check-hermes --json
```

返回结果中的 `ok` 为 `true` 即可使用。Hermes 还需要 `ready_for_single_skill_use` 为 `true`。

## 其他 AI 工具

所有方式都要先完成上面的下载和登录。每个 AI 工具只选择一种 Eight Sleep 接入，不要同时加载安全 Skill 和上游 MCP。

| AI 工具 | 接入方式 |
|---|---|
| Codex | 运行 `./install.sh codex`，使用安全 Skill |
| Hermes | 运行 `./install.sh hermes`，使用安全 Skill |
| [Claude Code](https://code.claude.com/docs/en/skills) | 运行 `mkdir -p ~/.claude/skills && cp -R skills/manage-eight-sleep ~/.claude/skills/`，使用安全 Skill |
| [Claude Desktop](https://support.claude.com/en/articles/10949351) | 添加下面的上游只读 MCP 配置 |
| [WorkBuddy](https://www.workbuddy.cn/) | 在“设置 → MCP”中添加下面的上游只读 MCP 配置 |
| ChatGPT Web / 自定义 App | 需要另行部署带认证的远程 MCP；本项目不提供公网服务 |

Claude Desktop、WorkBuddy 和其他支持本地 `stdio` MCP 的工具可使用：

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

这条配置默认只读，可以查询睡眠和 Pod 状态。它运行的是独立上游 MCP，不包含本项目安全 Skill 的 dry run、单独确认和双重验证流程。

## 消息 App 需要单独配置

安装 Skill 或 MCP **不会**安装或配置 AI 模型，也不会自动连接微信、飞书/Lark、Telegram、创建机器人或启动网关。

使用 Hermes 接入消息 App：

```bash
hermes gateway setup
hermes gateway
```

在设置中选择消息平台，只允许本人账号，优先使用私聊，并保持群聊关闭。`hermes gateway` 必须持续运行。完成后先发送只读请求，例如“查看我当前的 Pod 温控状态”。

官方配置说明：[微信 Weixin](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/weixin) · [飞书/Lark](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/feishu) · [Telegram](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/telegram)

其他 Agent 只有在自身支持相应消息渠道时才能直接连接；否则需要配合 Hermes 等兼容网关。

**仅限安全 Skill/CLI 路径：**通过消息 App 操作不会绕过安全写入流程。温控仍需要明确档位与时长、dry run、单独确认和结果验证。

## 直接这样问

- “总结我最近七天的睡眠情况。”
- “把小睡也包括在本周睡眠摘要中。”
- “查看我当前的 Pod 温控状态。”

使用安全 Skill 时还可以：

- “把温控档位设为 `-2`，持续一小时。”
- “关闭温控。”

## 重要说明

- App 档位 `-10` 到 `+10` 是相对温控值，不是摄氏度或华氏度。
- 档位 `0` 表示中性智能温控，不表示关闭。
- 不要在聊天、截图或 GitHub Issue 中分享 token、模型密钥或机器人密钥。
- 睡眠数据属于敏感信息；本项目不能用于医疗诊断、急救或临床决策。
- 私有 API 可能变化，遇到超时或不明确结果时先查询状态，不要重复写入。

## 更多文档

- [安装、认证与故障排查](skills/manage-eight-sleep/references/setup.md)
- [Skill 工作流程](skills/manage-eight-sleep/SKILL.md)
- [API 行为与安全写入](skills/manage-eight-sleep/references/api-behavior.md)
- [安全政策](SECURITY.md) · [隐私说明](PRIVACY.md)

开发检查：`npm test` 和 `npm run validate`。项目采用 [MIT License](LICENSE)。
