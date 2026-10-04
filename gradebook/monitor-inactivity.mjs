import fs from "node:fs";
import process from "node:process";
import { api, organization, token } from "./curriculum-api.mjs";
import {
  closeInactivityIssue,
  createWarningIssue,
  currentUnfinishedCourses,
  DAY_MS,
  ensureStateRepository,
  findOpenInactivityIssue,
  INACTIVITY_MARKER,
  lastLearnerActivity,
  markForReview,
  REVIEW_DAYS,
  STATE_REPOSITORY,
  WARNING_DAYS,
} from "./inactivity-lib.mjs";

const REVIEW_DASHBOARD_MARKER = "<!-- highq-inactivity-review-dashboard -->";
const REVIEW_DASHBOARD_TITLE = "Inactive learner review — select for disenrollment";

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

function queueEmail(queue, entry, state, inactiveDays, lastActivity, issueUrl) {
  const email = String(entry.enrollment?.email || "").trim();
  if (!email) {
    console.warn(
      `No stored learner email for @${entry.user.login}; GitHub issue notification will be used only.`,
    );
    return;
  }
  queue.push({
    state,
    email,
    learner: entry.user.login,
    realName: entry.enrollment?.realName || entry.user.login,
    course: entry.course.course,
    repository: entry.repository.name,
    inactiveDays,
    lastActivity: lastActivity.toISOString(),
    issueUrl: issueUrl || null,
  });
}

function checkedLearnersFromBody(body) {
  const checked = new Set();
  for (const match of String(body || "").matchAll(
    /^- \[[xX]\] @([a-z\d](?:[a-z\d-]{0,37}[a-z\d])?)/gim,
  )) {
    checked.add(match[1].toLowerCase());
  }
  return checked;
}

async function syncReviewDashboard(results) {
  const reviewRows = results.filter((row) => row.state === "review");
  if (!reviewRows.length) return null;

  await ensureStateRepository();
  await api(`/repos/${organization}/${STATE_REPOSITORY}`, {
    method: "PATCH",
    body: JSON.stringify({ has_issues: true }),
  });

  const issues = await api(
    `/repos/${organization}/${STATE_REPOSITORY}/issues?state=open&per_page=100`,
  );
  let dashboard = issues.find(
    (issue) =>
      !issue.pull_request &&
      issue.body?.includes(REVIEW_DASHBOARD_MARKER),
  );
  const checked = checkedLearnersFromBody(dashboard?.body);

  const tasks = reviewRows
    .sort((a, b) => b.inactiveDays - a.inactiveDays)
    .map((row) => {
      const selected = checked.has(row.learner.toLowerCase()) ? "x" : " ";
      const details = row.issueUrl ? ` — [review issue](${row.issueUrl})` : "";
      return `- [${selected}] @${row.learner} — ${row.course} — ${row.inactiveDays} inactive days${details}`;
    })
    .join("\n");

  const body = `${REVIEW_DASHBOARD_MARKER}\n\nTick only the learners you want to disenroll. Checking a box does **not** delete anything by itself.\n\n${tasks}\n\nAfter selecting, run **Actions → Approve inactive learner disenrollment** and type \`DISENROLL SELECTED\`. Every checked learner is revalidated before any repository is deleted.`;

  if (dashboard) {
    dashboard = await api(
      `/repos/${organization}/${STATE_REPOSITORY}/issues/${dashboard.number}`,
      {
        method: "PATCH",
        body: JSON.stringify({ title: REVIEW_DASHBOARD_TITLE, body }),
      },
    );
  } else {
    dashboard = await api(`/repos/${organization}/${STATE_REPOSITORY}/issues`, {
      method: "POST",
      body: JSON.stringify({ title: REVIEW_DASHBOARD_TITLE, body }),
    });
  }

  return dashboard.html_url || null;
}

const now = Date.now();
const results = [];
const emailQueue = [];
for (const entry of await currentUnfinishedCourses()) {
  const lastActivity = await lastLearnerActivity(entry.repository, entry.user);
  const inactiveDays = Math.floor((now - lastActivity.getTime()) / DAY_MS);
  const issue = await findOpenInactivityIssue(entry.repository);
  let trackedIssue = issue;
  let state = "active";
  let notificationState = null;

  if (inactiveDays < WARNING_DAYS) {
    if (issue) await closeInactivityIssue(entry.repository, issue, entry.user);
    trackedIssue = null;
  } else if (inactiveDays < REVIEW_DAYS) {
    state = "warning";
    if (!trackedIssue) {
      trackedIssue = await createWarningIssue(entry, lastActivity, inactiveDays);
      notificationState = "warning";
    }
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
      notificationState = "review";
    }
    if (trackedIssue.title !== "INACTIVE — DISENROLLMENT REVIEW") {
      trackedIssue = await markForReview(
        entry,
        trackedIssue,
        lastActivity,
        inactiveDays,
      );
      notificationState = "review";
    }
    trackedIssue = await refreshIssue(
      entry,
      trackedIssue,
      lastActivity,
      inactiveDays,
      state,
    );
  }

  if (notificationState) {
    queueEmail(
      emailQueue,
      entry,
      notificationState,
      inactiveDays,
      lastActivity,
      trackedIssue?.html_url,
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

fs.writeFileSync(
  "inactivity-email-queue.json",
  `${JSON.stringify(emailQueue, null, 2)}\n`,
);
console.log(`Queued ${emailQueue.length} direct inactivity email(s).`);

const dashboardUrl = await syncReviewDashboard(results);
const lines = results
  .map((row) => {
    const review = row.issueUrl ? `[open issue](${row.issueUrl})` : "—";
    return `| @${row.learner} | ${row.course} | ${row.lastActivity} | ${row.inactiveDays} | ${row.state} | ${review} |`;
  })
  .join("\n");
const dashboardLine = dashboardUrl
  ? `\n\n### Selection dashboard\n[Open the private checkbox review page](${dashboardUrl}) to tick the learners you want to disenroll.`
  : "";
const summary = `# Learner inactivity review\n\nRows marked **review** have passed the 4-day inactivity limit plus the 1-day grace period.${dashboardLine}\n\n| Learner | Current unfinished course | Last learner activity | Full inactive days | State | Review |\n| --- | --- | --- | ---: | --- | --- |\n${lines || "| — | No unfinished learner courses found | — | — | — | — |"}\n`;
if (process.env.GITHUB_STEP_SUMMARY)
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
console.log(summary);
