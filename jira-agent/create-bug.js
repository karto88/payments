/**
 * ბაგის ხელით შექმნა (manual).
 *
 * გამოყენება:
 *   node jira-agent/create-bug.js "summary" "description"
 *
 * მაგ:
 *   node jira-agent/create-bug.js "callback არ იგზავნება 3DS-ის მერე" "გადახდა წარმატებულია მაგრამ callback არ მოდის"
 */
const jira = require('./jiraClient');

async function main() {
  const summary = process.argv[2];
  const description = process.argv[3] || '';

  if (!summary) {
    console.error('❌ გამოყენება: node jira-agent/create-bug.js "summary" "description"');
    process.exit(1);
  }

  const bug = await jira.createBug({
    summary,
    description: description + `\n\n(შექმნილია ხელით — Jira Agent CLI)`,
    labels: ['manual-bug'],
  });

  console.log(`🐛 ბაგი შეიქმნა: ${bug.key}`);
  console.log(`🔗 ${jira.BASE_URL}/browse/${bug.key}`);
}

main().catch((err) => {
  console.error('💥 Error:', err.message);
  process.exit(1);
});
