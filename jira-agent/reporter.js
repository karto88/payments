/**
 * Playwright Reporter — ამ პროექტის ტესტებიდან Jira Bug-ის შექმნა.
 *
 * ⚠️ Bug იქმნება მხოლოდ რეალურ PRODUCT bug-ზე — არა infra flakiness-ზე.
 *
 *   ✅ ApiAssertionError (assertions.ts) → product bug → Jira Bug იქმნება
 *      (მაგ. GET status body არ დააბრუნა, ორდერზე URL არ მოვიდა)
 *   ❌ სხვა შეცდომა (OTP not found, Chrome, timeout) → infra → ticket არ იქმნება
 *
 * Opt-in: მუშაობს მხოლოდ თუ JIRA_REPORT env დაყენებულია.
 *   npm run test:jira
 */
// ApiAssertionError-ის marker (assertions.ts buildError-ში წერია)
const API_BUG_MARKER = 'API TEST FAILED';

class JiraReporter {
  constructor() {
    this.enabled = !!process.env.JIRA_REPORT;
    this.apiBugs = [];
  }

  onTestEnd(test, result) {
    if (!this.enabled) return;
    if (result.status !== 'failed' && result.status !== 'timedOut') return;

    const err = (result.errors && result.errors[0]) || result.error || {};
    const message = err.message || '';

    // მხოლოდ რეალური product bug (ApiAssertionError)
    if (!message.includes(API_BUG_MARKER)) {
      console.log(
        `\n⏭️  Jira: "${test.title}" ჩავარდა, მაგრამ ეს არ არის product bug ` +
          `(infra/OTP/browser) — ticket არ იქმნება.`
      );
      return;
    }

    this.apiBugs.push({ title: test.title, message });
  }

  async onEnd() {
    if (!this.enabled || this.apiBugs.length === 0) return;

    // lazy require — ჩვეულებრივი გაშვება Jira-ს საერთოდ არ ეხება
    const jira = require('./jiraClient');

    console.log(`\n🐛 Jira: ${this.apiBugs.length} product bug(s) → ვქმნი ticket-ებს...`);

    for (const bug of this.apiBugs) {
      const summary = `[AUTO] ${bug.title} — API bug`;
      try {
        // dedup — უკვე ღია ბაგი თუ არსებობს, არ დავადუბლიროთ
        const existing = await jira.findOpenBug(summary);
        if (existing) {
          console.log(`   ⏭️  ${existing.key} უკვე არსებობს — ვამატებ კომენტარს`);
          await jira.addComment(
            existing.key,
            `🤖 კვლავ დაფიქსირდა (${new Date().toISOString()}):\n\n${bug.message}`
          );
          continue;
        }

        const created = await jira.createBug({
          summary,
          description:
            `🤖 ავტომატურად აღმოჩენილი API bug (Playwright).\n` +
            `🧪 ტესტი: "${bug.title}"\n` +
            `დრო: ${new Date().toISOString()}\n\n${bug.message}`,
          labels: ['auto-bug'],
        });
        // Backlog-ის ნაცვლად active sprint-ში (board-ის To Do)
        try {
          const added = await jira.addToActiveSprint(created.key);
          console.log(added ? `   📋 ${created.key} → active sprint (To Do)` : `   ⚠️ active sprint ვერ მოიძებნა — Backlog-ში დარჩა`);
        } catch (e) {
          console.log(`   ⚠️ sprint-ში ჩაგდება ვერ მოხერხდა: ${e.message}`);
        }

        console.log(`   ✅ შეიქმნა: ${created.key} — ${jira.BASE_URL}/browse/${created.key}`);
      } catch (e) {
        console.error(`   💥 Jira ticket ვერ შეიქმნა: ${e.message}`);
      }
    }
  }
}

module.exports = JiraReporter;
