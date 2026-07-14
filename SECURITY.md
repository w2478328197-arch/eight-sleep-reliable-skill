# Security Policy

## Scope and support

Security fixes target the latest released version. Older versions may not receive fixes.

This is an unofficial community project. It is not affiliated with, endorsed by, or supported by Eight Sleep, Inc. It uses private, undocumented API endpoints that may change without notice.

The generic MCP option documented in the README runs the separate `eight-sleep-mcp-unofficial` project. Its server, tools, and mutation controls are outside this repository's code and security boundary. Review that upstream project independently before connecting it to an AI client or enabling writes.

## Report a vulnerability

Use GitHub's private vulnerability reporting feature under **Security → Advisories → Report a vulnerability** when it is available.

If private vulnerability reporting is unavailable, do not publish sensitive details. Open a minimal issue asking the maintainer to enable a private reporting channel, using only synthetic information and no exploit details.

Include only the minimum information needed to reproduce the problem. Use synthetic identifiers and redacted logs. Maintainers will acknowledge reports on a best-effort basis; this project does not promise a fixed response or resolution time.

## Never disclose publicly

Do not include any of the following in issues, discussions, pull requests, logs, screenshots, test fixtures, or example files:

- Eight Sleep email addresses or passwords
- Access tokens, refresh tokens, OAuth credentials, cookies, or authorization headers
- Local configuration files or credential-store contents
- User IDs, device IDs, serial numbers, addresses, or payment details
- Raw sleep, heart-rate, HRV, respiratory, snoring, temperature, alarm, or presence data
- A linked account holder's or bed partner's information
- Personal filesystem paths or proxy configuration

If any credential was exposed, remove it from public view, rotate or revoke it immediately, and review the repository history and release artifacts for copies.

## Safe use

- Each user must authenticate locally with an Eight Sleep account they personally control. Authorization to operate a device does not authorize sharing an account, password, token, setup file, or exported health data.
- Keep mutation controls disabled unless the user intentionally enables device changes.
- Store secrets outside the repository with permissions restricted to the local user. Treat a POSIX token file as unsafe until this repository's bundled CLI `doctor` reports `credentials.secure_permissions: true`.
- Use synthetic data for tests and continuous integration.
- Treat unexpected API responses as possible upstream changes and avoid retrying device mutations blindly.

## Migrating an existing Hermes setup

Run `doctor --check-hermes` before enabling writes. Keep only one Eight Sleep control path, remove persistent mutation settings, and remove persistent Eight Sleep email, password, access-token, and user-ID keys from both `config.yaml` and `$HERMES_HOME/.env` after token-file setup succeeds. The audit scans those files and skill paths only on the local machine. It reports booleans and relative paths only and never returns, persists, or sends configuration values.

Hermes transcripts and diagnostic logs may preserve prompts, commands, and tool output. Do not paste raw configuration or API payloads into a conversation. If a password, token, or authorization response was historically stored in a transcript or log, rotate or revoke the credential and review local backups before sharing or publishing them. Migration and log deletion are intentionally not automated.

This project is not a medical device, clinical tool, or emergency monitoring system.
