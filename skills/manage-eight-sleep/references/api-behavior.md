# Private API behavior and safety notes

Eight Sleep does not publish or guarantee these mobile-app endpoints. Compatibility can change without a package release, so treat schema checks and hardware verification as required safeguards rather than proof of permanent support.

## Trends

The trends endpoint rejects a request that contains both session selectors. The CLI emits exactly one:

- `main` sends `include-main=true` and omits `include-all-sessions`.
- `all` sends `include-all-sessions=true` and omits `include-main`.

Use `main` for ordinary nightly summaries. Use `all` only when the user wants naps or secondary sessions; totals can differ because more sessions may be present.

For a relative window, `--days 7` covers the current day in the selected timezone plus the prior six local calendar days. A sleep session still being processed may be absent. The private API decides which calendar day owns sessions that cross midnight.

The CLI converts duration seconds to minutes and derives sleep efficiency only when both sleep and presence durations are present. It does not invent values for missing fields or missing nights.

## Temperature levels

User-facing App levels are integers from `-10` through `10`. The private API uses raw levels ten times larger:

```text
raw level = App level × 10
```

These values are relative comfort levels, not degrees Celsius or Fahrenheit. App level `0` means neutral smart control; it does not mean off.

## Applying a temporary setting

The three-step write sequence reflects behavior observed on the maintainer's Pod:

1. enable smart state;
2. set the raw level while retaining smart state;
3. set a non-zero, short `timeBased` override.

Duration is mandatory and must be 60–14,400 seconds; there is no implicit one-hour write default.

Each PUT is attempted once. A write timeout may mean the server applied the request even though the response was lost, so retrying blindly could extend or duplicate an override. If an early step has an unknown outcome, later required steps are not attempted and matching old state cannot turn that command into a success. Only an unknown outcome on the final timed-override step can be corroborated by exact App-facing and hardware read-back.

After the writes, the CLI freshly reads the temperature endpoint used by the mobile-app backend and resolves the current user's side from the device record. A valid result requires both:

- App-facing backend state records smart mode, the requested current level, and a non-zero matching timed override;
- for a nonzero setting, a mapped-side actual/current numeric signal is non-zero in the requested heating/cooling direction, any reported device target exactly matches the request, and an explicit activity flag is not false; for neutral/off, see the zero-target rules below.

Hardware can take tens of seconds to start moving. If it cannot be confirmed within the bounded polling window, the command exits as unverified even when the API accepted the target.

A device target field by itself proves only that a target was recorded; it does not prove physical movement. For a nonzero setting, hardware verification still requires an actual/current numeric heating signal in the requested direction. If an activity boolean is present, `false` fails verification; if one or more target fields are present, every value must exactly match the requested raw target. When the later, user-mapped device record supplies an actual/current signal, it takes precedence over an older temperature-endpoint value. Any device target conflict fails closed. Device user-ID mapping also takes precedence over a possibly stale declared side so a linked sleeper's telemetry cannot be mistaken for the requesting user's side.

For neutral or off verification, a zero actual/current numeric signal is sufficient only when no activity or target field conflicts. The mapped device can alternatively prove that its controller has stopped by reporting an explicit inactive state together with an exact target of zero. That inactive-plus-zero-target evidence is accepted even when a numeric heating-level field is lagging at a nonzero value. An active `true` value or any nonzero target fails closed.

`app_state_verified` means the post-write App-facing backend read-back contains smart state, the requested current raw level, and a time-based override whose level and duration match the plan. During a write, expected remaining duration is reduced by the actual time elapsed since the timed override began, then given a small jitter allowance capped at 10 seconds. A separate read-only verify treats its supplied duration as the expected remaining duration and uses a bounded tolerance of at most 10%, capped at 120 seconds. This lets a legitimate 60-second plan verify on a later hardware poll without letting a one-second old residual immediately impersonate it. After candidate hardware success, the CLI performs one final backend read so the operation ends by confirming logical state. `accepted_by_api` is retained as a compatibility alias. A successful PUT alone never sets either flag. `hardware_verified` separately requires matching device evidence. `app_ui_observed` is always false because this CLI does not inspect the phone screen.

For off, App verification is stricter: the state must be `off`, the current level must be zero, and any timed override must be fully cleared. A stale level or duration makes `app_state_verified` false even if the hardware has already reached zero. A response that retains only a positive duration placeholder, even with a zero or absent override level, is therefore conservatively treated as an uncleared override. The command must report the overall result as unverified in that split state and must not automatically rewrite; any new write requires a new current-turn instruction and dry run.

After an unverified result, `temperature verify --app-level <target> --duration-seconds <expected-remaining-duration>` can repeat the read-back and hardware checks without issuing a write. Omitting duration verifies only that a matching positive override remains active, not that its remaining duration matches the original plan. `temperature verify --off` checks the strict off state. Neither command can extend an old authorization. A later write requires a new explicit user instruction and a new dry run.

Schedules and App actions can replace or leave behind a time-based override. The CLI limits a temporary override to 60–14,400 seconds and reports a stale override after an off command. It does not claim that the private API cleared it and does not retry the write. A phone UI can also cache an older screen; when read-back is verified but the UI looks stale, refresh the App instead of issuing another mutation.

## Failure handling

- Read requests retry only network failures, timeouts, HTTP 408/429, and server errors, with a bounded delay.
- Write requests are never automatically retried.
- Authentication and ordinary 4xx errors fail immediately.
- Responses larger than 20 MB and success responses that are not JSON are rejected.
- A trends payload without a `days` array and a temperature payload without recognized state fields are treated as compatibility failures.
- Production API domains are fixed in code. There is no runtime base-URL option that could redirect a bearer token to another host.
- The CLI uses the API's current-device record and does not offer a multi-Pod selector. Failure to resolve the current device or user's side is reported as incomplete verification.

Never interpret an API 200 response alone as evidence that the mattress is physically heating or cooling.
