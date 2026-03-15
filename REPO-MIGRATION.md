# Repo Migration Guide

This folder is now close to standalone-repo shape.

When you move `clawdex-openclaw-channel/` into its own repository, use this checklist.

## Copy these files as-is

- `plugin.ts`
- `openclaw.plugin.json`
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `README.md`
- `CHANGELOG.md`
- `examples/`
- `skills/`
- `scripts/`

## Also move these workflows into the new repo root

- `.github/workflows/clawdex-channel-ci.yml`
- `.github/workflows/clawdex-channel-release.yml`

In the standalone repo, those files should live at:

- `.github/workflows/clawdex-channel-ci.yml`
- `.github/workflows/clawdex-channel-release.yml`

## After moving

1. run `npm install`
2. run `npm run release:check`
3. run `npm run selftest:http`
4. verify `homepage`, `repository`, and `bugs.url`
5. add `NPM_TOKEN` to GitHub Actions secrets
6. publish with a tag like `clawdex-channel-v0.2.0`

Target repository:

- `https://github.com/CheaSim/ClawDex-Openclaw-Channel.git`

## Notes

- `package-lock.json` is intentionally lightweight and only captures local dev dependencies.
- `openclaw` remains a peer dependency because the runtime should provide it.
- publish workflows currently assume npm public publish.
