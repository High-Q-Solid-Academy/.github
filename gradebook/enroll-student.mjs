import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { api, organization, provisionCourse, token } from './curriculum-api.mjs';
import { assertRealNameMatches, buildEnrollment } from './identity.mjs';

if (!token) {
  console.error('CURRICULUM_ADMIN_TOKEN is required.');
  process.exit(1);
}

const student = String(process.env.STUDENT_USERNAME || '').trim();
const realName = String(process.env.REAL_NAME || '').trim();
if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(student)) {
  console.error('STUDENT_USERNAME must be a valid GitHub username.');
  process.exit(1);
}

const user = await api(`/users/${student}`);
assertRealNameMatches(realName, user.name);
const enrollment = buildEnrollment(user, realName);
const courses = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'courses.json'), 'utf8')).sort((a, b) => a.order - b.order);
const first = courses[0];
try {
  await api(`/repos/${organization}/${first.repositoryPrefix}${student}`);
  console.log(`@${student} is already enrolled in ${first.course}.`);
} catch (error) {
  if (error.status !== 404) throw error;
  const result = await provisionCourse(first, user.login, true, enrollment);
  console.log(`Enrolled ${realName} (@${user.login}, GitHub ID ${user.id}): ${result.repository}. The collaborator invitation may need acceptance.`);
}
