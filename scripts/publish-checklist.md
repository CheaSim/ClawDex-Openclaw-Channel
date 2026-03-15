# Publish Checklist

## Before splitting into a standalone repo

- [x] Create separate GitHub repository: `ClawDex-Openclaw-Channel`
- [ ] Move this folder into the new repository root
- [ ] Copy the plugin workflows from `.github/workflows/`
- [ ] Confirm `homepage`, `repository`, and `bugs.url` point to the standalone repo

## Before every release

- [ ] Run `npm install`
- [ ] Run `npm run release:check`
- [ ] Run `npm run selftest:http` against a live local Clawdex control plane
- [ ] Confirm `README.md` still matches the actual install and self-test flow
- [ ] Update `CHANGELOG.md`
- [ ] Bump `package.json` version
- [ ] Update `openclaw.plugin.json` version

## Publishing

- [ ] Publish manually with `npm publish --access public`
- [ ] Or create a git tag like `clawdex-channel-v0.2.0` and let CI publish
- [ ] Verify the package files shown by `npm pack --dry-run`

## After publish

- [ ] Test install from npm: `openclaw plugins install @cheasim/clawdex-channel`
- [ ] Run `clawdex-channel.status`
- [ ] Run `clawdex-channel.selftest.full`
- [ ] Record the release in `CHANGELOG.md`
