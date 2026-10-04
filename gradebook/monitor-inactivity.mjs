import fs from "node:fs";
import process from "node:process";
import { token } from "./curriculum-api.mjs";
import {
  closeInactivityIssue,
  createWarningIssue,
  currentUnfinishedCourses,
  DAY_MS,
  findOpenInactivityIssue,
  lastLearnerActivity,
  markForReview,
  REVIEW_DAYS,
  WARNING_DAYS,
} from "./inactivity-lib.mjs";

if (!token) {
  console.error("CURRICULUM_ADMIN_TOKEN is required.");
  process.exit(1);
}

const now = Date.now();
const results = [];
for (const entry of await currentUnfinishedCourses()) {
  const lastActivity = await lastLearnerActivity(entry.repository, entry.user);
  const inactiveDays = Math.floor((now - lastActivity.getTime()) / DAY_MS);
  const issue = await findOpenInactivityIssue(entry.repository);
  let state = "active";

  if (inactiveDays < WARNING_DAYS) {
    if (issue) await closeInactivityIssue(entry.repository, issue, entry.user);
  } else if (inactiveDays < REVIEW_DAYS) {
    state = "warning";
    if (!issue) await createWarningIssue(entry, lastActivity, inactiveDays);
  } else {
    state = "review";
    if (!issue) {
      const warning = await createWarningIssue(
        entry,
        lastActivity,
        inactiveDays,
      );
      await markForReview(entry, warning, lastActivity, inactiveDays);
    } else if (issue.title !== "INACTIVE — DISENROLLMENT REVIEW") {
      await markForReview(entry, issue, lastActivity, inactiveDays);
    }
  }

  results.push({
    learner: entry.user.login,
    course: entry.course.course,
    repository: entry.repository.name,
    inactiveDays,
    lastActivity: lastActivity.toISOString(),
    state,
  });
}

const lines = results
  .map(
    (row) =>
      `| @${row.learner} | ${row.course} | ${row.repository} | ${row.lastActivity} | ${row.inactiveDays} | ${row.state} |`,
  )
  .join("\n");
const summary = `# Learner inactivity review\n\n| Learner | Current unfinished course | Repository | Last learner activity | Full inactive days | State |\n| --- | --- | --- | --- | ---: | --- |\n${lines || "| — | No unfinished learner courses found | — | — | — | — |"}\n`;
if (process.env.GITHUB_STEP_SUMMARY)
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
console.log(summary);
