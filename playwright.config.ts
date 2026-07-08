import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';

// Load .env file
dotenv.config();

/**
 * Playwright Configuration
 * ბრაუზერი იხსნება სრულ ეკრანზე
 */
export default defineConfig({
  testDir: './tests',

  /* Maximum time one test can run — 2 წუთი (error-ის დროს არ გაიყინოს) */
  timeout: 120000,

  /* Run tests in files in parallel */
  fullyParallel: false,

  /* ერთი worker — ტესტები მკაცრად სერიულად (OTP inbox საერთოა, პარალელი OTP-ს ურევს) */
  workers: 1,

  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: false,

  /* Retry on CI only */
  retries: 0,

  /* Reporter to use */
  reporter: [
    // 🖥️ ტერმინალში console.log-ები (Order Created, OTP SUCCESS, redirect...) — steps-ის გარეშე
    ['list'],
    // 🟢 report: სუფთა summary (ტესტების სია, steps-ის გარეშე) → docs/report (ლოკალურიც + გიტიც)
    ['./scripts/summary-reporter.js', { outputFile: 'docs/report/index.html' }],
    // Jira reporter — product bug-ზე ქმნის Jira ticket-ს (მხოლოდ JIRA_REPORT=1-ზე)
    ['./jira-agent/reporter.js'],
  ],

  /* Shared settings for all the projects below */
  use: {
    /* Base URL to use in actions like `await page.goto('/')` */
    // baseURL: 'http://127.0.0.1:3000',

    /* ცალკეული action/navigation timeout — რომ error-ის დროს არ გაიჭედოს */
    actionTimeout: 15000,
    navigationTimeout: 30000,

    /* Collect trace when retrying the failed test */
    trace: 'on-first-retry',

    /* Screenshot disabled */
    screenshot: 'off',

    /* Video disabled */
    video: 'off',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: {
        // ✅ ბრაუზერი სრულ ეკრანზე
        viewport: null,
        launchOptions: {
          args: ['--start-maximized'],
        },
        // 🐌 Slow motion (optional - უნდა თუ არა?)
        // slowMo: 500, // 500ms delay between actions
      },
    },

    // თუ გსურთ Firefox ან WebKit - გააქტიურეთ
    // {
    //   name: 'firefox',
    //   use: {
    //     ...devices['Desktop Firefox'],
    //     viewport: null,
    //     launchOptions: {
    //       args: ['-width=1920', '-height=1080'],
    //     },
    //   },
    // },

    // {
    //   name: 'webkit',
    //   use: {
    //     ...devices['Desktop Safari'],
    //     viewport: null,
    //   },
    // },
  ],
});
