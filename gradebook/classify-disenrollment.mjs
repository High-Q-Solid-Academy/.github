import fs from 'node:fs';
import process from 'node:process';
import { listLearnerRegistryRecords } from './learner-registry.mjs';

const raw = String(process.env.STUDENT_USERNAMES || '').trim();
const usernames = [...new Set(
  raw.split(/[\s,;]+/).map((value) => value.trim()).filter(Boolean),
)];
if (!usernames.length) throw new Error('No selected learners were supplied.');

const records = await listLearnerRegistryRecords({ includeInactive: true });
const byLogin = new Map();
for (const record of records) {
  for (const login of [record.githubLogin, record.githubLoginAtEnrollment].filter(Boolean)) {
    byLogin.set(String(login).toLowerCase(), record);
  }
}

const learnerOwned = [];
const legacy = [];
for (const username of usernames) {
  const record = byLogin.get(username.toLowerCase());
  if (record?.ownership === 'learner' && record.status === 'active') {
    learnerOwned.push(username);
  } else {
    legacy.push(username);
  }
}

const output = process.env.GITHUB_OUTPUT;
if (!output) throw new Error('GITHUB_OUTPUT is required.');
fs.appendFileSync(output, `learner_owned=${learnerOwned.join(' ')}\n`);
fs.appendFileSync(output, `legacy=${legacy.join(' ')}\n`);

console.log(`Learner-owned selections: ${learnerOwned.join(', ') || 'none'}`);
console.log(`Legacy academy-owned selections: ${legacy.join(', ') || 'none'}`);
