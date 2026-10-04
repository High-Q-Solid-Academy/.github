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

const rawUsernames = String(
  process.env.STUDENT_USERNAMES || process.env.STUDENT_USERNAME || "",
).trim();
const confirmation = String(process.env.DISENROLL_CONFIRMATION || "").trim();

const usernames = [
  ...new Set(
    rawUsernames
      .split(/[\s,;]+/)
      .map((value) => value.trim())
      .filter(Boolean),
  ),
];

if (!usernames.length)
  throw new Error("At least one learner GitHub username is required.");
if (usernames.length > 50)
  throw new Error("A maximum of 50 learners can be approved in one run.");
for (const username of usernames) {
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(username))
    throw new Error(`Invalid GitHub username: ${username}`);
}
if (confirmation !== "DISENROLL SELECTED")
  throw new Error('Confirmation must exactly equal: DISENROLL SELECTED');

const unfinished = await currentUnfinishedCourses();
const prepared = [];

// Validate and snapshot every selected learner before deleting any repository.
for (const username of usernames) {
  const user = await api(`/users/${encodeURIComponent(username)}`);
  const entry = unfinished.find((candidate) => candidate.githubId === user.id);
  if (!entry)
    throw new Error(
      `No current unfinished course repository was found for @${user.login}. Nothing was deleted.`,
    );

  const lastActivity = await lastLearnerActivity(entry.repository, entry.user);
  const inactiveDays = Math.floor((Date.now() - lastActivity.getTime()) / DAY_MS);
  if (inactiveDays < REVIEW_DAYS)
    throw new Error(
      `@${user.login} has only ${inactiveDays} full inactive days; manual disenrollment requires at least ${REVIEW_DAYS}. Nothing was deleted.`,
    );

  const issue = await findOpenInactivityIssue(entry.repository);
  if (!issue || issue.title !== "INACTIVE — DISENROLLMENT REVIEW") {
    throw new Error(
      `${entry.repository.name} is not marked INACTIVE — DISENROLLMENT REVIEW. Nothing was deleted.`,
    );
  }

  const progress = await captureCourseProgress(entry);
  prepared.push({
    user,
    entry,
    record: {
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
    },
  });
}

console.log(
  `Validated ${prepared.length} selected learner(s). Beginning approved disenrollment.`,
);

for (const item of prepared) {
  await writePausedRecord(item.record);
  await api(`/repos/${organization}/${item.entry.repository.name}`, {
    method: "DELETE",
  });
  console.log(
    `Deleted ${item.entry.repository.name}; resume record preserved for @${item.user.login}.`,
  );
}

console.log(
  `Completed approved disenrollment for ${prepared.length} selected learner(s). Resume records are preserved in private ${organization}/highq-learner-records.`,
);
