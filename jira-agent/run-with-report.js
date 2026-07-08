/**
 * ტესტების გაშვება Jira reporter ჩართული (cross-platform, cross-env-ის გარეშე).
 *
 *   npm run test:jira                      # ყველა ტესტი + Jira bug reporting
 *   npm run test:jira -- tests/Positive/gps-status.spec.ts   # კონკრეტული ტესტი
 */
const { spawn } = require('child_process');
const path = require('path');

const extraArgs = process.argv.slice(2); // გადაცემული ტესტ ფაილები/ფლაგები
const args = ['playwright', 'test', ...extraArgs];

const child = spawn('npx', args, {
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, JIRA_REPORT: '1' },
});

child.on('exit', (code) => process.exit(code ?? 0));
