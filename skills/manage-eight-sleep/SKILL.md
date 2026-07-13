---
name: manage-eight-sleep
description: Cautiously inspect an Eight Sleep user's recent sleep trends, nightly scores, sleep stages, efficiency, and current Pod temperature, or safely plan and apply a temporary Pod temperature change or turn-off. Use this skill when the user explicitly mentions Eight Sleep or their Pod, or explicitly asks to use their Eight Sleep data for sleep scores, recent nights, naps, secondary sessions, temperature control, or hardware-command verification.
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
| Summarize recent primary sleep | `trends --days <1-90> --timezone <IANA> --session-mode main --json` |
| Include naps or secondary sessions | `trends --days <1-90> --timezone <IANA> --session-mode all --json` |
| Use an exact range | `trends --from YYYY-MM-DD --to YYYY-MM-DD --timezone <IANA> --session-mode main --json` |
| Read current Pod temperature state | `temperature get --json` |
| Recheck a target without writing | `temperature verify --app-level <-10..10> --json` |
| Plan a temporary App-level setting | `temperature set --app-level <-10..10> --duration-seconds <60..14400> --json` |
| Plan turning the Pod off | `temperature off --json` |

Use the user's IANA timezone when known. Otherwise use the system IANA timezone if it is available; fall back to UTC and disclose that choice. The `--to` date is an end boundary and must be later than `--from`.

`--days 7` covers the current local calendar day plus the prior six days. A recent or in-progress sleep session may not be returned yet, and missing sessions must not be counted as poor sleep.

For a setup or authentication failure, read [references/setup.md](references/setup.md). For endpoint behavior or a verification failure, read [references/api-behavior.md](references/api-behavior.md).

## Read workflow

1. Run `doctor --json` when readiness is unknown or a prior request failed to authenticate.
2. Run the narrowest read command that answers the request. Use `main` unless the user explicitly wants naps or all sessions.
3. Interpret only fields present in the summary. Treat missing nights as missing data, not poor sleep.
4. State that scores and stages are wellness context from a private mobile-app API, not clinical measurements. Do not diagnose a condition.

Never expose access tokens, account or device identifiers, serial numbers, another sleeper's data, or raw API payloads. Do not save health data unless the user explicitly requests a destination and understands the privacy impact.

## Write workflow

Writes require an unambiguous command from the user in the current turn. A question, suggestion, old preference, or inferred comfort goal is not authorization.

1. Run the write command without `--apply`. This is a local dry run and returns the normalized App level, duration, and exact confirmation string.
2. Check that the plan matches the current request. App level `0` is not the same as turning the Pod off.
3. Only with current-turn authorization, run the same command with the gate limited to that process:

```bash
EIGHT_SLEEP_ALLOW_MUTATIONS=true node <skill-directory>/scripts/eight-sleep.mjs temperature set \
  --app-level <level> --duration-seconds <seconds> --apply \
  --confirm-write='<confirmation-from-plan>' --json
```

For off, use `--apply --confirm-write='temperature:off'` instead. Never persist the mutation environment variable in a profile or config file.

The CLI does not blindly retry writes. Do not manually repeat a write after a timeout or unknown outcome. Let its read-back verification finish first. If the result remains unverified, do not write again automatically or under the old approval. A later read-only `temperature verify --app-level <target>` is allowed; another write requires a new, explicit current-turn instruction.

Report a temperature change as successful only when the result has `ok: true`, `verification.accepted_by_api: true`, and `verification.hardware_verified: true`. If the API accepted the target but hardware verification failed, say exactly that the command may have applied but physical temperature movement was not confirmed. Do not soften this into a success claim.

`accepted_by_api` is based on post-write read-back of smart state, current target, and the matching non-zero timed override. It is not based only on a PUT response.

## Boundaries

- Support sleep trends and current/temporary temperature operations only. Do not improvise alarm, base, away-mode, or account mutations.
- Each person must authenticate with their own Eight Sleep account on their own computer.
- Treat dual-sleeper Pod data as private. This skill returns no partner profile or identifier.
- The private API supplies one current device and this skill has no multi-Pod selector. If the current device or user side cannot be resolved, treat hardware verification as incomplete rather than guessing a device.
- Eight Sleep does not publish a stable public API. If the schema changes, stop and explain the compatibility failure rather than guessing.
