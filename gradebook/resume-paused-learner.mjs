import process from "node:process";
import {
  api,
  listRepositories,
  organization,
  provisionCourse,
  token,
} from "./curriculum-api.mjs";
import {
  loadCurriculum,
  readPausedRecord,
  restoreCourseProgress,
  writePausedRecord,
} from "./inactivity-lib.mjs";

if (!token) throw new Error("CURRICULUM_ADMIN_TOKEN is required.");
const username = String(process.env.STUDENT_USERNAME || "").trim();
const confirmation = String(process.env.RESUME_CONFIRMATION || "").trim();
if (!username) throw new Error("STUDENT_USERNAME is required.");
if (confirmation !== `RESUME ${username}`)
  throw new Error(`Confirmation must exactly equal: RESUME ${username}`);

const user = await api(`/users/${encodeURIComponent(username)}`);
const record = await readPausedRecord(user.id);
if (record.status !== "paused")
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
const expectedRepository = `${course.repositoryPrefix}${user.login}`;
const repositories = await listRepositories();
if (repositories.some((repository) => repository.name === expectedRepository))
  throw new Error(`${expectedRepository} already exists.`);

const enrollment = {
  ...record.enrollment,
  schemaVersion: 2,
  githubId: user.id,
  githubLoginAtEnrollment: user.login,
  githubProfileUrl: user.html_url,
  track: record.track,
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
  status: "resumed",
  resumedAt: new Date().toISOString(),
  resumedBy: process.env.GITHUB_ACTOR || "unknown",
  resumedRepository: outcome.repository,
  restoredCommit,
});
console.log(
  `Resumed @${user.login} at ${course.course}: ${organization}/${outcome.repository}. The learner may need to accept the collaborator invitation.`,
);
