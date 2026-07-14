<div align="center">

# 🌙 Manage Eight Sleep

**Sleep insights and Pod temperature control for Codex and Hermes**

![Version](https://img.shields.io/badge/version-0.2.0-4f46e5?style=flat-square)
![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white)
[![License](https://img.shields.io/github/license/w2478328197-arch/eight-sleep-reliable-skill?style=flat-square)](LICENSE)

[English](README.md) · [简体中文](README.zh-CN.md) · [Security](SECURITY.md) · [Privacy](PRIVACY.md)

</div>

> [!IMPORTANT]
> This is an unofficial community project and is not affiliated with Eight Sleep, Inc. It uses an undocumented mobile-app API that may change without notice. Use it only with an account and equipment you are authorized to operate.

Manage Eight Sleep is a skill for Codex and Hermes that reads sleep summaries, checks Pod temperature state, and performs explicitly confirmed temporary temperature adjustments.

## Features

- Sleep trends, scores, stages, and efficiency
- Primary sleep, naps, and secondary sessions
- Current Pod temperature state
- Temporary App-level temperature control from `-10` to `+10`
- Temperature-off and read-only status verification
- Local setup checks for Codex and Hermes

## Requirements

- macOS or Linux
- Node.js 22 or newer
- Codex, Hermes, or both
- An Eight Sleep account controlled by the person using the skill

## Install

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

## Authenticate

Create the token locally with the pinned setup utility:

```bash
npx -y eight-sleep-mcp-unofficial@0.2.5 setup \
  --client generic --privacy-mode summary

chmod 600 ~/.eight-sleep-mcp/config.json \
  ~/.eight-sleep-mcp/tokens.json
```

Choose **No** if the setup utility asks whether to enable its own write tools. Credentials remain on the local machine. Never commit, upload, screenshot, or share the token files.

## Check setup

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

## Use with an agent

After starting a new Codex or Hermes session, ask naturally:

- “Summarize my sleep for the last seven days.”
- “Include naps in this week's sleep summary.”
- “Check my current Pod temperature state.”
- “Set my temperature level to `-2` for one hour.”
- “Turn my temperature control off.”

Read requests run without a mutation gate. Temperature changes require an explicit level and duration—or an explicit off request—in the current turn, followed by a separate confirmed execution step.

## CLI usage

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
- This is not a medical device and must not be used for diagnosis, treatment, emergency response, or clinical decisions.

See [SECURITY.md](SECURITY.md) and [PRIVACY.md](PRIVACY.md) for the complete policies.

## Development

```bash
npm test
npm run validate
```

Tests run offline and do not require Eight Sleep credentials. Detailed skill behavior is documented in [SKILL.md](skills/manage-eight-sleep/SKILL.md), [setup.md](skills/manage-eight-sleep/references/setup.md), and [api-behavior.md](skills/manage-eight-sleep/references/api-behavior.md).

## Credits and license

Authentication setup uses the MIT-licensed [`eight-sleep-mcp-unofficial@0.2.5`](https://www.npmjs.com/package/eight-sleep-mcp-unofficial/v/0.2.5) community package. This project is released under the [MIT License](LICENSE).
