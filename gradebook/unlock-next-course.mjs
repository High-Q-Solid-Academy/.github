import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { api, listRepositories, organization, provisionCourse, token } from './curriculum-api.mjs';
import { buildEnrollment, decodeEnrollment, enrollmentPath } from './identity.mjs';

if (!token) {
  console.error('CURRICULUM_ADMIN_TOKEN is required.');
  process.exit(1);
}

const apply = process.env.APPLY_UNLOCKS === 'true';
const courses = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'courses.json'), 'utf8')).sort((a, b) => a.order - b.order);
const repositories = await listRepositories();
const repositoryNames = new Set(repositories.map((repository) => repository.name));
const results = [];

for (let index = 0; index < courses.length - 1; index += 1) {
  const current = courses[index];
  const next = courses[index + 1];
  const studentRepositories = repositories.filter((repository) => repository.name.startsWith(current.repositoryPrefix));

  for (const repository of studentRepositories) {
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

    const outcome = await provisionCourse(next, student, apply, enrollment);
    results.push({ student, realName: enrollment.realName, passed: current.course, score, humanScore, unlocked: next.course, ...outcome });
    repositoryNames.add(outcome.repository);
  }
}

const lines = results.map((item) => `| ${item.realName} (@${item.student}) | ${item.passed} | ${item.score}/100 | ${item.humanScore === null ? 'not required or pending' : `${item.humanScore}/100`} | ${item.unlocked} | ${item.action} | ${item.protection || 'not applicable'} |`).join('\n');
const summary = `# Curriculum progression

Mode: **${apply ? 'APPLY' : 'DRY RUN'}** · Organization: **${organization}**

| Learner | Passed | Auto score | Human capstone | Next course | Result | Main protection |
| --- | --- | ---: | ---: | --- | --- | --- |
${lines || '| — | No new qualifying learners | — | — | — | no change | — |'}
`;
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
console.log(summary);
