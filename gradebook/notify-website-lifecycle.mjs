// Runs ONLY after successful GitHub learner-state changes; never from a dispatch response.
// The GO54 endpoint verifies the private learner history and sends styled email via its SMTP.
const endpoint = process.env.HIGHQ_LEARN_LIFECYCLE_ENDPOINT ||
  'https://admin.highqsolidacademy.com/api/learning-lifecycle-complete.php';
const token = String(process.env.HIGHQ_LEARN_LIFECYCLE_TOKEN || '').trim();
const action = String(process.env.LEARNER_LIFECYCLE_ACTION || '').trim().toLowerCase();
const usernames = [...new Set(String(process.env.STUDENT_USERNAMES || process.env.STUDENT_USERNAME || '')
  .split(/[\s,;]+/).map(s => s.trim()).filter(Boolean))];
const runId = String(process.env.GITHUB_RUN_ID || '');
const summary = process.env.GITHUB_STEP_SUMMARY || '';
if (!['paused','resumed'].includes(action) || !/^[1-9][0-9]{4,24}$/.test(runId) ||
    usernames.length === 0 || usernames.length > 50 ||
    usernames.some(u => !/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(u))) {
  throw Error('Invalid learner lifecycle completion details; notification not sent.');
}
if (token.length < 32) throw Error('Missing HIGHQ_LEARN_LIFECYCLE_TOKEN. Learner state changed but email notification is not configured.');
const body = JSON.stringify({repository:'High-Q-Solid-Academy/.github',run_id:runId,action,usernames});
let result;
let lastError;
for (let attempt = 1; attempt <= 2; attempt++) {
  try {
    const resp = await fetch(endpoint, {
      method:'POST',
      headers:{'Authorization': 'Bearer '+token, 'Content-Type':'application/json','Accept':'application/json'},
      body,
      signal:AbortSignal.timeout(30000),
    });
    const txt = await resp.text();
    let parsed;
    try { parsed = JSON.parse(txt); } catch { parsed = {status:'invalid_server_response'}; }
    if (resp.status !== 200) {
      // 207 means a mail or verification issue even if some learners were sent.
      throw Error('GO54 lifecycle notification returned HTTP '+resp.status+
        ' ('+String(parsed.status||'unknown')+'). Inspect GO54 mail and learner contact records.');
    }
    result = parsed; break;
  } catch (error) {
    lastError = error;
    if (attempt < 2) await new Promise(r=>setTimeout(r,1500));
  }
}
if (summary) {
  const fs = await import('node:fs/promises');
  await fs.appendFile(summary,
    '\n### HIGH-Q learner status notification\n'+
    (result ? '- Verified by GO54: '+(result.results?.sent?.length||0)+' email(s) handed to SMTP.\n'
      : '- ⚠️ Notification failed, but the learner-state operation is NOT rolled back.\n')+
    '- Check the private learner email ledger before retrying; never rerun disenrollment for an email failure.\n');
}
if (!result) throw lastError || Error('Learner email notification failed.');
console.log('GO54 accepted '+(result.results?.sent?.length||0)+' lifecycle email(s); '+
  (result.results?.already_sent?.length||0)+' already notified.');
