# Security Policy

## Scope and support

Security fixes target the latest released version. Older versions may not receive fixes.

This is an unofficial community project. It is not affiliated with, endorsed by, or supported by Eight Sleep, Inc. It uses private, undocumented API endpoints that may change without notice.

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

- Each user must authenticate locally with their own Eight Sleep account. Never share accounts, tokens, or exported health data.
- Keep mutation controls disabled unless the user intentionally enables device changes.
- Store secrets outside the repository with permissions restricted to the local user.
- Use synthetic data for tests and continuous integration.
- Treat unexpected API responses as possible upstream changes and avoid retrying device mutations blindly.

This project is not a medical device, clinical tool, or emergency monitoring system.
