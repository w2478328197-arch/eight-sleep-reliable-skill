# Privacy

## Summary

This repository does not operate a hosted service and does not intentionally collect telemetry. When the skill is used, its bundled local CLI communicates directly with Eight Sleep's private, undocumented API and returns selected information to the user's agent environment. The agent client or model provider may process that information under its own privacy terms.

The generic MCP option in the README runs the separate `eight-sleep-mcp-unofficial` project. Its tools and data handling are governed by that upstream project rather than this repository. Review its privacy and mutation settings before use.

Eight Sleep sleep and device records can contain sensitive health and personal information. Use this project only with an account personally controlled by the person running the skill and with equipment that person owns or is authorized to operate. Device authorization does not authorize sharing another person's credentials.

## Data handled

Depending on the command, the bundled CLI may process:

- An access token and the requesting user's ID
- The account profile response during the opt-in `doctor --check-api` connectivity check; it is discarded without being returned or persisted
- Requested sleep sessions, scores, stages, presence, timestamps, and related wellness fields present in the trends response
- Temperature state and the current device record needed for hardware-side verification
- For the optional Hermes audit, skill paths and risk markers read locally from `${HERMES_HOME:-$HOME/.hermes}/config.yaml` and `${HERMES_HOME:-$HOME/.hermes}/.env`; configuration values are not returned, persisted, or sent

The CLI requests only the endpoints needed for the command and returns a summarized or redacted structure. It does not offer raw API output or persist API responses.

## Credentials and accounts

- Every user must sign in locally with an Eight Sleep account they personally control.
- Do not ask another person to share a password, token, or credential file.
- Keep credentials outside the repository and outside synced or shared folders.
- Never place credentials in source files, prompts, issue reports, screenshots, shell history, or continuous-integration secrets used by untrusted pull requests.
- Use the documented pinned third-party interactive setup instead of manually copying tokens. That separate utility handles the email and password and may store them locally for token refresh; the bundled CLI does not read them.

## Linked users and bed partners

A Pod may return a combined device record containing both sides. To map the requesting user to the correct hardware side, the CLI minimally processes that record locally, including side-to-user mappings and device-side telemetry. It does not return or persist the linked user's identifiers or measurements. Do not export, summarize, or publish a linked user's or bed partner's data without their authorization.

## Local files and exports

Exports must be explicitly requested by the user, written to a user-selected location, and protected so only that user can read them. Prefer a redacted export over a raw backup. Tell the user where the file was written and delete temporary copies when they are no longer needed.

Do not commit exports, caches, logs, token stores, or local configuration. The repository's `.gitignore` provides common exclusions, but it is not a substitute for reviewing every commit before publication.

## Agent transcripts and diagnostics

Hermes, Codex, or another agent host may retain conversation transcripts, commands, and tool output independently of this repository. Never print tokens, authorization headers, raw profile responses, raw sleep payloads, or complete configuration files for troubleshooting. The optional Hermes audit scans `config.yaml`, `$HERMES_HOME/.env`, and skill paths locally and returns only status booleans, recommendations, and relative skill paths. It does not return, persist, or send configuration values, and it does not read conversation history.

## Messaging apps

When a user separately connects WeChat, Feishu/Lark, Telegram, or another messaging app through an agent or gateway, the user's requests and the agent's replies pass through that platform and may be stored under its own privacy and retention rules. Depending on the request, a reply can contain sleep summaries or device state even though this repository returns redacted data.

Use an allowlist, prefer direct messages, and avoid health-data requests in shared groups. This repository does not configure, operate, retain, or delete messaging accounts, bot credentials, channel histories, or gateway logs. Review the privacy terms and retention settings of the chosen messaging platform, agent, model provider, and gateway before use.

## Public support channels

Never post credentials, identifiers, or real sleep and health data in a GitHub issue, discussion, pull request, or security report. Reproduce problems with synthetic data and redact request URLs, headers, response bodies, screenshots, and filesystem paths.

For security-sensitive reports, follow `SECURITY.md`.

## Third parties and API stability

This is an unofficial community project and is not affiliated with, endorsed by, or supported by Eight Sleep, Inc. The private API may change or stop working without notice. Users are responsible for reviewing the terms and privacy policies of Eight Sleep and their chosen agent or model provider.

This project is not intended for diagnosis, treatment, emergency response, or clinical decision-making.
