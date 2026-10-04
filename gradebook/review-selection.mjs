import fs from "node:fs";
import process from "node:process";
import { api, organization, token } from "./curriculum-api.mjs";
import { ensureStateRepository, STATE_REPOSITORY } from "./inactivity-lib.mjs";

const REVIEW_DASHBOARD_MARKER = "<!-- highq-inactivity-review-dashboard -->";

if (!token) throw new Error("CURRICULUM_ADMIN_TOKEN is required.");

async function findDashboard() {
  await ensureStateRepository();
  const issues = await api(
    `/repos/${organization}/${STATE_REPOSITORY}/issues?state=open&per_page=100`,
  );
  const dashboard = issues.find(
    (issue) =>
      !issue.pull_request &&
      issue.body?.includes(REVIEW_DASHBOARD_MARKER),
  );
  if (!dashboard)
    throw new Error(
      "No private inactivity review dashboard was found. Run Monitor learner inactivity first.",
    );
  return dashboard;
}

function checkedUsernames(body) {
  const usernames = [];
  for (const match of String(body || "").matchAll(
    /^- \[[xX]\] @([a-z\d](?:[a-z\d-]{0,37}[a-z\d])?)/gim,
  )) {
    usernames.push(match[1]);
  }
  return [...new Set(usernames.map((value) => value.trim()).filter(Boolean))];
}

const dashboard = await findDashboard();
const clearMode = process.env.CLEAR_SELECTIONS === "1";

if (!clearMode) {
  const usernames = checkedUsernames(dashboard.body);
  if (!usernames.length)
    throw new Error(
      "No learners are selected. Tick at least one checkbox in the private inactivity review issue.",
    );
  if (usernames.length > 50)
    throw new Error("A maximum of 50 learners can be approved in one run.");

  const output = process.env.GITHUB_OUTPUT;
  if (!output) throw new Error("GITHUB_OUTPUT is required.");
  fs.appendFileSync(output, `usernames=${usernames.join(",")}\n`);
  fs.appendFileSync(output, `dashboard_url=${dashboard.html_url}\n`);
  console.log(`Selected ${usernames.length} learner(s) from the private review dashboard.`);
  process.exit(0);
}

const raw = String(process.env.STUDENT_USERNAMES || "").trim();
const completed = new Set(
  raw
    .split(/[\s,;]+/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);
if (!completed.size) process.exit(0);

const body = String(dashboard.body || "")
  .split("\n")
  .filter((line) => {
    const match = line.match(
      /^- \[[ xX]\] @([a-z\d](?:[a-z\d-]{0,37}[a-z\d])?)/i,
    );
    return !match || !completed.has(match[1].toLowerCase());
  })
  .join("\n")
  .replace(/\s+$/, "");

await api(
  `/repos/${organization}/${STATE_REPOSITORY}/issues/${dashboard.number}`,
  {
    method: "PATCH",
    body: JSON.stringify({ body }),
  },
);
console.log(`Cleared ${completed.size} completed selection(s) from the private review dashboard.`);
