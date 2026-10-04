import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  api,
  repoApi,
  repositoryFullName,
  token,
} from './curriculum-api.mjs';
import {
  matchCourse,
  repositoryEnrollment,
} from './inactivity-lib.mjs';
import { listManagedRepositories } from './managed-repositories.mjs';

if (!token) throw new Error('CURRICULUM_ADMIN_TOKEN is required.');

const username = String(process.env.STUDENT_USERNAME || '').trim();
const courseId = String(process.env.COURSE_ID || '').trim();
const feedback = String(process.env.REVIEW_FEEDBACK || '').trim();
const reviewer = process.env.GITHUB_ACTOR || 'academy-instructor';
const criteria = [
  ['Functionality and completeness', process.env.SCORE_FUNCTIONALITY],
  ['Code quality and architecture', process.env.SCORE_CODE_QUALITY],
  ['User experience or API design', process.env.SCORE_UX_API],
  ['Security, validation and reliability', process.env.SCORE_SECURITY],
  ['Documentation and deployment quality', process.env.SCORE_DOCUMENTATION],
].map(([name, value]) => [name, Number(value)]);

if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(username))
  throw new Error('Invalid GitHub username.');
if (feedback.length < 30)
  throw new Error('Review feedback must contain at least 30 characters.');
for (const [name, score] of criteria) {
  if (!Number.isInteger(score) || score < 0 || score > 20)
    throw new Error(`${name} must be a whole number from 0 to 20.`);
}

const curriculum = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, 'courses.json'), 'utf8'),
);
const course = curriculum.courses.find(
  (item) => item.id === courseId && item.humanReviewRequired,
);
if (!course)
  throw new Error('COURSE_ID must identify a configured human-review milestone.');

const user = await api(`/users/${username}`);
const repositories = await listManagedRepositories({ includeInactive: true });
let learnerRepository = null;
for (const repository of repositories) {
  const definition = matchCourse(repository, curriculum.courses);
  if (definition?.id !== course.id) continue;
  try {
    const enrollment = await repositoryEnrollment(repository, definition);
    if (Number(enrollment.githubId) === Number(user.id)) {
      learnerRepository = repository;
      break;
    }
  } catch (error) {
    console.warn(`Could not inspect ${repositoryFullName(repository)}: ${error.message}`);
  }
}
if (!learnerRepository)
  throw new Error(`No ${course.course} learner repository was found for @${user.login}.`);

const issues = await repoApi(
  learnerRepository,
  '/issues?state=open&per_page=100&sort=created&direction=desc',
);
const issue = issues.find(
  (item) =>
    !item.pull_request &&
    item.title.startsWith(`[Capstone submission: ${course.id}]`),
);
if (!issue)
  throw new Error(
    `No open ${course.course} capstone submission issue was found. Ask the learner to run Submit capstone for human review first.`,
  );

const score = criteria.reduce((total, [, value]) => total + value, 0);
const passScore = course.humanPassScore || 70;
const passed = score >= passScore;
const commit = await repoApi(
  learnerRepository,
  `/commits/${encodeURIComponent(learnerRepository.default_branch)}`,
);
const rubricRows = criteria
  .map(([name, value]) => `| ${name} | ${value}/20 |`)
  .join('\n');
const comment = `## Human capstone review\n\n| Criterion | Score |\n| --- | ---: |\n${rubricRows}\n| **Total** | **${score}/100** |\n\n**Result:** ${passed ? 'PASS' : 'REVISION REQUIRED'}  \n**Reviewer:** @${reviewer}\n\n### Feedback\n\n${feedback.slice(0, 6000)}\n\n${passed ? 'The human-review gate is complete. The progression workflow may now unlock the next course after confirming the automated course score.' : 'Improve the project, redeploy it and submit a new review request when the listed problems are corrected.'}`;

await repoApi(
  learnerRepository,
  `/issues/${issue.number}/comments`,
  {
    method: 'POST',
    body: JSON.stringify({ body: comment }),
  },
);
await repoApi(
  learnerRepository,
  `/statuses/${commit.sha}`,
  {
    method: 'POST',
    body: JSON.stringify({
      state: passed ? 'success' : 'failure',
      target_url: issue.html_url,
      description: `Human capstone score: ${score}/100`,
      context: 'highq/human-capstone',
    }),
  },
);
if (passed) {
  await repoApi(
    learnerRepository,
    `/issues/${issue.number}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ state: 'closed', state_reason: 'completed' }),
    },
  );
}

const summary = `# Human capstone review recorded\n\n**${course.course}** · **@${user.login}** · **${score}/100** · **${passed ? 'PASS' : 'REVISION REQUIRED'}**\n\n- Learner repository: ${learnerRepository.html_url}\n- Repository ownership: ${learnerRepository?._highq?.ownership === 'learner' ? 'Learner-owned' : 'Academy-owned'}\n- Submission and feedback: ${issue.html_url}\n- Reviewer: @${reviewer}\n`;
if (process.env.GITHUB_STEP_SUMMARY)
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
console.log(summary);
