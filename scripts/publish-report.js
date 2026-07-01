/**
 * ტესტების გაშვება + Playwright Report-ის ავტომატური გამოქვეყნება GitHub Pages-ზე.
 *
 *   npm run publish-report                                   # ყველა ტესტი
 *   npm run publish-report -- tests/Positive/gps-status.spec.ts   # კონკრეტული
 *
 * თანმიმდევრობა:
 *   1. npx playwright test  (report → docs/report/, სრულად)
 *   2. git add docs
 *   3. git commit (თუ ცვლილებაა)
 *   4. git push
 *   → https://karto88.github.io/payments/report/ (ყოველთვის უახლესი)
 */
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: true, ...opts });
}

// git — shell-ის გარეშე (რომ commit message space-ებით არ დაიშალოს)
function git(args, opts = {}) {
  return spawnSync('git', args, { cwd: ROOT, stdio: 'inherit', ...opts });
}

// 1️⃣ ტესტების გაშვება — ჩავარდნაზეც ვაგრძელებთ (report მაინც უნდა აიტვირთოს)
const extraArgs = process.argv.slice(2);
console.log('▶️  ტესტების გაშვება...');
// NO_OPEN — publish-ის დროს report სერვერი არ გაიხსნას (თორემ script დაიბლოკება)
const testResult = run('npx', ['playwright', 'test', ...extraArgs], {
  env: { ...process.env, NO_OPEN: '1' },
});
const testsPassed = testResult.status === 0;
console.log(testsPassed ? '✅ ტესტები გაიარა' : '⚠️ ზოგი ტესტი ჩავარდა — report მაინც ვაქვეყნებ');

// 2️⃣ git add
git(['add', 'docs']);

// 3️⃣ ცვლილება თუ არ არის — გამოვტოვოთ
const staged = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: ROOT });
if (staged.status === 0) {
  console.log('ℹ️ report-ში ცვლილება არ არის — push საჭირო არ არის');
  process.exit(testsPassed ? 0 : 1);
}

// 4️⃣ commit + push
const stamp = new Date().toISOString();
git(['commit', '-m', `chore: update Playwright report ${stamp}`]);
const push = git(['push']);

if (push.status === 0) {
  console.log('\n✅ Report გამოქვეყნდა:');
  console.log('   https://karto88.github.io/payments/report/');
} else {
  console.log('\n❌ git push ჩავარდა — შეამოწმე კავშირი/უფლებები');
}

// exit code ასახავს ტესტების შედეგს
process.exit(testsPassed ? 0 : 1);
