<div align="center">

# 🌙 Manage Eight Sleep

**跨 AI 工具的 Eight Sleep 数据与安全 Pod 温控**

![版本](https://img.shields.io/badge/version-0.2.0-4f46e5?style=flat-square)
![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)
[![许可证](https://img.shields.io/github/license/w2478328197-arch/eight-sleep-reliable-skill?style=flat-square)](LICENSE)

[English](README.md) · [简体中文](README.zh-CN.md) · [安全政策](SECURITY.md) · [隐私说明](PRIVACY.md)

</div>

> [!IMPORTANT]
> 本项目是非官方社区项目，与 Eight Sleep, Inc. 没有隶属或授权关系。项目使用未公开的移动 App API，接口可能随时变化。仅可使用本人控制的账号和本人拥有或获授权操作的设备。

本仓库提供 Eight Sleep 睡眠摘要与临时 Pod 温控所需的本地安全 Skill 和 CLI。对于 MCP 客户端，文档同时介绍一个固定版本的独立上游 MCP Server；该 Server 不属于本仓库代码，并使用自己的工具和写入控制。

## 可选路径

| 路径 | 提供的能力 |
|---|---|
| 上游 `eight-sleep-mcp-unofficial` | 面向兼容客户端的标准 MCP 工具，隐私与写入设置由上游项目管理 |
| 本仓库的安全 Skill/CLI | 睡眠趋势、当前 Pod 状态、有边界的临时温控档位、严格关闭，以及 App 后端与硬件验证 |

## 环境要求

- Node.js 22 或更高版本
- 支持 MCP 或可以调用本地 Skill/CLI 的 AI 工具，例如 Codex、Hermes、WorkBuddy、Claude、ChatGPT；具体连接方式因客户端而异
- 由 Skill 使用者本人控制的 Eight Sleep 账号
- 使用本仓库 `install.sh` 时需要 macOS 或 Linux；直接 MCP 模式取决于所选客户端和平台
- 微信不是必需项；需要微信入口时，请选择同时支持 MCP 工具和微信渠道的 Agent 或网关，例如 Hermes

只需要选择一个 AI 客户端。Codex 和 Hermes 都是接入示例，不是项目依赖。

## 接入方式

每个 AI 客户端只选择一种 Eight Sleep 控制路径：

| 使用环境 | 接入方式 |
|---|---|
| Claude Desktop 和其他支持本地命令式 `stdio` MCP Server 的客户端 | 在客户端的 MCP 配置中运行固定版本的上游 MCP Server |
| WorkBuddy、CodeBuddy 或其他 MCP 客户端 | 只使用该客户端明确支持的传输和配置格式；使用下面的 JSON 前先确认它支持本地命令 |
| Codex | 使用本仓库的安全 Skill/CLI 安装方式；客户端支持时也可配置上游 MCP |
| Hermes | 使用安全 Skill/CLI 或上游 MCP；还可以把 Hermes 作为可选的微信网关 |
| ChatGPT Web 或自定义 ChatGPT App | 在受支持的套餐中连接远程 MCP；本仓库和上游包都不提供已加固的公网端点 |

不要在同一个客户端中同时加载上游 MCP 和本仓库的安全 Skill/CLI。它们是两条独立控制路径，写入控制方式也不同。

### 可选的 Hermes + 微信桥梁

Eight Sleep 并不依赖 Hermes。需要微信入口或独立 Agent 网关时，可以使用下面的组合：

```text
微信 ↔ Hermes
        ├── 模型：OpenAI API 兼容服务商、DeepSeek 或其他 Hermes Provider
        └── 工具：Eight Sleep MCP 或本仓库的安全 Skill/CLI
```

在这种组合中，Hermes 是接入微信并调用所选模型 Provider 的 Agent，并不是让 ChatGPT 客户端本身连接微信。本仓库不会安装或配置 Hermes、微信或任何模型 Provider。模型 Provider、消息渠道和 Eight Sleep 接入是三个独立选择；实际费用取决于具体账号、模型和套餐。

### 1. 准备本地 Eight Sleep 连接

使用固定版本的连接器在本机创建 token 和通用 MCP 配置：

```bash
npx -y eight-sleep-mcp-unofficial@0.2.5 setup \
  --client generic --privacy-mode summary

chmod 600 ~/.eight-sleep-mcp/config.json \
  ~/.eight-sleep-mcp/tokens.json
```

如果设置工具询问是否启用写入工具，请选择 **No**。凭据只保存在本机，不要提交、上传、截图或分享 token 文件。

### 2A. 接入本地 MCP 客户端

使用 setup 生成的通用 MCP 配置，或在支持本地命令式 `stdio` Server 的客户端中加入等价配置：

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

这种方式会直接运行独立的 [`eight-sleep-mcp-unofficial`](https://github.com/davidmosiah/eight-sleep-mcp) 项目。它提供的工具和写入开关不属于本仓库的安全 Skill/CLI 流程。

[Claude Desktop 支持本地 MCP Server](https://support.anthropic.com/en/articles/10949351)。对于 WorkBuddy、CodeBuddy 或其他客户端，需要把同一条命令转换为该客户端支持的 MCP 配置；如果它不能启动本地 `stdio` 进程，则需要使用安全的远程适配层。

ChatGPT Web 和自定义 ChatGPT App 连接远程 MCP，不会启动这里的本地 `stdio` 进程。套餐和操作权限可能不同，请查看 [OpenAI 当前要求](https://help.openai.com/en/articles/12584461)。本仓库和上游包都不提供带认证的公网部署；请使用受支持的安全 Tunnel，或另行部署带 TLS 与认证的远程服务，绝不能把连接器默认的本地 HTTP 模式直接暴露到公网。

### 2B. 为 Codex 或 Hermes 安装安全 Skill/CLI

```bash
git clone https://github.com/w2478328197-arch/eight-sleep-reliable-skill.git
cd eight-sleep-reliable-skill
chmod +x install.sh
```

选择安装目标：

```bash
./install.sh codex
./install.sh hermes
./install.sh both
```

| Host | 默认目录 |
|---|---|
| Codex | `${CODEX_HOME:-$HOME/.codex}/skills/manage-eight-sleep` |
| Hermes | `${HERMES_HOME:-$HOME/.hermes}/skills/manage-eight-sleep` |

安装器默认不会覆盖已有安装；需要覆盖时使用 `--force`。如果 Hermes 报告 Eight Sleep skill 冲突，请先检查路径，再使用 `--backup-conflicts`。安装完成后请开始新的 Codex 或 Hermes 会话。

### 3. 检查安全 Skill/CLI

为当前终端设置已安装的 Skill 路径：

```bash
# Codex
SKILL_DIR="${CODEX_HOME:-$HOME/.codex}/skills/manage-eight-sleep"

# Hermes：改用下面这一行
# SKILL_DIR="${HERMES_HOME:-$HOME/.hermes}/skills/manage-eight-sleep"
```

按需运行检查：

```bash
# 本地凭据与文件权限
node "$SKILL_DIR/scripts/eight-sleep.mjs" doctor --json

# 只读 API 连通性
node "$SKILL_DIR/scripts/eight-sleep.mjs" doctor --check-api --json

# Hermes 安装与配置
node "$SKILL_DIR/scripts/eight-sleep.mjs" doctor --check-hermes --json
```

当 `doctor` 返回 `ok: true` 时，环境即可使用。Hermes 还需要 `hermes.ready_for_single_skill_use` 为 `true`。如果检查报告配置问题，请按返回的建议处理并重启 Hermes。

默认 token 过期后可使用下面的命令刷新：

```bash
npx -y eight-sleep-mcp-unofficial@0.2.5 login
```

## 在 Agent 中使用

完成上面任意一种接入后，可以直接提出自然语言请求：

- “总结我最近七天的睡眠情况。”
- “在本周睡眠摘要中包含小睡。”
- “查看我当前的 Pod 温控状态。”
- “把我的温控档位设为 `-2`，持续一小时。”
- “关闭我的温控。”

直接 MCP 模式使用上游项目自己的工具控制；除非已经单独检查并明确启用，否则应保持写入工具关闭。本仓库的安全 Skill/CLI 要求当前请求明确给出档位和时长，或明确要求关闭温控，并通过独立确认步骤执行。

## 安全 CLI 用法

### 睡眠趋势

```bash
node "$SKILL_DIR/scripts/eight-sleep.mjs" \
  trends --days 7 --timezone Asia/Shanghai

node "$SKILL_DIR/scripts/eight-sleep.mjs" \
  trends --days 7 --timezone Asia/Shanghai --session-mode all
```

默认会话模式为 `main`。需要包含小睡和次要会话时使用 `all`。使用日期范围时，`--to` 是不包含在结果内的结束边界。

### 温控状态

```bash
node "$SKILL_DIR/scripts/eight-sleep.mjs" temperature get --json

node "$SKILL_DIR/scripts/eight-sleep.mjs" \
  temperature verify --app-level -2 --duration-seconds 3600 --json

node "$SKILL_DIR/scripts/eight-sleep.mjs" \
  temperature verify --off --json
```

### 设置临时温控档位

Eight Sleep App 使用 `-10` 到 `+10` 的相对温控档位，不是摄氏度或华氏度。档位 `0` 表示中性智能温控，不表示关闭。

先生成 dry run：

```bash
node "$SKILL_DIR/scripts/eight-sleep.mjs" \
  temperature set --app-level -2 --duration-seconds 3600 --json
```

再执行完全相同的确认计划：

```bash
EIGHT_SLEEP_ALLOW_MUTATIONS=true \
node "$SKILL_DIR/scripts/eight-sleep.mjs" \
  temperature set --app-level -2 --duration-seconds 3600 \
  --apply --confirm-write=temperature:set:-2:3600 --json
```

### 关闭温控

```bash
# Dry run
node "$SKILL_DIR/scripts/eight-sleep.mjs" temperature off --json

# 确认执行
EIGHT_SLEEP_ALLOW_MUTATIONS=true \
node "$SKILL_DIR/scripts/eight-sleep.mjs" \
  temperature off --apply --confirm-write=temperature:off --json
```

如果请求超时或结果不明确，请运行只读验证命令，不要直接重复写入。

## 隐私与限制

- 睡眠数据、健康指标、在床数据和 token 都属于敏感信息。输出内容只有在检查并脱敏后才可分享。
- 本项目不会返回关联睡眠者的身份或测量数据。
- 私有 API 可能随时改变、拒绝请求或撤销认证。
- 项目读取 App 后端状态和 Pod 遥测，不会检查手机屏幕。
- 直接 MCP 模式运行的是独立上游项目，需要单独检查它的工具、隐私行为和写入设置。
- 本项目不是医疗设备，不能用于诊断、治疗、急救或临床决策。

完整规则见 [SECURITY.md](SECURITY.md) 和 [PRIVACY.md](PRIVACY.md)。

## 开发

```bash
npm test
npm run validate
```

测试在离线环境运行，不需要 Eight Sleep 凭据。详细行为见 [SKILL.md](skills/manage-eight-sleep/SKILL.md)、[setup.md](skills/manage-eight-sleep/references/setup.md) 和 [api-behavior.md](skills/manage-eight-sleep/references/api-behavior.md)。

## 致谢与许可证

通用 MCP 接入与本地认证由采用 MIT 许可的社区包 [`eight-sleep-mcp-unofficial@0.2.5`](https://www.npmjs.com/package/eight-sleep-mcp-unofficial/v/0.2.5) 提供。本仓库提供独立的安全 Skill/CLI 层，并采用 [MIT License](LICENSE)。
