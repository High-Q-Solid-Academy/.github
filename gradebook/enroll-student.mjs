import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { api, organization, provisionCourse, token, writeEnrollment } from './curriculum-api.mjs';
import { assertRealNameMatches, buildEnrollment, decodeEnrollment, DEFAULT_TRACK, enrollmentPath, enrollmentTrack, normalizeTrack } from './identity.mjs';

if (!token) {
  console.error('CURRICULUM_ADMIN_TOKEN is required.');
  process.exit(1);
}

const student = String(process.env.STUDENT_USERNAME || '').trim();
const realName = String(process.env.REAL_NAME || '').trim();
const track = normalizeTrack(process.env.STUDENT_TRACK, DEFAULT_TRACK);
if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(student)) {
  console.error('STUDENT_USERNAME must be a valid GitHub username.');
  process.exit(1);
}

const curriculum = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'courses.json'), 'utf8'));
const trackDefinition = curriculum.tracks?.[track];
if (!trackDefinition?.courses?.length) throw new Error(`Programme ${track} is not configured.`);
const courseById = new Map(curriculum.courses.map((course) => [course.id, course]));
const first = courseById.get(trackDefinition.courses[0]);
if (!first) throw new Error(`First course ${trackDefinition.courses[0]} is missing from course definitions.`);

const user = await api(`/users/${student}`);
assertRealNameMatches(realName, user.name);
const enrollment = buildEnrollment(user, realName, track);
const firstRepository = `${first.repositoryPrefix}${user.login}`;

try {
  const repository = await api(`/repos/${organization}/${firstRepository}`);
  try {
    const file = await api(`/repos/${organization}/${repository.name}/contents/${enrollmentPath()}?ref=${repository.default_branch}`);
    const existing = decodeEnrollment(file.content);
    const existingTrack = enrollmentTrack(existing);
    if (existingTrack !== track) {
      throw new Error(`@${user.login} is already enrolled in ${existingTrack}. Programme changes must be handled explicitly; enrollment will not switch tracks automatically.`);
    }
  } catch (error) {
    if (error.status !== 404) throw error;
    if (track !== DEFAULT_TRACK) {
      throw new Error(`@${user.login} already has a legacy Git course repository with no programme record. Legacy enrollments default to Computer Science; migrate the learner explicitly before assigning Computer Engineering.`);
    }
    await writeEnrollment(repository.name, enrollment, repository.default_branch);
  }
  console.log(`@${user.login} is already enrolled in ${trackDefinition.name}; Git foundations repository already exists.`);
} catch (error) {
  if (error.status !== 404) throw error;
  const result = await provisionCourse(first, user.login, true, enrollment);
  console.log(`Enrolled ${realName} (@${user.login}, GitHub ID ${user.id}) in ${trackDefinition.name}: ${result.repository}. The collaborator invitation may need acceptance.`);
}
