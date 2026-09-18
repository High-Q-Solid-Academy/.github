import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'gradebook.json'), 'utf8'));

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const learners = new Map();
for (const row of data.rows) {
  const key = String(row.githubId || row.student || row.repository);
  if (!learners.has(key)) learners.set(key, { name: row.realName, login: row.student, id: row.githubId, rows: [] });
  learners.get(key).rows.push(row);
}

const scored = data.rows.filter((row) => Number.isFinite(row.score));
const average = scored.length ? Math.round(scored.reduce((sum, row) => sum + row.score, 0) / scored.length) : 0;
const passed = scored.filter((row) => row.passed).length;
const generated = new Intl.DateTimeFormat('en-NG', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Africa/Lagos' }).format(new Date(data.generatedAt));

const reportCards = [...learners.values()].sort((a, b) => a.name.localeCompare(b.name)).map((learner) => {
  const rows = learner.rows.sort((a, b) => a.order - b.order);
  const learnerScored = rows.filter((row) => Number.isFinite(row.score));
  const learnerAverage = learnerScored.length ? Math.round(learnerScored.reduce((sum, row) => sum + row.score, 0) / learnerScored.length) : 0;
  const identityWarning = rows.some((row) => row.identityState !== 'verified');
  return `<section class="report-card">
    <header><div><span class="eyebrow">Learner report</span><h2>${escapeHtml(learner.name)}</h2><p>@${escapeHtml(learner.login)} · GitHub ID ${escapeHtml(learner.id || 'unavailable')}</p></div><div class="score ${learnerAverage >= 70 ? 'pass' : 'attention'}">${learnerAverage}<small>/100 average</small></div></header>
    ${identityWarning ? '<p class="warning">⚠ Identity needs instructor review. The GitHub profile name or account ID no longer matches the protected enrollment record.</p>' : ''}
    <table><thead><tr><th>Course</th><th>Score</th><th>Result</th><th>Last graded</th></tr></thead><tbody>
      ${rows.map((row) => `<tr><td>${escapeHtml(row.course)}</td><td>${Number.isFinite(row.score) ? `${row.score}/100` : 'Not graded'}</td><td><span class="pill ${row.passed ? 'passed' : 'pending'}">${row.passed ? 'Passed' : escapeHtml(row.state)}</span></td><td>${escapeHtml(row.updatedAt || '—')}</td></tr>`).join('')}
    </tbody></table>
    <footer>High Q Solid Academy · Generated ${escapeHtml(generated)} · Instructor signature: ____________________</footer>
  </section>`;
}).join('\n');

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>High Q Instructor Gradebook</title><style>
:root{font-family:Inter,Segoe UI,Arial,sans-serif;color:#172033;background:#eef3f8}*{box-sizing:border-box}body{margin:0}.cover,.report-card{max-width:1100px;margin:28px auto;background:#fff;border:1px solid #d9e2ec;border-radius:18px;box-shadow:0 10px 30px #183b5b18;overflow:hidden}.cover{padding:42px;background:linear-gradient(135deg,#092c4c,#135f8c);color:#fff}.brand{font-size:14px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#81d4fa}.cover h1{font-size:38px;margin:8px 0}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:28px}.stat{padding:18px;background:#ffffff18;border:1px solid #ffffff35;border-radius:12px}.stat strong{display:block;font-size:29px}.stat span{font-size:12px}.report-card header{display:flex;justify-content:space-between;gap:20px;padding:28px 32px;background:#f8fbfd;border-bottom:1px solid #d9e2ec}.eyebrow{font-size:11px;font-weight:800;letter-spacing:.15em;text-transform:uppercase;color:#0d6a9b}.report-card h2{font-size:27px;margin:5px 0}.report-card p{margin:0;color:#52606d}.score{min-width:130px;padding:13px;text-align:center;border-radius:12px;font-size:30px;font-weight:800}.score small{display:block;font-size:11px}.score.pass{color:#087f5b;background:#d3f9d8}.score.attention{color:#a61e4d;background:#fff0f6}.warning{margin:20px 32px!important;padding:12px;background:#fff3bf;color:#7c4a03!important;border-radius:8px}table{width:calc(100% - 64px);margin:24px 32px;border-collapse:collapse}th,td{text-align:left;padding:12px;border-bottom:1px solid #e6edf3}th{font-size:11px;text-transform:uppercase;color:#627d98}.pill{display:inline-block;padding:4px 9px;border-radius:999px;font-size:11px;font-weight:700}.passed{background:#d3f9d8;color:#087f5b}.pending{background:#e9ecef;color:#495057}.report-card footer{padding:16px 32px;background:#f8fbfd;color:#627d98;font-size:11px}@media(max-width:700px){.stats{grid-template-columns:1fr 1fr}.report-card header{display:block}.score{margin-top:14px}table{font-size:12px}}@media print{@page{size:A4;margin:12mm}body{background:#fff}.cover,.report-card{box-shadow:none;margin:0;border-radius:0;max-width:none}.cover{break-after:page}.report-card{break-after:page;border:1px solid #aaa}a{color:inherit;text-decoration:none}}
</style></head><body><section class="cover"><div class="brand">High Q Solid Academy</div><h1>Instructor Gradebook</h1><p>Digital record and print-ready learner report cards · ${escapeHtml(generated)}</p><div class="stats"><div class="stat"><strong>${learners.size}</strong><span>Learners</span></div><div class="stat"><strong>${data.rows.length}</strong><span>Course repositories</span></div><div class="stat"><strong>${average}%</strong><span>Overall average</span></div><div class="stat"><strong>${passed}</strong><span>Passed courses</span></div></div></section>${reportCards || '<section class="report-card"><header><h2>No learners found</h2></header></section>'}</body></html>`;

fs.writeFileSync(path.join(root, 'gradebook.html'), html);
console.log(`Created print-ready gradebook.html for ${learners.size} learner(s).`);
