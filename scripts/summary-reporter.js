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
    const err = (result.errors && result.errors[0]) || result.error;
    // ტესტის console.log-ები (stdout) — ✅ ბიჯები რეპორტში გამოსაჩენად
    const stdout = (result.stdout || [])
      .map((c) => (typeof c === 'string' ? c : c.toString('utf8')))
      .join('')
      .trim();
    this.results.push({
      title: test.title,
      file: path.relative(process.cwd(), test.location.file).replace(/\\/g, '/'),
      status: result.status, // passed | failed | timedOut | skipped
      durationMs: result.duration,
      error: err ? err.message || String(err) : null, // ჩავარდნის მიზეზი
      stdout, // ტესტის ლოგები
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
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const isFail = (s) => s === 'failed' || s === 'timedOut';
    // ფილტრისთვის სტატუსის ნორმალიზება: pass | fail | skip
    const cls = (s) => (s === 'passed' ? 'pass' : s === 'skipped' ? 'skip' : 'fail');

    let rows = '';
    for (const [file, tests] of Object.entries(byFile)) {
      // file-group wrapper — ფილტრისას ცარიელი ჯგუფის header დასამალად
      rows += `<div class="file-group">`;
      rows += `<div class="file">${esc(file)}</div>`;
      for (const t of tests) {
        // ჩამოსაშლელი (accordion): ჩავარდნილი ღიაა default-ად, დანარჩენი დაკეცილი
        const hasDetail = t.stdout || (isFail(t.status) && t.error);
        const openAttr = isFail(t.status) ? ' open' : '';
        rows += `<details class="test-item" data-status="${cls(t.status)}"${openAttr}>
          <summary class="test">
            <span class="chev">${hasDetail ? '▶' : ''}</span>
            <span class="st" style="color:${color(t.status)}">${icon(t.status)} ${t.status}</span>
            <span class="name">${esc(t.title)}</span>
            <span class="dur">${fmt(t.durationMs)}</span>
          </summary>`;
        // ტესტის ლოგები (console.log ბიჯები) — ყველა ბიჯი
        if (t.stdout) {
          rows += `<pre class="log">${esc(t.stdout)}</pre>`;
        }
        // ჩავარდნის მიზეზი (error) — მხოლოდ failed/timedOut ტესტებზე, წითლად
        if (isFail(t.status) && t.error) {
          rows += `<pre class="err">${esc(t.error)}</pre>`;
        }
        rows += `</details>`;
      }
      rows += `</div>`;
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
    .card { background:#161b22; border:1px solid #30363d; border-radius:8px; padding:12px 18px;
            font-family:inherit; font-size:14px; font-weight:600; color:#e6edf3; cursor:pointer;
            transition:border-color .15s, box-shadow .15s; }
    .card:hover { border-color:#484f58; }
    .card.active { border-color:#58a6ff; box-shadow:0 0 0 1px #58a6ff; }
    .card.pass { color:#3fb950; } .card.fail { color:#f85149; } .card.skip { color:#7d8590; }
    .file { color:#7d8590; font-size:13px; margin:18px 0 6px; font-weight:600; }
    .test-item { margin-bottom:6px; }
    .test { display:flex; align-items:center; gap:16px; background:#161b22; border:1px solid #30363d;
            border-radius:6px; padding:12px 16px; cursor:pointer; list-style:none; user-select:none; }
    .test::-webkit-details-marker { display:none; }
    .test:hover { border-color:#484f58; }
    .chev { color:#7d8590; font-size:11px; width:12px; transition:transform .15s; }
    details[open] > .test .chev { transform:rotate(90deg); }
    .st { min-width:110px; font-weight:600; font-size:13px; }
    .name { flex:1; }
    .dur { color:#7d8590; font-size:13px; }
    .err { background:#161b22; border:1px solid #f85149; border-left:3px solid #f85149; border-radius:6px;
           padding:12px 16px; margin:-2px 0 10px; color:#ffa198; font-size:12px; white-space:pre-wrap;
           overflow-x:auto; font-family:monospace; }
    .log { background:#0b0f14; border:1px solid #30363d; border-left:3px solid #3fb950; border-radius:6px;
           padding:12px 16px; margin:-2px 0 10px; color:#adbac7; font-size:12px; white-space:pre-wrap;
           overflow-x:auto; font-family:monospace; line-height:1.5; }
  </style>
</head>
<body>
  <h1>🎭 Playwright Test Report</h1>
  <div class="meta">${this.startedAt.toLocaleString()}</div>
  <div class="summary">
    <button type="button" class="card active" data-filter="all">Total: ${total}</button>
    <button type="button" class="card pass" data-filter="pass">✅ Passed: ${passed}</button>
    <button type="button" class="card fail" data-filter="fail">❌ Failed: ${failed}</button>
    <button type="button" class="card skip" data-filter="skip">⏭️ Skipped: ${skipped}</button>
  </div>
  ${rows}
  <script>
    (function () {
      const cards = document.querySelectorAll('.card');
      const items = document.querySelectorAll('.test-item');
      const groups = document.querySelectorAll('.file-group');
      function applyFilter(f) {
        items.forEach((it) => {
          it.style.display = (f === 'all' || it.dataset.status === f) ? '' : 'none';
        });
        // ცარიელი file-group-ის header დამალვა
        groups.forEach((g) => {
          let anyVisible = false;
          g.querySelectorAll('.test-item').forEach((it) => {
            if (it.style.display !== 'none') anyVisible = true;
          });
          g.style.display = anyVisible ? '' : 'none';
        });
        cards.forEach((c) => c.classList.toggle('active', c.dataset.filter === f));
      }
      cards.forEach((c) => c.addEventListener('click', () => applyFilter(c.dataset.filter)));
    })();
  </script>
</body>
</html>`;

    const outPath = path.resolve(process.cwd(), this.outputFile);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, html);
    console.log(`\n📄 Summary report: ${this.outputFile} (${passed}/${total} passed)`);

    // ავტომატური push GitHub Pages-ზე (გამორთვა: NO_PUSH=1)
    if (!process.env.NO_PUSH) {
      this.pushToGit();
    }
  }

  /** docs/report-ის ავტომატური git push (ჩუმად, შეცდომას ვერ არღვევს ტესტს) */
  pushToGit() {
    const { spawnSync } = require('child_process');
    try {
      const opts = { cwd: process.cwd(), stdio: 'ignore' };
      spawnSync('git', ['add', 'docs/report'], opts);

      // ცვლილება თუ არ არის — არაფერი
      const staged = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: process.cwd() });
      if (staged.status === 0) return;

      const stamp = new Date().toISOString();
      spawnSync('git', ['commit', '-m', `chore: update report ${stamp}`], opts);
      const push = spawnSync('git', ['push'], opts);

      if (push.status === 0) {
        console.log('🚀 Report published → https://karto88.github.io/payments/report/');
      } else {
        console.log('⚠️ auto-push ვერ მოხერხდა (offline? / git error)');
      }
    } catch (e) {
      console.log('⚠️ auto-push გამოტოვდა:', e.message);
    }
  }
}

module.exports = SummaryReporter;
