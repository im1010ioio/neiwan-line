import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
    testDir: "./tests/e2e",
    fullyParallel: false,
    webServer: {
        command: "npm run dev -- --port 4178",
        env: { VITE_GA_MEASUREMENT_ID: "G-TEST123" },
        url: "http://127.0.0.1:4178",
        reuseExistingServer: !process.env.CI,
    },
    use: { baseURL: "http://127.0.0.1:4178", trace: "retain-on-failure" },
    projects: [
        { name: "mobile", use: { ...devices["iPhone 13"], browserName: "chromium" } },
        { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    ],
});
