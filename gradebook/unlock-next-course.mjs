import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { api, listRepositories, organization, provisionCourse, token } from './curriculum-api.mjs';
import { buildEnrollment, decodeEnrollment, enrollmentPath, enrollmentTrack } from './identity.mjs';

if (!token) {
  console.error('CURRICULUM_ADMIN_TOKEN is required.');
  process.exit(1);
}

const apply = process.env.APPLY_UNLOCKS === 'true';
const curriculum = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'courses.json'), 'utf8'));
const courses = curriculum.courses;
const courseById = new Map(courses.map((course) => [course.id, course]));
const repositories = await listRepositories();
const repositoryNames = new Set(repositories.map((repository) => repository.name));
const results = [];

for (const repository of repositories) {
  const current = courses.find((course) => repository.name.startsWith(course.repositoryPrefix) && repository.name.length > course.repositoryPrefix.length);
  if (!current) continue;

  const repositoryStudent = repository.name.slice(current.repositoryPrefix.length);
  if (!repositoryStudent) continue;

  let enrollment;
  try {
    const file = await api(`/repos/${organization}/${repository.name}/contents/${enrollmentPath()}?ref=${repository.default_branch}`);
    enrollment = decodeEnrollment(file.content);
  } catch (error) {
    if (error.status !== 404) throw error;
    const legacyUser = await api(`/users/${repositoryStudent}`);
    enrollment = buildEnrollment(legacyUser, legacyUser.name || legacyUser.login);
  }

  const track = enrollmentTrack(enrollment);
  const trackDefinition = curriculum.tracks?.[track];
  if (!trackDefinition) {
    results.push({ student: repositoryStudent, realName: enrollment.realName, track, passed: current.course, score: null, humanScore: null, unlocked: 'none', action: 'invalid-track', protection: 'not applicable' });
    continue;
  }

  const index = trackDefinition.courses.indexOf(current.id);
  if (index < 0 || index >= trackDefinition.courses.length - 1) continue;
  const nextId = trackDefinition.courses[index + 1];
  const next = courseById.get(nextId);
  if (!next) throw new Error(`Track ${track} references missing course ${nextId}.`);

  const currentUser = await api(`/user/${enrollment.githubId}`);
  const student = currentUser.login;
  if (repositoryNames.has(`${next.repositoryPrefix}${student}`)) continue;

  const combined = await api(`/repos/${organization}/${repository.name}/commits/${repository.default_branch}/status`);
  const grade = combined.statuses.find((status) => status.context === 'highq/autograding');
  const score = Number(grade?.description?.match(/(\d+)\s*\/\s*100/)?.[1] ?? -1);
  if (grade?.state !== 'success' || score < current.passScore) continue;

  let humanScore = null;
  if (current.humanReviewRequired) {
    const humanReview = combined.statuses.find((status) => status.context === 'highq/human-capstone');
    humanScore = Number(humanReview?.description?.match(/(\d+)\s*\/\s*100/)?.[1] ?? -1);
    if (humanReview?.state !== 'success' || humanScore < (current.humanPassScore || 70)) {
      results.push({
        student,
        realName: enrollment.realName,
        track,
        passed: current.course,
        score,
        humanScore: humanScore >= 0 ? humanScore : null,
        unlocked: next.course,
        action: 'waiting-for-human-review',
        protection: 'not applicable'
      });
      continue;
    }
  }

  const normalizedEnrollment = { ...enrollment, schemaVersion: 2, track };
  const outcome = await provisionCourse(next, student, apply, normalizedEnrollment);
  results.push({ student, realName: enrollment.realName, track, passed: current.course, score, humanScore, unlocked: next.course, ...outcome });
  repositoryNames.add(outcome.repository);
}

const lines = results.map((item) => `| ${item.realName} (@${item.student}) | ${item.track} | ${item.passed} | ${item.score === null ? '—' : `${item.score}/100`} | ${item.humanScore === null ? 'not required or pending' : `${item.humanScore}/100`} | ${item.unlocked} | ${item.action} | ${item.protection || 'not applicable'} |`).join('\n');
const summary = `# Curriculum progression\n\nMode: **${apply ? 'APPLY' : 'DRY RUN'}** · Organization: **${organization}**\n\n| Learner | Programme | Passed | Auto score | Human capstone | Next course | Result | Main protection |\n| --- | --- | --- | ---: | ---: | --- | --- | --- |\n${lines || '| — | — | No new qualifying learners | — | — | — | no change | — |'}\n`;
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
console.log(summary);
