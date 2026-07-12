# Release Verification

Release evidence must start from the committed lockfile and the pinned development toolchain. Do not treat an existing `node_modules` directory as clean-install evidence.

## Clean Install

With `nvm` installed:

```bash
nvm use
npm ci
npm run test:e2e:install
npm run verify:release
```

On a Linux or CI host that also needs Chromium system packages, replace the browser-install command with:

```bash
npx playwright install --with-deps chromium
```

That command installs browser prerequisites only. The repository currently checks in reviewed `chromium-darwin` screenshot baselines for the recorded macOS release. Before treating the full release gate as certified on Linux, generate, review, and commit the corresponding Playwright Linux baselines; do not auto-accept missing screenshots in CI.

The repository pins Node.js 22.18.0 in `.nvmrc` and npm 10.9.3 in `package.json`. The supported minimums remain Node.js 20.19 and npm 10, but release performance numbers should record the exact runtime, Chromium revision, operating system, and hardware used.

## Release Gates

`npm run verify:release` runs these commands in order and stops on the first failure:

1. `npm run lint`
2. `npm run typecheck`
3. `npm run test:coverage` (the full Vitest suite plus enforced coverage thresholds)
4. `npm run test:e2e`
5. `npm run build`
6. `npm run validate:starter`

The individual gates remain available for focused iteration. `npm run test:coverage` produces text output and an ignored local HTML report under `coverage/`.

The Playwright configuration starts its own Webpack-based Next.js development server on `127.0.0.1:3100`. Do not start a second server for the standard end-to-end command. On non-CI runs Playwright may reuse an existing process at that address, so stop unrelated servers before recording release evidence.

## Browser And Layout Evidence

Chromium is the only verified v1 browser engine. Browser tests cover these release viewports:

- Desktop: `1440 x 1100`
- Tablet: `768 x 1024`
- Mobile: `390 x 844`

The suite checks horizontal overflow, clipped controls, incoherent region overlap, readable neural labels, keyboard tab switching, settings focus behavior, reduced-effects mode, uncaught page errors, and unexpected console errors. Visual baselines should be reviewed whenever an intentional UI change updates the supported-viewport screenshots.

Replay verification also inspects canvas pixels to prove that the rendered frame is nonblank and changes over time. Fish selection must preserve canvas-index-to-genome identity and drive the matching live neural graph.

## Performance Contracts

The release target on the recorded development machine is:

- At least 55 rendered replay frames per second while representative training runs
- No observed main-thread long task above 50 ms during representative training
- Replay snapshots below 5 KB; the current packed layout is 832 bytes
- Training progress updates no more than 500 ms apart while work advances
- One active replay worker and one active trainer worker, with old workers terminated during recovery, reset, reload, and unmount
- IndexedDB writes only for coherent completed checkpoints

Performance thresholds are machine-sensitive. A passing result is evidence for the recorded release environment, not a universal frame-rate guarantee for every Chromium device.

## Recorded V1 Run

The 2026-07-12 release run used macOS 26.5.1 on an Apple M2 Pro MacBook Pro with 10 CPU cores and 16 GB memory, Node.js 22.18.0, npm 10.9.3, Playwright 1.61.1, and Chromium 149.0.7827.55. It began with `npm ci`, which reported zero known package vulnerabilities, then completed `npm run verify:release`.

- Vitest: 42 files and 202 tests passed
- Playwright: 10 tests passed
- Concurrent replay windows: 88.0, 91.9, and 92.9 rendered frames per second
- Maximum observed progress gap: 58.6 ms across 622 progress events
- Replay snapshot payload: 832 bytes in one shared transferred buffer
- Main-thread long tasks at or above 50 ms: 0
- Live worker count during the probe: 1 replay worker and 1 trainer worker
- Starter artifact and champion checksums: unchanged

The performance test attaches a compact `release-performance.json` record to its Playwright result so later runs can be compared without changing application code.

## Starter Integrity

`npm run validate:starter` revalidates the checked-in Level 6 artifact structure, deterministic recipe metadata, held-out score, artifact checksum, and champion parameter checksum. Regeneration is a separate explicit operation:

```bash
npm run train:starter
npm run validate:starter
```

Do not regenerate the artifact as an incidental release step. A changed artifact or checksum requires intentional review of the recipe and validation evidence.

## Generated Output

Local output is intentionally untracked:

- `.next/`
- `coverage/`
- `playwright-report/`
- `test-results/`
- `*.tsbuildinfo`

Inspect Playwright HTML reports, traces, screenshots, and test results before deleting them when a release gate fails.
