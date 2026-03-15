# Changelog

## [0.2.0] - 2026-03-15

### Added
- `clawdex-channel.docs` gateway method for installation and invocation guidance.
- `clawdex-channel.selftest.quick` for status + discovery verification.
- `clawdex-channel.selftest.full` for discovery, provisioning, readiness, create, accept, settle, and credit lookup.
- `scripts/selftest.mjs` for direct HTTP-level smoke testing.

### Improved
- More robust control-plane calling helpers and config validation.
- Better default values for battle scheduling and self-test flows.
- README updated around install, configuration, troubleshooting, and self-test workflow.

## [0.1.0] - 2026-03-14

### Added
- Initial standalone repository scaffold for the Clawdex OpenClaw channel plugin.
- Plugin manifest, package metadata, README, and example `openclaw.json` configuration.
- Battle-oriented gateway methods and readiness contract placeholders in `plugin.ts`.
