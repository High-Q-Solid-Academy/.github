import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  api,
  academyRepositoryAuthToken,
  learnerOwnedRepositoryName,
  organization,
  provisionCourse,
  provisionLearnerOwnedCourse,
  token,
  writeEnrollment,
} from "./curriculum-api.mjs";
import { installationToken } from "./github-app.mjs";
import {
  assertRealNameMatches,
  buildEnrollment,
  decodeEnrollment,
  DEFAULT_TRACK,
  enrollmentPath,
  enrollmentTrack,
  normalizeEmail,
  normalizeTrack,
} from "./identity.mjs";
import { tryReadPausedRecord } from "./inactivity-lib.mjs";
import {
  tryReadLearnerRegistryRecord,
  writeLearnerRegistryRecord,
} from "./learner-registry.mjs";
import { websiteConfirmEnrollment } from "./website-clearance.mjs";

if (!token) {
  console.error("CURRICULUM_ADMIN_TOKEN is required.");
  process.exit(1);
}

const student = String(process.env.STUDENT_USERNAME || "").trim();
const realName = String(process.env.REAL_NAME || "").trim();
const email = normalizeEmail(process.env.STUDENT_EMAIL);
const track = normalizeTrack(process.env.STUDENT_TRACK, DEFAULT_TRACK);
const enrollmentVersion = String(process.env.ENROLLMENT_VERSION || "v2")
  .trim()
  .toLowerCase();
if (!["v1", "v2"].includes(enrollmentVersion)) {
  throw new Error("ENROLLMENT_VERSION must be v1 or v2.");
}
if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(student)) {
  console.error("STUDENT_USERNAME must be a valid GitHub username.");
  process.exit(1);
}
if (!email) {
  console.error("STUDENT_EMAIL is required.");
  process.exit(1);
}

const curriculum = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "courses.json"), "utf8"),
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
if (pausedRecord?.status === "paused") {
  throw new Error(
    `@${user.login} has a preserved paused-course record for ${pausedRecord.removedCourseName}. Use Actions → Resume paused learner instead of starting a new enrollment.`,
  );
}

// Never silently migrate an existing learner between ownership models.
const legacyRepositoryName = `${first.repositoryPrefix}${user.login}`;
try {
  const academyAuthToken = await academyRepositoryAuthToken();
  const repository = await api(
    `/repos/${organization}/${legacyRepositoryName}`,
    {},
    academyAuthToken,
  );
  if (enrollmentVersion !== "v1") {
    throw new Error(
      `@${user.login} is already enrolled as V1 in ${organization}/${repository.name}. Select V1 to update this learner.`,
    );
  }
  try {
    const file = await api(
      `/repos/${organization}/${repository.name}/contents/${enrollmentPath()}?ref=${repository.default_branch}`,
      {},
      academyAuthToken,
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
      { ownership: "organization" },
    );
    await writeEnrollment(
      repository.name,
      updatedEnrollment,
      repository.default_branch,
      { authToken: academyAuthToken },
    );
  } catch (error) {
    if (error.status !== 404) throw error;
    const recoveredEnrollment = buildEnrollment(user, realName, track, new Date().toISOString(), email, {
        ownership: "organization",
      });
    await provisionCourse(first, user.login, true, recoveredEnrollment, { reuseExistingEmpty: true });
  }
  console.log(
    `@${user.login} remains on the existing organization-owned enrollment path: ${organization}/${repository.name}.`,
  );
  await websiteConfirmEnrollment({
    github_id: user.id,
    github_login: user.login,
    full_name: realName,
    email,
    programme_track: track,
    enrollment_version: "v1",
    repository_full_name: `${organization}/${repository.name}`,
  });
  process.exit(0);
} catch (error) {
  if (error.status !== 404) throw error;
}

// Enrollment V2: learner-owned repository controlled through the High Q GitHub App.
const existingRegistry = await tryReadLearnerRegistryRecord(user.id);
if (existingRegistry) {
  if (enrollmentVersion !== "v2") {
    throw new Error(
      `@${user.login} is already enrolled as V2 in ${existingRegistry.repositoryFullName}. Select V2 to update this learner.`,
    );
  }
  if (existingRegistry.status !== "active") {
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
      ownership: "learner",
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
  console.log(
    `Updated Enrollment V2 contact record for @${user.login}; ${repository.full_name} remains the active course repository.`,
  );
  await websiteConfirmEnrollment({
    github_id: user.id,
    github_login: user.login,
    full_name: realName,
    email,
    programme_track: track,
    enrollment_version: "v2",
    repository_full_name: repository.full_name,
  });
  process.exit(0);
}

const enrolledAt = new Date().toISOString();
if (enrollmentVersion === "v1") {
  const enrollment = buildEnrollment(
    user,
    realName,
    track,
    enrolledAt,
    email,
    { ownership: "organization" },
  );
  const result = await provisionCourse(first, user.login, true, enrollment);
  await websiteConfirmEnrollment({
    github_id: user.id,
    github_login: user.login,
    full_name: realName,
    email,
    programme_track: track,
    enrollment_version: "v1",
    repository_full_name: result.repositoryFullName,
  });
  console.log(
    `Enrollment V1 complete: ${realName} (@${user.login}) -> ${result.repositoryFullName}. The academy owns the private repository and the learner has collaborator access.`,
  );
  process.exit(0);
}

const preliminaryEnrollment = buildEnrollment(
  user,
  realName,
  track,
  enrolledAt,
  email,
  { ownership: "learner" },
);
const result = await provisionLearnerOwnedCourse(
  first,
  user.login,
  true,
  preliminaryEnrollment,
);
const enrollment = result.enrollment;
if (!enrollment) {
  throw new Error(
    "Enrollment V2 provisioning did not return its recorded enrollment.",
  );
}
await writeLearnerRegistryRecord({
  status: "active",
  ownership: "learner",
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
  repositories: [
    {
      courseId: first.id,
      courseName: first.course,
      repositoryOwner: result.repositoryOwner,
      repositoryName: result.repository,
      repositoryFullName: result.repositoryFullName,
      defaultBranch: result.branch,
      state: "current",
      startedAt: enrolledAt,
    },
  ],
  enrollment,
});

await websiteConfirmEnrollment({
  github_id: user.id,
  github_login: user.login,
  full_name: realName,
  email,
  programme_track: track,
  enrollment_version: "v2",
  repository_full_name: result.repositoryFullName,
});

console.log(
  `Enrollment V2 complete: ${realName} (@${user.login}) -> ${result.repositoryFullName}. The learner owns the repository; High Q retains course access through its GitHub App installation.`,
);
console.log(
  `Expected learner repository name: ${learnerOwnedRepositoryName(first)}.`,
);
