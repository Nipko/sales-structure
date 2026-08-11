import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

const repositoryRoot = resolve(__dirname, "..", "..");
const isCI = Boolean(process.env.CI);

const landingUrl = "http://127.0.0.1:3003";
const dashboardUrl = "http://127.0.0.1:3001";
const apiUrl = "http://127.0.0.1:3999/api/v1";
const whatsappServiceUrl = "http://127.0.0.1:3998/api/v1";

const safeBrowserEnvironment = {
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_PUBLIC_API_URL: apiUrl,
  NEXT_PUBLIC_WA_SERVICE_URL: whatsappServiceUrl,
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: "e2e.invalid",
  NEXT_PUBLIC_META_APP_ID: "e2e",
  NEXT_PUBLIC_META_CONFIG_ID: "e2e",
  NEXT_PUBLIC_META_SOLUTION_ID: "e2e",
  NEXT_PUBLIC_INSTAGRAM_APP_ID: "e2e",
  NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI: `${dashboardUrl}/admin/channels/instagram/callback`,
  NEXT_PUBLIC_MESSENGER_FB_LOGIN_CONFIG_ID: "e2e",
  NEXT_PUBLIC_MP_PUBLIC_KEY: "TEST-e2e",
};

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: isCI,
  failOnFlakyTests: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 1 : undefined,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  reporter: isCI
    ? [
        ["github"],
        ["html", { outputFolder: "playwright-report", open: "never" }],
        ["junit", { outputFile: "test-results/junit.xml" }],
      ]
    : [
        ["list"],
        ["html", { outputFolder: "playwright-report", open: "never" }],
      ],
  use: {
    colorScheme: "light",
    locale: "es-CO",
    timezoneId: "America/Bogota",
    reducedMotion: "reduce",
    serviceWorkers: "block",
    proxy: {
      server: "http://127.0.0.1:1",
      bypass: "127.0.0.1,localhost",
    },
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
    launchOptions: {
      // Local URLs use 127.0.0.1; every hostname is made unresolvable so an
      // accidental hard-coded URL cannot contact production or a third party.
      args: [
        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost",
      ],
    },
  },
  projects: [
    {
      name: "landing-chromium",
      testMatch: "**/landing/**/*.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: landingUrl,
      },
    },
    {
      name: "dashboard-chromium",
      testMatch: "**/dashboard/**/*.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: dashboardUrl,
      },
    },
  ],
  webServer: [
    {
      command: "npm run dev --workspace=landing",
      cwd: repositoryRoot,
      env: safeBrowserEnvironment,
      url: landingUrl,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command:
        "npm run build --workspace=@parallext/shared && npm run dev --workspace=@parallext/dashboard",
      cwd: repositoryRoot,
      env: safeBrowserEnvironment,
      url: `${dashboardUrl}/login`,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
