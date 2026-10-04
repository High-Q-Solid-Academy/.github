import fs from "node:fs";
import process from "node:process";
import { api, organization, token } from "./curriculum-api.mjs";
import {
  closeInactivityIssue,
  createWarningIssue,
  currentUnfinishedCourses,
  DAY_MS,
  findOpenInactivityIssue,
  INACTIVITY_MARKER,
  lastLearnerActivity,
  markForReview,
  REVIEW_DAYS,
  WARNING_DAYS,
} from "./inactivity-lib.mjs";

if (!token) {
  console.error("CURRICULUM_ADMIN_TOKEN is required.");
  process.exit(1);
}

function issueDetails(entry, lastActivity, inactiveDays, state) {
  if (state === "warning") {
    return {
      title: "INACTIVE — 1-DAY ACTIVITY WARNING",
      body: `${INACTIVITY_MARKER}\n\n@${entry.user.login}, your current High Q course has been inactive for **${inactiveDays} full days**.\n\nYou have **1 day** to resume learner activity by pushing a course commit, updating/opening a pull request, or participating in a course issue.\n\nIf there is still no learner activity after the grace period, the course will move to manual instructor review. Nothing is deleted automatically.\n\nLast learner activity: ${lastActivity.toISOString()}`,
    };
  }

  return {
    title: "INACTIVE — DISENROLLMENT REVIEW",
    body: `${INACTIVITY_MARKER}\n\n@${entry.user.login}, your 1-day grace period has ended and this unfinished course is now **pending instructor review**.\n\nNo repository has been deleted. You can still resume learner activity before an instructor approves disenrollment.\n\nInactive for: **${inactiveDays} full days**  \nLast learner activity: ${lastActivity.toISOString()}`,
  };
}

async function refreshIssue(entry, issue, lastActivity, inactiveDays, state) {
  const details = issueDetails(entry, lastActivity, inactiveDays, state);
  const updated = await api(
    `/repos/${organization}/${entry.repository.name}/issues/${issue.number}`,
    {
      method: "PATCH",
      body: JSON.stringify(details),
    },
  );

  // Assignment creates an additional GitHub notification for the learner.
  // If the collaborator invitation has not been accepted yet, keep the
  // inactivity run successful and rely on the @mention notification instead.
  try {
    await api(
      `/repos/${organization}/${entry.repository.name}/issues/${issue.number}/assignees`,
      {
        method: "POST",
        body: JSON.stringify({ assignees: [entry.user.login] }),
      },
    );
  } catch (error) {
    console.warn(
      `Could not assign inactivity issue to @${entry.user.login}: ${error.message}`,
    );
  }

  return updated;
}

const now = Date.now();
const results = [];
for (const entry of await currentUnfinishedCourses()) {
  const lastActivity = await lastLearnerActivity(entry.repository, entry.user);
  const inactiveDays = Math.floor((now - lastActivity.getTime()) / DAY_MS);
  const issue = await findOpenInactivityIssue(entry.repository);
  let trackedIssue = issue;
  let state = "active";

  if (inactiveDays < WARNING_DAYS) {
    if (issue) await closeInactivityIssue(entry.repository, issue, entry.user);
    trackedIssue = null;
  } else if (inactiveDays < REVIEW_DAYS) {
    state = "warning";
    if (!trackedIssue)
      trackedIssue = await createWarningIssue(entry, lastActivity, inactiveDays);
    trackedIssue = await refreshIssue(
      entry,
      trackedIssue,
      lastActivity,
      inactiveDays,
      state,
    );
  } else {
    state = "review";
    if (!trackedIssue) {
      trackedIssue = await createWarningIssue(entry, lastActivity, inactiveDays);
    }
    if (trackedIssue.title !== "INACTIVE — DISENROLLMENT REVIEW") {
      trackedIssue = await markForReview(
        entry,
        trackedIssue,
        lastActivity,
        inactiveDays,
      );
    }
    trackedIssue = await refreshIssue(
      entry,
      trackedIssue,
      lastActivity,
      inactiveDays,
      state,
    );
  }

  results.push({
    learner: entry.user.login,
    course: entry.course.course,
    repository: entry.repository.name,
    inactiveDays,
    lastActivity: lastActivity.toISOString(),
    state,
    issueUrl: trackedIssue?.html_url || null,
  });
}

const lines = results
  .map((row) => {
    const review = row.issueUrl ? `[open issue](${row.issueUrl})` : "—";
    return `| @${row.learner} | ${row.course} | ${row.lastActivity} | ${row.inactiveDays} | ${row.state} | ${review} |`;
  })
  .join("\n");
const summary = `# Learner inactivity review\n\nRows marked **review** have passed the 4-day inactivity limit plus the 1-day grace period. Open the linked issue, check the learner's activity, then use **Actions → Approve inactive learner disenrollment** only if you decide to remove the current unfinished course.\n\n| Learner | Current unfinished course | Last learner activity | Full inactive days | State | Review |\n| --- | --- | --- | ---: | --- | --- |\n${lines || "| — | No unfinished learner courses found | — | — | — | — |"}\n`;
if (process.env.GITHUB_STEP_SUMMARY)
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
console.log(summary);
