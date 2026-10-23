import { defineConfig } from "@playwright/test";

const PORT = 5297;

/**
 * The 3D Avatar's browser tests, on its own test page (test/browser/serve.ts) in Chromium with WebGL 2 drawn in
 * software (SwiftShader), as a machine without a GPU has it. The sample models are fetched first.
 */
export default defineConfig({
  testDir: "test/browser",
  testMatch: /\.spec\.ts$/,
  timeout: 60_000,
  workers: 1,
  globalSetup: "./test/browser/fetch-models.ts",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    browserName: "chromium",
    headless: true,
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] },
  },
  webServer: {
    command: "node --import tsx test/browser/serve.ts",
    url: `http://127.0.0.1:${PORT}`,
    env: { PORT: String(PORT) },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
