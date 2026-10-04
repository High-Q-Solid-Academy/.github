import process from 'node:process';
import { api, repoApi, repositoryFullName, token } from './curriculum-api.mjs';
import {
  captureCourseProgress,
  currentUnfinishedCourses,
  DAY_MS,
  findOpenInactivityIssue,
  lastLearnerActivity,
  REVIEW_DAYS,
  writePausedRecord,
} from './inactivity-lib.mjs';
import { updateLearnerRegistryStatus } from './learner-registry.mjs';

if (!token) throw new Error('CURRICULUM_ADMIN_TOKEN is required.');

const raw = String(process.env.STUDENT_USERNAMES || '').trim();
const usernames = [...new Set(
  raw.split(/[\s,;]+/).map((value) => value.trim()).filter(Boolean),
)];
if (!usernames.length) throw new Error('At least one learner-owned username is required.');
if (String(process.env.DISENROLL_CONFIRMATION || '').trim() !== 'DISENROLL SELECTED') {
  throw new Error('Confirmation must exactly equal: DISENROLL SELECTED');
}

const unfinished = await currentUnfinishedCourses();
const prepared = [];

for (const username of usernames) {
  const user = await api(`/users/${encodeURIComponent(username)}`);
  const entry = unfinished.find((candidate) => candidate.githubId === user.id);
  if (!entry) {
    throw new Error(`No active unfinished High Q course was found for @${user.login}. Nothing was changed.`);
  }
  if (entry.repository?._highq?.ownership !== 'learner') {
    throw new Error(`${repositoryFullName(entry.repository)} is not learner-owned. Nothing was changed.`);
  }

  const lastActivity = await lastLearnerActivity(entry.repository, entry.user);
  const inactiveDays = Math.floor((Date.now() - lastActivity.getTime()) / DAY_MS);
  if (inactiveDays < REVIEW_DAYS) {
    throw new Error(`@${user.login} has only ${inactiveDays} full inactive days; at least ${REVIEW_DAYS} are required. Nothing was changed.`);
  }

  const issue = await findOpenInactivityIssue(entry.repository);
  if (!issue || issue.title !== 'INACTIVE — DISENROLLMENT REVIEW') {
    throw new Error(`${repositoryFullName(entry.repository)} is not marked for inactivity review. Nothing was changed.`);
  }

  const progress = await captureCourseProgress(entry);
  prepared.push({
    user,
    entry,
    issue,
    record: {
      schemaVersion: 2,
      status: 'paused',
      ownership: 'learner',
      githubId: user.id,
      githubLoginAtDisenrollment: user.login,
      realName: entry.enrollment.realName,
      track: entry.track,
      enrollment: entry.enrollment,
      removedCourseId: entry.course.id,
      removedCourseName: entry.course.course,
      removedRepository: entry.repository.name,
      removedRepositoryOwner: entry.repository._highq.owner,
      removedRepositoryFullName: repositoryFullName(entry.repository),
      installationId: entry.repository._highq.installationId,
      progress,
      lastLearnerActivityAt: lastActivity.toISOString(),
      inactiveDaysAtApproval: inactiveDays,
      approvedAt: new Date().toISOString(),
      approvedBy: process.env.GITHUB_ACTOR || 'unknown',
    },
  });
}

for (const item of prepared) {
  await writePausedRecord(item.record);
  await updateLearnerRegistryStatus(item.user.id, 'paused', {
    pausedAt: item.record.approvedAt,
    pausedBy: item.record.approvedBy,
    pauseReason: 'inactivity-disenrollment',
    lastLearnerActivityAt: item.record.lastLearnerActivityAt,
    inactiveDaysAtApproval: item.record.inactiveDaysAtApproval,
  });

  try {
    await repoApi(item.entry.repository, `/issues/${item.issue.number}/comments`, {
      method: 'POST',
      body: JSON.stringify({
        body: 'High Q programme enrollment has been paused after instructor approval. This repository remains in your GitHub account and is not deleted by High Q.',
      }),
    });
    await repoApi(item.entry.repository, `/issues/${item.issue.number}`, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'closed', state_reason: 'completed' }),
    });
  } catch (error) {
    console.warn(`Enrollment was paused, but the inactivity issue could not be closed: ${error.message}`);
  }

  console.log(`Paused @${item.user.login}; learner-owned repository ${item.record.removedRepositoryFullName} remains untouched.`);
}

console.log(`Paused ${prepared.length} learner-owned High Q enrollment(s).`);
