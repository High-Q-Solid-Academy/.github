import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  api,
  learnerOwnedRepositoryName,
  organization,
  provisionLearnerOwnedCourse,
  token,
  writeEnrollment,
} from './curriculum-api.mjs';
import { installationToken } from './github-app.mjs';
import {
  assertRealNameMatches,
  buildEnrollment,
  decodeEnrollment,
  DEFAULT_TRACK,
  enrollmentPath,
  enrollmentTrack,
  normalizeEmail,
  normalizeTrack,
} from './identity.mjs';
import { tryReadPausedRecord } from './inactivity-lib.mjs';
import {
  tryReadLearnerRegistryRecord,
  writeLearnerRegistryRecord,
} from './learner-registry.mjs';

if (!token) {
  console.error('CURRICULUM_ADMIN_TOKEN is required.');
  process.exit(1);
}

const student = String(process.env.STUDENT_USERNAME || '').trim();
const realName = String(process.env.REAL_NAME || '').trim();
const email = normalizeEmail(process.env.STUDENT_EMAIL);
const track = normalizeTrack(process.env.STUDENT_TRACK, DEFAULT_TRACK);
if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(student)) {
  console.error('STUDENT_USERNAME must be a valid GitHub username.');
  process.exit(1);
}
if (!email) {
  console.error('STUDENT_EMAIL is required.');
  process.exit(1);
}

const curriculum = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, 'courses.json'), 'utf8'),
);
const trackDefinition = curriculum.tracks?.[track];
if (!trackDefinition?.courses?.length)
  throw new Error(`Programme ${track} is not configured.`);
const courseById = new Map(
  curriculum.courses.map((course) => [course.id, course]),
);
const first = courseById.get(trackDefinition.courses[0]);
if (!first)
  throw new Error(
    `First course ${trackDefinition.courses[0]} is missing from course definitions.`,
  );

const user = await api(`/users/${student}`);
assertRealNameMatches(realName, user.name);
const pausedRecord = await tryReadPausedRecord(user.id);
if (pausedRecord?.status === 'paused') {
  throw new Error(
    `@${user.login} has a preserved paused-course record for ${pausedRecord.removedCourseName}. Use Actions → Resume paused learner instead of starting a new enrollment.`,
  );
}

// Existing organization-owned learners remain on Enrollment V1. This check is
// deliberately first so the V2 launch never migrates an existing learner by accident.
const legacyRepositoryName = `${first.repositoryPrefix}${user.login}`;
try {
  const repository = await api(`/repos/${organization}/${legacyRepositoryName}`);
  try {
    const file = await api(
      `/repos/${organization}/${repository.name}/contents/${enrollmentPath()}?ref=${repository.default_branch}`,
    );
    const existing = decodeEnrollment(file.content);
    const existingTrack = enrollmentTrack(existing);
    if (existingTrack !== track) {
      throw new Error(
        `@${user.login} is already enrolled in ${existingTrack}. Programme changes must be handled explicitly.`,
      );
    }
    const updatedEnrollment = buildEnrollment(
      user,
      realName,
      track,
      existing.enrolledAt || new Date().toISOString(),
      email,
      { ownership: 'organization' },
    );
    await writeEnrollment(
      repository.name,
      updatedEnrollment,
      repository.default_branch,
    );
  } catch (error) {
    if (error.status !== 404) throw error;
    if (track !== DEFAULT_TRACK) {
      throw new Error(
        `@${user.login} already has a legacy learner repository with no programme record. Migrate the learner explicitly before assigning Computer Engineering.`,
      );
    }
    await writeEnrollment(
      repository.name,
      buildEnrollment(
        user,
        realName,
        track,
        new Date().toISOString(),
        email,
        { ownership: 'organization' },
      ),
      repository.default_branch,
    );
  }
  console.log(
    `@${user.login} remains on the existing organization-owned enrollment path: ${organization}/${repository.name}.`,
  );
  process.exit(0);
} catch (error) {
  if (error.status !== 404) throw error;
}

// Enrollment V2: learner-owned repository controlled through the High Q GitHub App.
const existingRegistry = await tryReadLearnerRegistryRecord(user.id);
if (existingRegistry) {
  if (existingRegistry.status !== 'active') {
    throw new Error(
      `@${user.login} already has a learner-owned High Q record with status ${existingRegistry.status}. Resume/reactivate that record instead of enrolling again.`,
    );
  }
  if (existingRegistry.track !== track) {
    throw new Error(
      `@${user.login} is already enrolled in ${existingRegistry.track}. Programme changes must be handled explicitly.`,
    );
  }

  const authToken = await installationToken(existingRegistry.installationId);
  const repository = await api(
    `/repos/${encodeURIComponent(existingRegistry.repositoryOwner)}/${encodeURIComponent(existingRegistry.repositoryName)}`,
    {},
    authToken,
  );
  const enrollment = buildEnrollment(
    user,
    realName,
    track,
    existingRegistry.enrolledAt || new Date().toISOString(),
    email,
    {
      ownership: 'learner',
      installationId: existingRegistry.installationId,
      repositoryOwner: existingRegistry.repositoryOwner,
      repositoryName: existingRegistry.repositoryName,
      repositoryFullName: existingRegistry.repositoryFullName,
    },
  );
  await writeEnrollment(
    repository.name,
    enrollment,
    repository.default_branch,
    { owner: existingRegistry.repositoryOwner, authToken },
  );
  await writeLearnerRegistryRecord({
    ...existingRegistry,
    githubLogin: user.login,
    realName,
    email,
    track,
    enrollment,
  });
  console.log(`Updated Enrollment V2 contact record for @${user.login}; ${repository.full_name} remains the active course repository.`);
  process.exit(0);
}

const enrolledAt = new Date().toISOString();
const preliminaryEnrollment = buildEnrollment(
  user,
  realName,
  track,
  enrolledAt,
  email,
  { ownership: 'learner' },
);
const result = await provisionLearnerOwnedCourse(
  first,
  user.login,
  true,
  preliminaryEnrollment,
);
const authToken = await installationToken(result.installationId);
const enrollment = buildEnrollment(
  user,
  realName,
  track,
  enrolledAt,
  email,
  {
    ownership: 'learner',
    installationId: result.installationId,
    repositoryOwner: result.repositoryOwner,
    repositoryName: result.repository,
    repositoryFullName: result.repositoryFullName,
  },
);
await writeEnrollment(result.repository, enrollment, result.branch, {
  owner: result.repositoryOwner,
  authToken,
});
await writeLearnerRegistryRecord({
  status: 'active',
  ownership: 'learner',
  githubId: user.id,
  githubLogin: user.login,
  githubLoginAtEnrollment: user.login,
  githubProfileUrl: user.html_url,
  realName,
  email,
  track,
  enrolledAt,
  installationId: result.installationId,
  currentCourseId: first.id,
  currentCourseName: first.course,
  repositoryOwner: result.repositoryOwner,
  repositoryName: result.repository,
  repositoryFullName: result.repositoryFullName,
  defaultBranch: result.branch,
  enrollment,
});

console.log(
  `Enrollment V2 complete: ${realName} (@${user.login}) -> ${result.repositoryFullName}. The learner owns the repository; High Q retains course access through its GitHub App installation.`,
);
console.log(`Expected learner repository name: ${learnerOwnedRepositoryName(first)}.`);
