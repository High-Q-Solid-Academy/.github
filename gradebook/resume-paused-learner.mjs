import process from 'node:process';
import {
  api,
  listRepositories,
  organization,
  provisionCourse,
  token,
} from './curriculum-api.mjs';
import { installationToken } from './github-app.mjs';
import {
  loadCurriculum,
  readPausedRecord,
  restoreCourseProgress,
  writePausedRecord,
} from './inactivity-lib.mjs';
import {
  readLearnerRegistryRecord,
  writeLearnerRegistryRecord,
} from './learner-registry.mjs';

if (!token) throw new Error('CURRICULUM_ADMIN_TOKEN is required.');
const username = String(process.env.STUDENT_USERNAME || '').trim();
const confirmation = String(process.env.RESUME_CONFIRMATION || '').trim();
if (!username) throw new Error('STUDENT_USERNAME is required.');
if (confirmation !== `RESUME ${username}`)
  throw new Error(`Confirmation must exactly equal: RESUME ${username}`);

const user = await api(`/users/${encodeURIComponent(username)}`);
const record = await readPausedRecord(user.id);
if (record.status !== 'paused')
  throw new Error(
    `The stored record for @${user.login} is ${record.status}, not paused.`,
  );

const curriculum = loadCurriculum();
const course = curriculum.courses.find(
  (candidate) => candidate.id === record.removedCourseId,
);
if (!course)
  throw new Error(
    `Stored course ${record.removedCourseId} no longer exists in courses.json.`,
  );

// Enrollment V2: the learner still owns the original repository. Resuming only
// reactivates High Q's programme record; no repository is recreated or overwritten.
if (record.ownership === 'learner') {
  const registry = await readLearnerRegistryRecord(user.id);
  if (registry.status !== 'paused') {
    throw new Error(
      `The learner-owned registry for @${user.login} is ${registry.status}, not paused.`,
    );
  }

  const installationId = Number(
    record.installationId || registry.installationId,
  );
  if (!Number.isFinite(installationId))
    throw new Error(
      `No GitHub App installation is recorded for @${user.login}. Reinstall the High Q GitHub App before resuming.`,
    );
  const authToken = await installationToken(installationId);
  const repositoryOwner =
    record.removedRepositoryOwner || registry.repositoryOwner || user.login;
  const repositoryName =
    record.removedRepository || registry.repositoryName;
  const repository = await api(
    `/repos/${encodeURIComponent(repositoryOwner)}/${encodeURIComponent(repositoryName)}`,
    {},
    authToken,
  );

  const resumedAt = new Date().toISOString();
  const repositories = Array.isArray(registry.repositories)
    ? registry.repositories.map((item) => ({ ...item }))
    : [{
        courseId: course.id,
        courseName: course.course,
        repositoryOwner,
        repositoryName,
        repositoryFullName: `${repositoryOwner}/${repositoryName}`,
        defaultBranch: repository.default_branch || 'main',
        state: 'current',
        startedAt: registry.enrolledAt || record.enrollment?.enrolledAt || resumedAt,
      }];

  const updatedRepositories = repositories.map((item) =>
    item.courseId === course.id &&
    item.repositoryOwner?.toLowerCase() === repositoryOwner.toLowerCase() &&
    item.repositoryName === repositoryName
      ? { ...item, state: 'current', resumedAt }
      : item,
  );

  await writeLearnerRegistryRecord({
    ...registry,
    status: 'active',
    githubLogin: user.login,
    currentCourseId: course.id,
    currentCourseName: course.course,
    repositoryOwner,
    repositoryName,
    repositoryFullName: `${repositoryOwner}/${repositoryName}`,
    defaultBranch: repository.default_branch || registry.defaultBranch || 'main',
    installationId,
    repositories: updatedRepositories,
    resumedAt,
    resumedBy: process.env.GITHUB_ACTOR || 'unknown',
  });

  await writePausedRecord({
    ...record,
    status: 'resumed',
    resumedAt,
    resumedBy: process.env.GITHUB_ACTOR || 'unknown',
    resumedRepository: `${repositoryOwner}/${repositoryName}`,
    restoredCommit: null,
    note: 'Learner-owned repository remained intact while enrollment was paused.',
  });

  console.log(
    `Resumed @${user.login} at ${course.course}. Personal repository ${repositoryOwner}/${repositoryName} was reused unchanged.`,
  );
  process.exit(0);
}

// Enrollment V1: academy-owned current course repositories were removed after
// approval, so resume recreates the course from the academy template and restores
// the preserved learner-work snapshot.
const expectedRepository = `${course.repositoryPrefix}${user.login}`;
const repositories = await listRepositories();
if (repositories.some((repository) => repository.name === expectedRepository))
  throw new Error(`${expectedRepository} already exists.`);

const enrollment = {
  ...record.enrollment,
  schemaVersion: Math.max(Number(record.enrollment?.schemaVersion || 0), 4),
  githubId: user.id,
  githubLoginAtEnrollment: user.login,
  githubProfileUrl: user.html_url,
  track: record.track,
  ownership: 'organization',
};
let restoredCommit = null;
const outcome = await provisionCourse(course, user.login, true, enrollment, {
  beforeProtect: async ({ repository, branch }) => {
    restoredCommit = await restoreCourseProgress(
      repository,
      branch,
      record.progress,
    );
  },
});
await writePausedRecord({
  ...record,
  status: 'resumed',
  resumedAt: new Date().toISOString(),
  resumedBy: process.env.GITHUB_ACTOR || 'unknown',
  resumedRepository: outcome.repositoryFullName,
  restoredCommit,
});
console.log(
  `Resumed @${user.login} at ${course.course}: ${organization}/${outcome.repository}. The learner may need to accept the collaborator invitation.`,
);
