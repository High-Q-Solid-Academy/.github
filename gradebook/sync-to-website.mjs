// Trusted Academy gradebook workflow -> HIGH-Q website. Not learner controlled.
import fs from 'node:fs';
import process from 'node:process';
const endpoint = String(process.env.HIGHQ_GRADE_SYNC_URL || '');
const token = String(process.env.HIGHQ_GRADE_SYNC_SECRET || '');
if (!endpoint || !token) {
  console.log('HIGH-Q website grade sync not configured; skipped (no changes).');
  process.exit(0);
}
if (token.length < 32) throw new Error('HIGHQ_GRADE_SYNC_SECRET must be at least 32 characters');
const url = new URL(endpoint);
if (url.protocol !== 'https:' || url.hostname !== 'highqsolidacademy.com') {
  throw new Error('Grade sync requires the official HIGH-Q HTTPS host');
}
const gradebook = JSON.parse(fs.readFileSync('gradebook.json', 'utf8'));
let success = 0, skipped = 0;
for (const row of gradebook.rows || []) {
  if (row.identityState !== 'verified' ||
      !Number.isSafeInteger(Number(row.githubId)) || Number(row.githubId) < 1 ||
      !row.courseId || !row.repository || !row.headSha) {
    skipped += 1;
    continue;
  }
  const payload = {
    github_id: Number(row.githubId),
    github_repository_id: row.repositoryId ? Number(row.repositoryId) : null,
    github_login: row.student,
    real_name: row.realName,
    track: row.track,
    learner_status: row.activityState === 'paused' ? 'paused' : 'active',
    enrollment_version: row.ownership === 'learner' ? 'v2' : 'v1',
    course_id: row.courseId,
    repository_full_name: row.repository,
    head_sha: row.headSha,
    grade_context: row.automatedContext || '',
    grade_state: row.state || 'pending',
    grade_score: row.score,
    human_required: Boolean(row.humanReviewRequired),
    human_state: row.humanState,
    human_score: row.humanScore,
  };
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error('HIGH-Q grade sync refused ' + row.courseId + ': HTTP ' + response.status);
  success += 1;
}
console.log('HIGH-Q website grade sync: ' + success + ' synchronized, ' + skipped + ' skipped for unverified evidence.');
