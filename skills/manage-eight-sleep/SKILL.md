---
name: manage-eight-sleep
description: Cautiously inspect an Eight Sleep user's recent sleep trends, nightly scores, sleep stages, efficiency, and current Pod temperature, or safely plan and apply a temporary Pod temperature change or turn-off with App-facing backend and hardware verification. Use this skill when the user explicitly mentions Eight Sleep or their Pod, or explicitly asks to use their Eight Sleep data for sleep scores, recent nights, naps, secondary sessions, temperature control, App synchronization checks, or hardware-command verification.
---

# Manage Eight Sleep

Use the bundled deterministic CLI for every Eight Sleep operation. Resolve this skill's directory, then run:

```bash
node <skill-directory>/scripts/eight-sleep.mjs <command> --json
```

Do not construct direct API calls, read the token file manually, print credentials, or patch a globally installed package.

## Choose the command

| User intent | Command |
|---|---|
| Check setup without network access | `doctor --json` |
| Verify both read-only API domains | `doctor --check-api --json` |
| Audit a Hermes installation for conflicting skills or unsafe persistent config | `doctor --check-hermes --json` |
| Summarize recent primary sleep | `trends --days <1-90> --timezone <IANA> --session-mode main --json` |
| Include naps or secondary sessions | `trends --days <1-90> --timezone <IANA> --session-mode all --json` |
| Use an exact range | `trends --from YYYY-MM-DD --to YYYY-MM-DD --timezone <IANA> --session-mode main --json` |
| Read current Pod temperature state | `temperature get --json` |
| Recheck a target without writing | `temperature verify --app-level <-10..10> [--duration-seconds <60..14400>] --json` |
| Recheck that control is fully off without writing | `temperature verify --off --json` |
| Plan a temporary App-level setting | `temperature set --app-level <-10..10> --duration-seconds <60..14400> --json` |
| Plan turning the Pod off | `temperature off --json` |

Use the user's IANA timezone when known. Otherwise use the system IANA timezone if it is available; fall back to UTC and disclose that choice. The `--to` date is an end boundary and must be later than `--from`.

`--days 7` covers the current local calendar day plus the prior six days. A recent or in-progress sleep session may not be returned yet, and missing sessions must not be counted as poor sleep.

For a setup or authentication failure, read [references/setup.md](references/setup.md). For endpoint behavior or a verification failure, read [references/api-behavior.md](references/api-behavior.md).

## Interpret temperature requests exactly

- Eight Sleep App levels are integer relative comfort levels from `-10` to `+10`; they are not Celsius or Fahrenheit. Never append `°`, `°C`, or `°F`.
- Chinese requests such as “调到减 2 档”, “制冷 2 档”, or “调到 -2” mean the absolute App level `-2`. “调到加 2 档” or “加热 2 档” mean `+2`. If an explicit heating/cooling phrase uses a degree glyph colloquially, normalize it only as a proposed App level and say so: for example, “制冷05°” proposes App level `-5`, not 5 °C. Still obtain any missing duration and exact authorization before writing. Reject a request for a literal physical temperature because this API does not set one.
- A clearly relative request such as “在现在基础上再降 2 档” requires a current read first. A bare “减少 2” or “降 2” is ambiguous; ask whether it means absolute `-2` or two levels below the current setting. Present the resulting exact integer target in the dry run before seeking authorization.
- If the user changes the target while speaking, use only the final unambiguous value in the dry run. Do not write until the exact target and duration are confirmed.
- “关掉/关闭床垫” means `temperature off`; App level `0` is neutral smart control, not off.
- “打开/现在打开” never authorizes a permanent override or a different target or duration. Apply only an exact current-turn plan; otherwise ask for the missing App level and duration.
- “取消/别再调” stops all further writes immediately. A read-only status check is allowed, but do not infer a new restorative write or alter unrelated settings.

## Read workflow

1. Run `doctor --json` when readiness is unknown or a prior request failed to authenticate.
2. Run the narrowest read command that answers the request. Use `main` unless the user explicitly wants naps or all sessions.
3. Interpret only fields present in the summary. Treat missing nights as missing data, not poor sleep.
4. State that scores and stages are wellness context from a private mobile-app API, not clinical measurements. Do not diagnose a condition.

Never expose access tokens, account or device identifiers, serial numbers, another sleeper's data, or raw API payloads. Do not save health data unless the user explicitly requests a destination and understands the privacy impact.

## Write workflow

Writes require an unambiguous command from the user in the current turn. A question, suggestion, old preference, or inferred comfort goal is not authorization. Persistent or schedule mutations are unsupported; offer a bounded temporary override instead.

1. On Hermes, run `doctor --check-hermes --json` when host safety is unknown. Require top-level `ok: true`, `credentials.ready: true`, secure token-file permissions when applicable, and `hermes.ready_for_single_skill_use: true`. Do not write while a legacy direct-API skill, old MCP skill, stored account credentials, or persistent mutation gate is reported in `config.yaml` or `$HERMES_HOME/.env`.
2. Run the write command without `--apply`. This is a local dry run and returns the normalized App level, duration, and exact confirmation string.
3. Check that the plan matches the current request. App level `0` is not the same as turning the Pod off.
4. Only with current-turn authorization, run the same command with the gate limited to that process:

```bash
EIGHT_SLEEP_ALLOW_MUTATIONS=true node <skill-directory>/scripts/eight-sleep.mjs temperature set \
  --app-level <level> --duration-seconds <seconds> --apply \
  --confirm-write='<confirmation-from-plan>' --json
```

For off, use `--apply --confirm-write='temperature:off'` instead. Never persist the mutation environment variable or credential pair in a profile, `config.yaml`, or `$HERMES_HOME/.env`.

The CLI does not blindly retry writes. Do not manually repeat a write after a timeout or unknown outcome. Let its read-back verification finish first. If the result remains unverified, do not write again automatically or under the old approval. Treat a strict-off response with a positive duration-only placeholder as an uncleared override and report it as unverified even when hardware has stopped; do not reinterpret it as permission to rewrite. A later read-only `temperature verify --app-level <target> --duration-seconds <expected-remaining-duration>` or `temperature verify --off` is allowed; another write requires a new, explicit current-turn instruction. The write command accounts for elapsed polling time internally, but a separate verify command does not know when the old plan began. If the expected remaining duration is unknown, omit it and report that only a matching active override—not the original duration—was checked.

Report a temperature change as successful only when the result has `ok: true`, `verification.app_state_verified: true`, and `verification.hardware_verified: true`. `app_state_verified` comes from a fresh App-facing backend read after hardware checking; it verifies the current state, target, and timed override. It does not observe the phone screen. For a nonzero setting, hardware verification requires an actual/current signal in the requested direction, rejects an explicitly inactive device, and rejects any reported target that differs from the request. For off/zero, it accepts either a verified zero actual/current signal or an explicit inactive state with an exact zero target; the latter can supersede a lagging nonzero heating-level field. If backend state or hardware verification fails, report the incomplete side explicitly and do not rewrite automatically.

`accepted_by_api` remains as a compatibility alias for `app_state_verified`; neither is based only on a PUT response. Never claim that the phone UI was observed. If the backend read-back is verified but the phone UI looks stale, ask the user to refresh the App. Do not issue another write merely to refresh its screen.

For “App 显示和你说的不一样”, first use `temperature get` when the expected target is unknown, or the appropriate read-only verify command when it is known. Report backend and hardware evidence separately. If both match, ask the user to refresh the App; if either differs, describe the mismatch. Any corrective write still needs a new exact plan and current-turn authorization. Never guess or delete a schedule.

## Boundaries

- Support sleep trends and current/temporary temperature operations only. Do not improvise alarm, base, away-mode, or account mutations.
- Require each person to authenticate on their own computer with an Eight Sleep account they personally control. Device access authorization never authorizes shared passwords, tokens, or setup files.
- Treat dual-sleeper Pod data as private. This skill returns no partner profile or identifier.
- The private API supplies one current device and this skill has no multi-Pod selector. If the current device or user side cannot be resolved, treat hardware verification as incomplete rather than guessing a device.
- Eight Sleep does not publish a stable public API. If the schema changes, stop and explain the compatibility failure rather than guessing.
