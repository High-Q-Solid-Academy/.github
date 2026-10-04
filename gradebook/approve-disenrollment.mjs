import process from "node:process";
import { api, organization, token } from "./curriculum-api.mjs";
import {
  captureCourseProgress,
  currentUnfinishedCourses,
  DAY_MS,
  findOpenInactivityIssue,
  lastLearnerActivity,
  REVIEW_DAYS,
  writePausedRecord,
} from "./inactivity-lib.mjs";

if (!token) throw new Error("CURRICULUM_ADMIN_TOKEN is required.");
const username = String(process.env.STUDENT_USERNAME || "").trim();
const confirmation = String(process.env.DISENROLL_CONFIRMATION || "").trim();
if (!username) throw new Error("STUDENT_USERNAME is required.");
if (confirmation !== `DISENROLL ${username}`)
  throw new Error(`Confirmation must exactly equal: DISENROLL ${username}`);

const user = await api(`/users/${encodeURIComponent(username)}`);
const entry = (await currentUnfinishedCourses()).find(
  (candidate) => candidate.githubId === user.id,
);
if (!entry)
  throw new Error(
    `No current unfinished course repository was found for @${user.login}.`,
  );

const lastActivity = await lastLearnerActivity(entry.repository, entry.user);
const inactiveDays = Math.floor((Date.now() - lastActivity.getTime()) / DAY_MS);
if (inactiveDays < REVIEW_DAYS)
  throw new Error(
    `@${user.login} has only ${inactiveDays} full inactive days; manual disenrollment requires at least ${REVIEW_DAYS}.`,
  );

const issue = await findOpenInactivityIssue(entry.repository);
if (!issue || issue.title !== "INACTIVE — DISENROLLMENT REVIEW") {
  throw new Error(
    `${entry.repository.name} is not marked INACTIVE — DISENROLLMENT REVIEW.`,
  );
}

const progress = await captureCourseProgress(entry);

const record = {
  schemaVersion: 1,
  status: "paused",
  githubId: user.id,
  githubLoginAtDisenrollment: user.login,
  realName: entry.enrollment.realName,
  track: entry.track,
  enrollment: entry.enrollment,
  removedCourseId: entry.course.id,
  removedCourseName: entry.course.course,
  removedRepository: entry.repository.name,
  progress,
  lastLearnerActivityAt: lastActivity.toISOString(),
  inactiveDaysAtApproval: inactiveDays,
  approvedAt: new Date().toISOString(),
  approvedBy: process.env.GITHUB_ACTOR || "unknown",
};

await writePausedRecord(record);
await api(`/repos/${organization}/${entry.repository.name}`, {
  method: "DELETE",
});
console.log(
  `Deleted current unfinished repository ${entry.repository.name} after manual approval. Resume record preserved in private ${organization}/highq-learner-records.`,
);
