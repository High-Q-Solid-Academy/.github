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

function parseRecord(body = '') {
  const record = {};
  for (const line of String(body).split(/\r?\n/)) {
    const match = line.match(/^([a-z_]+):\s*(.+)$/i);
    if (match) record[match[1].toLowerCase()] = match[2].trim();
  }
  return record;
}

// A learner removed for inactivity resumes from the deleted current course instead of restarting the programme.
let target = first;
let resumeRecord = null;
try {
  const issues = await api(`/repos/${organization}/.github/issues?state=closed&sort=updated&direction=desc&per_page=100`);
  for (const issue of issues) {
    const body = String(issue.body || '');
    if (!body.includes('<!-- highq-disenrollment-record -->')) continue;
    const record = parseRecord(body);
    if (String(record.github_id || '') !== String(user.id)) continue;
    if (record.track !== track || record.status !== 'deleted') continue;
    const course = courseById.get(record.resume_course_id);
    if (!course || !trackDefinition.courses.includes(course.id)) continue;
    target = course;
    resumeRecord = { issue, record };
    break;
  }
} catch (error) {
  if (![404, 410].includes(error.status)) throw error;
}

const targetRepository = `${target.repositoryPrefix}${user.login}`;

try {
  const repository = await api(`/repos/${organization}/${targetRepository}`);
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
      throw new Error(`@${user.login} already has a legacy learner repository with no programme record. Migrate the learner explicitly before assigning Computer Engineering.`);
    }
    await writeEnrollment(repository.name, enrollment, repository.default_branch);
  }
  console.log(`@${user.login} is already enrolled in ${trackDefinition.name}; ${target.course} repository already exists.`);
} catch (error) {
  if (error.status !== 404) throw error;
  const result = await provisionCourse(target, user.login, true, enrollment);
  const mode = resumeRecord ? `Re-enrolled at ${target.course} after inactivity disenrollment` : `Enrolled in ${trackDefinition.name}`;
  console.log(`${mode}: ${realName} (@${user.login}, GitHub ID ${user.id}) -> ${result.repository}. The collaborator invitation may need acceptance.`);

  if (resumeRecord) {
    await api(`/repos/${organization}/.github/issues/${resumeRecord.issue.number}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: `@${user.login} was re-enrolled on ${new Date().toISOString()} and resumed at **${target.course}** (${result.repository}). Earlier completed courses were not reset.` })
    });
  }
}
