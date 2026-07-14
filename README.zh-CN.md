<div align="center">

# 🌙 Manage Eight Sleep

**用于 Codex 和 Hermes 的睡眠数据与 Pod 温控 Skill**

![版本](https://img.shields.io/badge/version-0.2.0-4f46e5?style=flat-square)
![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)
[![许可证](https://img.shields.io/github/license/w2478328197-arch/eight-sleep-reliable-skill?style=flat-square)](LICENSE)

[English](README.md) · [简体中文](README.zh-CN.md) · [安全政策](SECURITY.md) · [隐私说明](PRIVACY.md)

</div>

> [!IMPORTANT]
> 本项目是非官方社区项目，与 Eight Sleep, Inc. 没有隶属或授权关系。项目使用未公开的移动 App API，接口可能随时变化。仅可使用本人控制的账号和本人拥有或获授权操作的设备。

Manage Eight Sleep 是一个用于 Codex 和 Hermes 的 Skill，可以读取睡眠摘要、查看 Pod 温控状态，并在明确确认后执行临时温控操作。

## 功能

- 睡眠趋势、评分、阶段和效率
- 主睡眠、小睡和次要睡眠会话
- 当前 Pod 温控状态
- `-10` 到 `+10` 的临时 App 温控档位
- 关闭温控和只读状态验证
- Codex 与 Hermes 本地环境检查

## 环境要求

- macOS 或 Linux
- Node.js 22 或更高版本
- Codex、Hermes，或两者同时使用
- 由 Skill 使用者本人控制的 Eight Sleep 账号

## 安装

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

## 认证

使用固定版本的设置工具在本机创建 token：

```bash
npx -y eight-sleep-mcp-unofficial@0.2.5 setup \
  --client generic --privacy-mode summary

chmod 600 ~/.eight-sleep-mcp/config.json \
  ~/.eight-sleep-mcp/tokens.json
```

如果设置工具询问是否启用它自己的写入工具，请选择 **No**。凭据只保存在本机，不要提交、上传、截图或分享 token 文件。

## 检查环境

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

开始新的 Codex 或 Hermes 会话后，可以直接提出自然语言请求：

- “总结我最近七天的睡眠情况。”
- “在本周睡眠摘要中包含小睡。”
- “查看我当前的 Pod 温控状态。”
- “把我的温控档位设为 `-2`，持续一小时。”
- “关闭我的温控。”

读取操作不需要开启写入权限。温控操作必须在当前请求中明确给出档位和时长，或明确要求关闭温控，并通过独立的确认步骤执行。

## CLI 用法

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
- 本项目不是医疗设备，不能用于诊断、治疗、急救或临床决策。

完整规则见 [SECURITY.md](SECURITY.md) 和 [PRIVACY.md](PRIVACY.md)。

## 开发

```bash
npm test
npm run validate
```

测试在离线环境运行，不需要 Eight Sleep 凭据。详细行为见 [SKILL.md](skills/manage-eight-sleep/SKILL.md)、[setup.md](skills/manage-eight-sleep/references/setup.md) 和 [api-behavior.md](skills/manage-eight-sleep/references/api-behavior.md)。

## 致谢与许可证

认证设置使用采用 MIT 许可的社区包 [`eight-sleep-mcp-unofficial@0.2.5`](https://www.npmjs.com/package/eight-sleep-mcp-unofficial/v/0.2.5)。本项目采用 [MIT License](LICENSE)。
