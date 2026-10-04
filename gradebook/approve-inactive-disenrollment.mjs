import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { api, listRepositories, organization, token } from './curriculum-api.mjs';
import { decodeEnrollment, enrollmentPath, enrollmentTrack } from './identity.mjs';

if (!token) throw new Error('CURRICULUM_ADMIN_TOKEN is required.');

const repositoryName = String(process.env.COURSE_REPOSITORY || '').trim();
const confirmation = String(process.env.DISENROLL_CONFIRMATION || '').trim();
const instructor = String(process.env.CURRICULUM_INSTRUCTOR_LOGIN || 'MAVIS-creator').trim();
const REVIEW_MARKER = '<!-- highq-inactivity-review -->';
const RECORD_MARKER = '<!-- highq-disenrollment-record -->';

if (!repositoryName || repositoryName.includes('/') || !/^[A-Za-z0-9_.-]+$/.test(repositoryName)) {
  throw new Error('COURSE_REPOSITORY must be the exact learner repository name, without owner.');
}
if (confirmation !== `DISENROLL ${repositoryName}`) {
  throw new Error(`Confirmation mismatch. Enter exactly: DISENROLL ${repositoryName}`);
}

const curriculum = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'courses.json'), 'utf8'));
const course = curriculum.courses.find((item) => repositoryName.startsWith(item.repositoryPrefix) && repositoryName.length > item.repositoryPrefix.length);
if (!course) throw new Error(`${repositoryName} does not match a configured learner-course repository prefix.`);

const repository = await api(`/repos/${organization}/${repositoryName}`);
let enrollment;
try {
  const file = await api(`/repos/${organization}/${repositoryName}/contents/${enrollmentPath()}?ref=${repository.default_branch}`);
  enrollment = decodeEnrollment(file.content);
} catch (error) {
  if (error.status !== 404) throw error;
  throw new Error('No enrollment record was found. Legacy/ambiguous repositories must be reviewed manually and migrated before deletion.');
}

const track = enrollmentTrack(enrollment);
const learner = enrollment.githubId
  ? (await api(`/user/${enrollment.githubId}`)).login
  : enrollment.githubLoginAtEnrollment;
if (!learner) throw new Error('Could not resolve learner identity.');
if (learner.toLowerCase() === instructor.toLowerCase()) throw new Error('Instructor/admin repositories are protected from inactivity deletion.');

const trackDefinition = curriculum.tracks?.[track];
if (!trackDefinition) throw new Error(`Unknown learner track: ${track}`);
const currentIndex = trackDefinition.courses.indexOf(course.id);
if (currentIndex < 0) throw new Error(`${course.id} is not part of learner track ${track}.`);

// Ensure this is the learner's current/highest course, never a completed earlier repository.
const repositories = await listRepositories();
for (let index = currentIndex + 1; index < trackDefinition.courses.length; index += 1) {
  const laterId = trackDefinition.courses[index];
  const later = curriculum.courses.find((item) => item.id === laterId);
  if (!later) continue;
  if (repositories.some((item) => item.name === `${later.repositoryPrefix}${learner}`)) {
    throw new Error(`Refusing deletion: learner already has later course ${laterId}. ${repositoryName} is not the current course.`);
  }
}

// Never delete a repository whose automated completion gate is already passed.
try {
  const combined = await api(`/repos/${organization}/${repositoryName}/commits/${repository.default_branch}/status`);
  const grade = combined.statuses?.find((status) => status.context === 'highq/autograding');
  const score = Number(grade?.description?.match(/(\d+)\s*\/\s*100/)?.[1] ?? -1);
  if (grade?.state === 'success' && score >= Number(course.passScore || 70)) {
    throw new Error(`Refusing deletion: ${repositoryName} already has a passing automated grade (${score}/100).`);
  }
} catch (error) {
  if (String(error.message || '').startsWith('Refusing deletion:')) throw error;
  if (![404, 409].includes(error.status)) throw error;
}

const reviewIssues = await api(`/repos/${organization}/.github/issues?state=open&per_page=100`);
const review = reviewIssues.find((issue) =>
  !issue.pull_request &&
  String(issue.body || '').includes(REVIEW_MARKER) &&
  String(issue.body || '').includes(`repository: ${repositoryName}`) &&
  String(issue.body || '').includes('status: awaiting-instructor-approval')
);
if (!review) throw new Error('No open inactivity review at the manual approval gate exists for this repository.');

const eligibleLine = String(review.body || '').split(/\r?\n/).find((line) => line.startsWith('eligible_after:'));
const eligibleAfter = eligibleLine ? new Date(eligibleLine.slice('eligible_after:'.length).trim()) : null;
if (!eligibleAfter || Number.isNaN(eligibleAfter.getTime())) throw new Error('Review issue has no valid eligible_after timestamp.');
if (Date.now() < eligibleAfter.getTime()) throw new Error(`Grace period is still active until ${eligibleAfter.toISOString()}.`);

const warningLine = String(review.body || '').split(/\r?\n/).find((line) => line.startsWith('warning_issue:'));
const warningNumber = Number(warningLine?.slice('warning_issue:'.length).trim() || 0);
if (warningNumber > 0) {
  await api(`/repos/${organization}/${repositoryName}/issues/${warningNumber}/comments`, {
    method: 'POST',
    body: JSON.stringify({
      body: `@${learner} the instructor has approved disenrollment after the inactivity warning and grace period. This current unfinished course repository will now be removed. Your completed earlier courses remain unchanged. If you return later, High-Q can re-enroll you at **${course.course}** rather than restarting your programme.`
    })
  });
}

const approvedAt = new Date().toISOString();
const baseRecord = `${RECORD_MARKER}\n\nrepository: ${repositoryName}\nlearner: ${learner}\ngithub_id: ${enrollment.githubId}\ntrack: ${track}\nresume_course_id: ${course.id}\napproved_by: ${instructor}\napproved_at: ${approvedAt}`;

await api(`/repos/${organization}/.github/issues/${review.number}`, {
  method: 'PATCH',
  body: JSON.stringify({
    body: `${baseRecord}\nstatus: approved-pending-delete\n\nThe learner's completed prior-course repositories are intentionally preserved.`
  })
});

try {
  await api(`/repos/${organization}/${repositoryName}`, { method: 'DELETE' });
} catch (error) {
  await api(`/repos/${organization}/.github/issues/${review.number}`, {
    method: 'PATCH',
    body: JSON.stringify({
      body: `${baseRecord}\nstatus: deletion-failed\nerror: ${String(error.message || error).replace(/\n/g, ' ')}`
    })
  });
  throw error;
}

const deletedAt = new Date().toISOString();
await api(`/repos/${organization}/.github/issues/${review.number}`, {
  method: 'PATCH',
  body: JSON.stringify({
    state: 'closed',
    state_reason: 'completed',
    body: `${baseRecord}\ndeleted_at: ${deletedAt}\nstatus: deleted\n\nRe-enrollment target: ${course.id}. Completed prior-course repositories were not removed.`
  })
});

console.log(`Disenrolled @${learner} from ${course.id}; deleted ${repositoryName}. Prior course repositories were preserved. Re-enrollment should resume at ${course.id}.`);
