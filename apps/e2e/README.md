# Browser E2E tests

Playwright smoke tests for the public Landing and unauthenticated Dashboard
flows. This package is intentionally isolated from the root workspaces so its
browser tooling is not copied into production API, worker, or WhatsApp images.

## Local use

From the repository root:

```bash
npm ci --prefix apps/e2e
npm exec --prefix apps/e2e -- playwright install chromium
npm run test:e2e
```

Useful variants:

```bash
npm run test:e2e:headed
npm run test:e2e:ui
npm run test:e2e:report
```

The Playwright configuration starts Landing on port `3003` and Dashboard on
port `3001`. Both applications receive dummy local API URLs. Browser traffic to
non-local hosts is blocked, and every backend interaction exercised by these
tests must be explicitly mocked.

## CI

`.github/workflows/playwright.yml` runs Chromium with one worker, one retry,
traces on retry, failure screenshots, HTML output, and JUnit output. The
production deploy workflow calls this smoke suite and will not build or deploy
images if it fails.
