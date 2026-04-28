# Changelog

## [0.3.0] - 2026-04-28

### Added
- MIT `LICENSE`, `CONTRIBUTING.md`, and `SECURITY.md` to support open-source distribution and contribution workflows.
- Vitest test scaffolding with a focused utility test suite for plugin helper behavior.
- Funding metadata and test scripts in `package.json`.

### Improved
- `.gitignore` now excludes local environment files, logs, and TypeScript incremental build artifacts.
- `README.md` was reorganized for commercial adoption, including badges, a value proposition, and a three-step quick start.
- `plugin.ts` now includes request retry behavior, request IDs, clearer utility documentation, and better control-plane error reporting.
- Release metadata now uses the MIT license and aligns on version `0.3.0`.

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
