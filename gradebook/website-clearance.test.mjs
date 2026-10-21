import test from 'node:test';
import assert from 'node:assert/strict';
import { websiteClearance, websiteConfirmEnrollment } from './website-clearance.mjs';

const query = { githubId: 1234, courseId: 'git', targetCourseId: 'html', track: 'computer-science' };
const env = { HIGHQ_PROGRESS_API_TOKEN: 'testing_'.padEnd(40,'a') };
const previous = globalThis.fetch;
test('missing credential always fails closed', async () => {
  await assert.rejects(websiteClearance(query, {}), /TOKEN missing/);
});
test('must only contact official HTTPS host', async () => {
  await assert.rejects(websiteClearance(query, { ...env, HIGHQ_CERT_GATE_URL:'http://example.org/' }), /official HIGH-Q/);
});
test('site denial blocks provisioning', async () => {
  globalThis.fetch = async () => ({ ok:true, status:200, json:async () => ({ eligible:false, reason:'not_eligible' }) });
  try { assert.equal(await websiteClearance(query, env), false); }
  finally { globalThis.fetch = previous; }
});
test('site failure blocks provisioning', async () => {
  globalThis.fetch = async () => ({ ok:false, status:503 });
  try { await assert.rejects(websiteClearance(query, env), /clearance unavailable/); }
  finally { globalThis.fetch = previous; }
});
test('only explicit authorisation permits provisioning', async () => {
  globalThis.fetch = async (url, opts) => {
    assert.equal(url.searchParams.get('course_id'), 'git');
    assert.equal(url.searchParams.get('target_course_id'), 'html');
    assert.equal(opts.headers.Authorization, 'Bearer ' + env.HIGHQ_PROGRESS_API_TOKEN);
    return { ok:true, status:200, json:async () => ({ eligible:true, reason:'authorized_for_provisioning' }) };
  };
  try { assert.equal(await websiteClearance(query, env), true); }
  finally { globalThis.fetch = previous; }
});
test('enrollment completion requires official Learn host', async () => {
  await assert.rejects(websiteConfirmEnrollment({}, { ...env, HIGHQ_ENROLLMENT_COMPLETE_URL:'https://example.org/' }), /official HIGH-Q Learn/);
});
test('enrollment completion accepts only confirmed email delivery', async () => {
  globalThis.fetch = async (url, opts) => {
    assert.equal(url.hostname, 'learn.highqsolidacademy.com');
    assert.equal(opts.method, 'POST');
    assert.equal(opts.headers.Authorization, 'Bearer ' + env.HIGHQ_PROGRESS_API_TOKEN);
    return { ok:true, status:200, json:async () => ({ status:'sent' }) };
  };
  try { assert.equal(await websiteConfirmEnrollment({github_id:1234}, env), 'sent'); }
  finally { globalThis.fetch = previous; }
});
