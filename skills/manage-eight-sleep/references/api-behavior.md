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

Each PUT is attempted once. A write timeout may mean the server applied the request even though the response was lost, so retrying blindly could extend or duplicate an override.

After the writes, the CLI reads the temperature state and resolves the current user's side from the device record. A valid result requires both:

- API state records smart mode, the requested current level, and a non-zero matching timed override;
- temperature or device-side telemetry is non-zero in the requested heating/cooling direction (or explicitly zero for a neutral/off verification).

Hardware can take tens of seconds to start moving. If it cannot be confirmed within the bounded polling window, the command exits as unverified even when the API accepted the target.

A device target field by itself proves only that a target was recorded; it does not prove physical movement. Hardware verification uses an actual/current heating signal. When the later, user-mapped device record supplies that signal, it takes precedence over an older temperature-endpoint value; an explicit conflict fails closed. Device user-ID mapping also takes precedence over a possibly stale declared side so a linked sleeper's telemetry cannot be mistaken for the requesting user's side.

`accepted_by_api` means the post-write read-back contains smart state, the requested current raw level, and a time-based override whose level and duration match the plan within a small polling tolerance. A successful PUT alone never sets this flag. `hardware_verified` separately requires matching device evidence.

After an unverified result, `temperature verify --app-level <target>` can repeat only the read-back and hardware checks without issuing a write. It cannot extend an old authorization. A later write requires a new explicit user instruction and a new dry run.

Schedules and App actions can replace or leave behind a time-based override. The CLI limits a temporary override to 60–14,400 seconds and reports a stale non-zero override after an off command. It does not claim that the private API cleared it.

## Failure handling

- Read requests retry only network failures, timeouts, HTTP 408/429, and server errors, with a bounded delay.
- Write requests are never automatically retried.
- Authentication and ordinary 4xx errors fail immediately.
- Responses larger than 20 MB and success responses that are not JSON are rejected.
- A trends payload without a `days` array and a temperature payload without recognized state fields are treated as compatibility failures.
- Production API domains are fixed in code. There is no runtime base-URL option that could redirect a bearer token to another host.
- The CLI uses the API's current-device record and does not offer a multi-Pod selector. Failure to resolve the current device or user's side is reported as incomplete verification.

Never interpret an API 200 response alone as evidence that the mattress is physically heating or cooling.
