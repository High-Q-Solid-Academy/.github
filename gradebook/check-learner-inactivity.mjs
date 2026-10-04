import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { api, listRepositories, organization, token } from './curriculum-api.mjs';
import { decodeEnrollment, enrollmentPath, enrollmentTrack } from './identity.mjs';

if (!token) throw new Error('CURRICULUM_ADMIN_TOKEN is required.');

const INACTIVITY_DAYS = Number(process.env.INACTIVITY_DAYS || 4);
const GRACE_DAYS = Number(process.env.INACTIVITY_GRACE_DAYS || 1);
const INSTRUCTOR = String(process.env.CURRICULUM_INSTRUCTOR_LOGIN || 'MAVIS-creator').toLowerCase();
const WARNING_MARKER = '<!-- highq-inactivity-warning -->';
const REVIEW_MARKER = '<!-- highq-inactivity-review -->';
const DAY_MS = 24 * 60 * 60 * 1000;
const now = new Date();

const curriculum = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'courses.json'), 'utf8'));
const courseById = new Map(curriculum.courses.map((course) => [course.id, course]));
const repositories = await listRepositories();
const candidates = [];

function courseForRepo(name) {
  return curriculum.courses.find((course) => name.startsWith(course.repositoryPrefix) && name.length > course.repositoryPrefix.length) || null;
}

async function readEnrollment(repository, course) {
  try {
    const file = await api(`/repos/${organization}/${repository.name}/contents/${enrollmentPath()}?ref=${repository.default_branch}`);
    return decodeEnrollment(file.content);
  } catch (error) {
    if (error.status !== 404) throw error;
    const login = repository.name.slice(course.repositoryPrefix.length);
    return {
      schemaVersion: 1,
      githubId: null,
      githubLoginAtEnrollment: login,
      track: 'computer-science',
      enrolledAt: repository.created_at,
      legacyInferred: true
    };
  }
}

async function currentLogin(enrollment) {
  if (enrollment.githubId) {
    try {
      const user = await api(`/user/${enrollment.githubId}`);
      if (user?.login) return user.login;
    } catch (error) {
      if (![404, 422].includes(error.status)) throw error;
    }
  }
  return enrollment.githubLoginAtEnrollment;
}

async function hasLearnerActivitySince(repository, learner, since) {
  const login = String(learner || '').toLowerCase();
  if (!login || login === INSTRUCTOR) return { active: false, reliable: true };
  const sinceMs = new Date(since).getTime();
  const qualifying = new Set(['PushEvent', 'CreateEvent', 'PullRequestEvent', 'PullRequestReviewEvent', 'IssuesEvent', 'IssueCommentEvent', 'CommitCommentEvent']);

  try {
    for (let page = 1; page <= 4; page += 1) {
      const events = await api(`/repos/${organization}/${repository.name}/events?per_page=100&page=${page}`);
      if (!events.length) return { active: false, reliable: true };
      let reachedOlder = false;
      for (const event of events) {
        const createdMs = new Date(event.created_at).getTime();
        if (createdMs < sinceMs) {
          reachedOlder = true;
          break;
        }
        if (qualifying.has(event.type) && String(event.actor?.login || '').toLowerCase() === login) {
          return { active: true, reliable: true, at: event.created_at, source: event.type };
        }
      }
      if (reachedOlder || events.length < 100) return { active: false, reliable: true };
    }
    return { active: false, reliable: false, reason: 'recent event history exceeded scan window' };
  } catch (error) {
    return { active: false, reliable: false, reason: `GitHub activity API failed (${error.status || 'unknown'})` };
  }
}

async function findOpenIssue(repoName, marker) {
  const issues = await api(`/repos/${organization}/${repoName}/issues?state=open&per_page=100`);
  return issues.find((issue) => !issue.pull_request && String(issue.body || '').includes(marker)) || null;
}

async function findCentralReview(repoName) {
  const issues = await api(`/repos/${organization}/.github/issues?state=open&per_page=100`);
  return issues.find((issue) => !issue.pull_request && String(issue.body || '').includes(REVIEW_MARKER) && String(issue.body || '').includes(`repository: ${repoName}`)) || null;
}

async function closeIssue(repoName, issue, comment) {
  if (!issue) return;
  await api(`/repos/${organization}/${repoName}/issues/${issue.number}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body: comment })
  });
  await api(`/repos/${organization}/${repoName}/issues/${issue.number}`, {
    method: 'PATCH',
    body: JSON.stringify({ state: 'closed', state_reason: 'not_planned' })
  });
}

for (const repository of repositories) {
  const course = courseForRepo(repository.name);
  if (!course) continue;
  const enrollment = await readEnrollment(repository, course);
  const learner = await currentLogin(enrollment);
  if (!learner || learner.toLowerCase() === INSTRUCTOR) continue;
  const track = enrollmentTrack(enrollment);
  const index = curriculum.tracks?.[track]?.courses?.indexOf(course.id) ?? -1;
  if (index < 0) continue;
  candidates.push({ repository, course, enrollment, learner, track, index });
}

const groups = new Map();
for (const item of candidates) {
  const key = `${item.enrollment.githubId || item.learner.toLowerCase()}:${item.track}`;
  const existing = groups.get(key);
  if (!existing || item.index > existing.index) groups.set(key, item);
}

for (const item of groups.values()) {
  const { repository, course, enrollment, learner, track } = item;

  // Do not flag a course that the learner has already passed or is waiting for human capstone review on.
  try {
    const combined = await api(`/repos/${organization}/${repository.name}/commits/${repository.default_branch}/status`);
    const grade = combined.statuses?.find((status) => status.context === 'highq/autograding');
    const score = Number(grade?.description?.match(/(\d+)\s*\/\s*100/)?.[1] ?? -1);
    if (grade?.state === 'success' && score >= Number(course.passScore || 70)) continue;
  } catch (error) {
    if (![404, 409].includes(error.status)) throw error;
  }

  const enrolledAt = new Date(enrollment.enrolledAt || repository.created_at);
  if ((now - enrolledAt) < INACTIVITY_DAYS * DAY_MS) continue;

  const warning = await findOpenIssue(repository.name, WARNING_MARKER);
  const centralReview = await findCentralReview(repository.name);

  if (warning) {
    const activityAfterWarning = await hasLearnerActivitySince(repository, learner, warning.created_at);
    if (!activityAfterWarning.reliable) {
      if (!centralReview) {
        await api(`/repos/${organization}/.github/issues`, {
          method: 'POST',
          body: JSON.stringify({
            title: `[Inactivity Review] ${repository.name} — activity attribution unclear`,
            body: `${REVIEW_MARKER}\n\n@${INSTRUCTOR} manual review required. GitHub activity attribution could not be verified safely, so no disenrollment recommendation was made.\n\nrepository: ${repository.name}\nlearner: ${learner}\ncourse_id: ${course.id}\ntrack: ${track}\nreason: ${activityAfterWarning.reason || 'unknown'}`
          })
        });
      }
      continue;
    }

    if (activityAfterWarning.active) {
      await closeIssue(repository.name, warning, `Activity from @${learner} was detected after this warning. The inactivity episode is cleared.`);
      if (centralReview) await closeIssue('.github', centralReview, `Learner activity resumed in ${repository.name}; no disenrollment action is required.`);
      continue;
    }

    if ((now - new Date(warning.created_at)) < GRACE_DAYS * DAY_MS) continue;

    if (!centralReview) {
      const eligibleAfter = new Date(new Date(warning.created_at).getTime() + GRACE_DAYS * DAY_MS).toISOString();
      await api(`/repos/${organization}/.github/issues`, {
        method: 'POST',
        body: JSON.stringify({
          title: `[Disenrollment Review] ${repository.name}`,
          body: `${REVIEW_MARKER}\n\n@${INSTRUCTOR} this learner has reached the manual review gate. **Nothing is deleted automatically.** Use the separate instructor approval workflow only after reviewing the case.\n\nrepository: ${repository.name}\nlearner: ${learner}\ngithub_id: ${enrollment.githubId || 'legacy-unknown'}\ncourse_id: ${course.id}\ntrack: ${track}\nwarning_issue: ${warning.number}\nwarning_at: ${warning.created_at}\neligible_after: ${eligibleAfter}\nstatus: awaiting-instructor-approval`
        })
      });
      await api(`/repos/${organization}/${repository.name}/issues/${warning.number}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body: `@${learner} the 1-day grace period has ended without qualifying learner activity. Your course is now awaiting instructor review. Your repository has **not** been deleted automatically.` })
      });
    }
    continue;
  }

  const cutoff = new Date(now.getTime() - INACTIVITY_DAYS * DAY_MS).toISOString();
  const activity = await hasLearnerActivitySince(repository, learner, cutoff);
  if (!activity.reliable) {
    if (!centralReview) {
      await api(`/repos/${organization}/.github/issues`, {
        method: 'POST',
        body: JSON.stringify({
          title: `[Inactivity Review] ${repository.name} — activity attribution unclear`,
          body: `${REVIEW_MARKER}\n\n@${INSTRUCTOR} manual review required. The monitor could not verify recent learner activity safely, so it did not issue an inactivity warning or recommend deletion.\n\nrepository: ${repository.name}\nlearner: ${learner}\ncourse_id: ${course.id}\ntrack: ${track}\nreason: ${activity.reason || 'unknown'}`
        })
      });
    }
    continue;
  }
  if (activity.active) continue;

  const deadline = new Date(now.getTime() + GRACE_DAYS * DAY_MS).toISOString();
  await api(`/repos/${organization}/${repository.name}/issues`, {
    method: 'POST',
    body: JSON.stringify({
      title: '[High-Q] Inactivity warning — action required within 1 day',
      body: `${WARNING_MARKER}\n\n@${learner}, High-Q has not detected learner-originated course activity from your account in this current unfinished course for **4 full days**. Maintainer, instructor, template, bot, and GitHub Actions activity does not count as your activity.\n\nPlease resume meaningful course work within the next **1 day**. If no qualifying learner activity is detected by ${deadline}, the course will be sent to the instructor for manual disenrollment review. **The system does not delete your repository automatically.**\n\nrepository: ${repository.name}\nlearner: ${learner}\ncourse_id: ${course.id}\ntrack: ${track}\nwarning_at: ${now.toISOString()}\ngrace_deadline: ${deadline}`
    })
  });
}

console.log(`Inactivity scan complete for ${groups.size} current learner course(s). Policy: ${INACTIVITY_DAYS} days inactivity + ${GRACE_DAYS} day grace; instructor approval required before deletion.`);
