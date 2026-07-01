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

  /* Maximum time one test can run */
  timeout: 0, // No timeout for interactive tests

  /* Run tests in files in parallel */
  fullyParallel: false,

  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: false,

  /* Retry on CI only */
  retries: 0,

  /* Reporter to use */
  reporter: [
    // 🟢 გამოსაქვეყნებელი: სუფთა summary (მხოლოდ ტესტების სია, steps-ის გარეშე) → docs/report
    ['./scripts/summary-reporter.js', { outputFile: 'docs/report/index.html' }],
    // 🔧 ლოკალური debug: სრული Playwright report (steps-ით) → playwright-report (gitignored)
    ['html', { outputFolder: 'playwright-report', open: process.env.NO_OPEN ? 'never' : 'on-failure' }],
    ['allure-playwright', {
      outputFolder: 'allure-results',
      detail: true,
      suiteTitle: true,
    }],
    // Jira reporter — product bug-ზე ქმნის Jira ticket-ს (მხოლოდ JIRA_REPORT=1-ზე)
    ['./jira-agent/reporter.js'],
  ],

  /* Shared settings for all the projects below */
  use: {
    /* Base URL to use in actions like `await page.goto('/')` */
    // baseURL: 'http://127.0.0.1:3000',

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
