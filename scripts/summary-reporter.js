/**
 * Custom Playwright Reporter — მხოლოდ ტესტების სია (steps-ის გარეშე).
 *
 * აჩვენებს: ტესტის სახელი + pass/fail + დრო. ფაილში → docs/report/index.html
 * არ აჩვენებს: steps, file:line, code preview, pw:api.
 */
const fs = require('fs');
const path = require('path');

class SummaryReporter {
  constructor(options = {}) {
    this.outputFile = options.outputFile || 'docs/report/index.html';
    this.results = [];
  }

  onBegin() {
    this.startedAt = new Date();
  }

  onTestEnd(test, result) {
    this.results.push({
      title: test.title,
      file: path.relative(process.cwd(), test.location.file).replace(/\\/g, '/'),
      status: result.status, // passed | failed | timedOut | skipped
      durationMs: result.duration,
    });
  }

  async onEnd() {
    const total = this.results.length;
    const passed = this.results.filter((r) => r.status === 'passed').length;
    const failed = this.results.filter((r) => r.status === 'failed' || r.status === 'timedOut').length;
    const skipped = this.results.filter((r) => r.status === 'skipped').length;

    // ფაილების მიხედვით დაჯგუფება
    const byFile = {};
    for (const r of this.results) {
      (byFile[r.file] = byFile[r.file] || []).push(r);
    }

    const fmt = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);
    const icon = (s) => (s === 'passed' ? '✅' : s === 'skipped' ? '⏭️' : '❌');
    const color = (s) => (s === 'passed' ? '#3fb950' : s === 'skipped' ? '#7d8590' : '#f85149');

    let rows = '';
    for (const [file, tests] of Object.entries(byFile)) {
      rows += `<div class="file">${file}</div>`;
      for (const t of tests) {
        rows += `<div class="test">
          <span class="st" style="color:${color(t.status)}">${icon(t.status)} ${t.status}</span>
          <span class="name">${t.title}</span>
          <span class="dur">${fmt(t.durationMs)}</span>
        </div>`;
      }
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Test Report</title>
  <style>
    body { font-family: system-ui, sans-serif; background:#0d1117; color:#e6edf3; margin:0; padding:32px; }
    h1 { font-size:20px; margin:0 0 4px; }
    .meta { color:#7d8590; font-size:13px; margin-bottom:20px; }
    .summary { display:flex; gap:12px; margin-bottom:24px; }
    .card { background:#161b22; border:1px solid #30363d; border-radius:8px; padding:12px 18px; font-weight:600; }
    .card.pass { color:#3fb950; } .card.fail { color:#f85149; } .card.skip { color:#7d8590; }
    .file { color:#7d8590; font-size:13px; margin:18px 0 6px; font-weight:600; }
    .test { display:flex; align-items:center; gap:16px; background:#161b22; border:1px solid #30363d;
            border-radius:6px; padding:12px 16px; margin-bottom:6px; }
    .st { min-width:110px; font-weight:600; font-size:13px; }
    .name { flex:1; }
    .dur { color:#7d8590; font-size:13px; }
  </style>
</head>
<body>
  <h1>🎭 Playwright Test Report</h1>
  <div class="meta">${this.startedAt.toLocaleString()}</div>
  <div class="summary">
    <div class="card">Total: ${total}</div>
    <div class="card pass">✅ Passed: ${passed}</div>
    <div class="card fail">❌ Failed: ${failed}</div>
    <div class="card skip">⏭️ Skipped: ${skipped}</div>
  </div>
  ${rows}
</body>
</html>`;

    const outPath = path.resolve(process.cwd(), this.outputFile);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, html);
    console.log(`\n📄 Summary report: ${this.outputFile} (${passed}/${total} passed)`);
  }
}

module.exports = SummaryReporter;
