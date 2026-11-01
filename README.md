# dsh-token-control

[![release](https://github.com/RitvaManner/dsh-token-control/actions/workflows/release.yml/badge.svg)](https://github.com/RitvaManner/dsh-token-control/actions/workflows/release.yml)
[![npm version](https://img.shields.io/npm/v/dsh-token-control.svg)](https://www.npmjs.com/package/dsh-token-control)
[![npm downloads](https://img.shields.io/npm/dm/dsh-token-control.svg)](https://www.npmjs.com/package/dsh-token-control)
[![license](https://img.shields.io/npm/l/dsh-token-control.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D22-339933)](https://nodejs.org)
[![dsh](https://img.shields.io/badge/dsh-%3E%3D0.2.0-3964fe)](https://github.com/deepseek-ai/deepseek-harness)
[![GitHub release](https://img.shields.io/github/v/release/RitvaManner/dsh-token-control.svg)](https://github.com/RitvaManner/dsh-token-control/releases)

**Per-turn token and cost readout, DeepSeek CNY balance, and peak/off-peak countdown** — a DeepSeek Harness plugin mounted above the composer.

[What it shows](#what-it-shows) · [Layout](#layout) · [Install](#install) · [Development](#development) · [Security](#security) · [Release notes](https://github.com/RitvaManner/dsh-token-control/blob/main/docs/release-notes-v0.1.0.md)

Host and Client are strictly separated; PricingStrategy, BalanceProvider, PeakPeriodProvider, and View are replaceable seams; the UI is fully pluggable.

> Status: v0.1.0 — rendered and exercised on a desktop profile (real session numbers, live balance), 47 unit assertions passing. Design: [docs/design-v1.md](https://github.com/RitvaManner/dsh-token-control/blob/main/docs/design-v1.md) · Verification: [docs/verify-v1.md](https://github.com/RitvaManner/dsh-token-control/blob/main/docs/verify-v1.md).

## What it shows

- Per turn: total tokens, input total, output, cache hits, cache misses — separately.
- Cost from the price table, with the peak/off-peak unit price chosen **at each call's own timestamp**, so a turn that crosses a boundary is still billed correctly.
- Live streaming updates; before the provider reports usage the output count is a character estimate, clearly marked with `≈`, then replaced by the committed value.
- Balance from `GET /user/balance` (CNY wallet). A failed refresh keeps the previous reading and marks it stale with its timestamp.
- Peak windows: Beijing time Mon–Fri 09:00–12:00 and 14:00–18:00, excluding statutory holidays; everything else (weekends, holidays, make-up workday weekends) is off-peak at 50%.
- Reminder: countdown in the readout during the last five minutes, plus a silent three-second "switched" note — no dialog, no interruption.

## Layout

```
src/definition/   contracts and pure data: ViewModel, wire protocol, peak math, price table, holiday policy
src/provider/     replaceable implementations (pricing, peak policy, DeepSeek balance, calibration, null alerts)
src/consumer/     depends on definition only: ledger fold, ViewModel builder, hub, view config
src/host/         composition root; every registration goes through ctx.effect
src/client/       core.js (transport, store, ViewRegistry, React shell, settings page)
src/client/views/ one self-contained file per View
src/client/client.js   GENERATED bundle: core.js with every View inlined
```

The direction is enforced by `scripts/check.mjs` and `tests/architecture.test.mjs`.

### Views

Each View is one file under `src/client/views/` listed in `views/index.json`; adding a View is one new file, one manifest line, then `pnpm build`. The builder inlines every View into the Client bundle.

That build step exists because the Harness Client loader runs a package's `./client` export as a **classic script**: it cannot `import` a sibling file, and loading one later is fragile — a dynamic `<script>` depends on page policy, and a page-global handshake depends on activation order (a second activation can clobber the first). Inlining at build time keeps "one file per View" while leaving no runtime moving parts.

## Install

```sh
# from npm (after publishing)
dsh plugin --profile <profile> add dsh-token-control

# from GitHub
dsh plugin --profile <profile> add github:RitvaManner/dsh-token-control

# from a local checkout (development)
dsh plugin --profile <profile> add .
```

Then open **Settings → Token Monitor** and choose where the readout mounts (default `conversation.input.dock`, the row above the composer).

## Development

```sh
node scripts/build-client.mjs   # regenerate src/client/client.js after editing core.js or a View
pnpm dev                        # build, then create/reuse .dsh-dev, link, boot the dev profile
pnpm dev:reset                  # delete .dsh-dev and rebuild it
```

Everything lives inside the repository (`.dsh-dev/`); `~/.dsh` is untouched.

## Security

- The API key is resolved **on the Host only** through `ctx.credentials.resolve('DEEPSEEK_API_KEY')` and appears solely in the outbound `Authorization` header.
- The browser receives a field-by-field ViewModel; a test pins the key set. No key, URL, upstream body, Session, or event reaches the page.
- Errors cross the wire as enum codes.
- The routes bind loopback only, but they are registered outside DSH's `/api` connection admission: a local process can read the snapshot (it carries the balance, never the key). This matches the existing community-plugin pattern; wrapping the handler in `ctx.connection.admit` is the hardening path.

## Sources

- Prices: [DeepSeek models & pricing (CNY)](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/), table version `DS_CNY_2026_11`.
- Holidays: [State Council notice for 2026](https://www.gov.cn/zhengce/content/202511/content_7047090.htm).

## License

MIT
