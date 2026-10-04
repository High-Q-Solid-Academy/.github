import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  api,
  organization,
  repoApi,
  repositoryFullName,
  token,
} from './curriculum-api.mjs';
import {
  enrollmentTrack,
  normalizeName,
} from './identity.mjs';
import {
  matchCourse,
  repositoryEnrollment,
} from './inactivity-lib.mjs';
import { listManagedRepositories } from './managed-repositories.mjs';

const root = path.resolve(import.meta.dirname, '..');
const curriculum = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, 'courses.json'), 'utf8'),
);
const courses = curriculum.courses;

if (!token) {
  console.error('CURRICULUM_ADMIN_TOKEN is required for the unified gradebook.');
  process.exit(1);
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function resolveIdentity(repository, definition) {
  const enrollment = await repositoryEnrollment(repository, definition);
  const currentUser = await api(`/user/${enrollment.githubId}`);
  const nameMatches =
    normalizeName(currentUser.name) === normalizeName(enrollment.realName);
  return {
    enrollment,
    realName: enrollment.realName,
    email: enrollment.email || null,
    githubId: enrollment.githubId,
    student: currentUser.login,
    profileName: currentUser.name,
    track: enrollmentTrack(enrollment),
    ownership: repository?._highq?.ownership || 'organization',
    identityState: nameMatches ? 'verified' : 'profile-name-mismatch',
  };
}

const repositories = await listManagedRepositories({ includeInactive: true });
const rows = [];

for (const repository of repositories) {
  const definition = matchCourse(repository, courses);
  if (!definition) continue;

  try {
    const identity = await resolveIdentity(repository, definition);
    const trackDefinition = curriculum.tracks[identity.track];
    const orderIndex = trackDefinition?.courses?.indexOf(definition.id) ?? -1;
    const status = await repoApi(
      repository,
      `/commits/${encodeURIComponent(repository.default_branch)}/status`,
    );
    const issues = repository.has_issues
      ? await repoApi(repository, '/issues?state=open&per_page=100')
      : [];
    const inactivityIssue = issues.find(
      (item) =>
        !item.pull_request &&
        item.body?.includes('<!-- highq-inactivity-monitor -->'),
    );
    const activityState = inactivityIssue
      ? inactivityIssue.title === 'INACTIVE — DISENROLLMENT REVIEW'
        ? 'disenrollment-review'
        : 'inactive-warning'
      : repository?._highq?.registry?.status === 'paused'
        ? 'paused'
        : 'active';

    const gradeStatus =
      status.statuses.find((item) => item.context === 'highq/official-grade') ||
      status.statuses.find((item) => item.context === 'highq/autograding');
    const humanStatus = status.statuses.find(
      (item) => item.context === 'highq/human-capstone',
    );
    const match = gradeStatus?.description?.match(/(\d+)\s*\/\s*100/);
    const score = match ? Number(match[1]) : null;
    const humanMatch = humanStatus?.description?.match(/(\d+)\s*\/\s*100/);
    const humanScore = humanMatch ? Number(humanMatch[1]) : null;
    const automatedPassed =
      Number.isFinite(score) &&
      gradeStatus?.state === 'success' &&
      score >= definition.passScore;
    const humanPassed =
      !definition.humanReviewRequired ||
      (Number.isFinite(humanScore) &&
        humanStatus?.state === 'success' &&
        humanScore >= (definition.humanPassScore || 70));
    const finalScore = definition.humanReviewRequired
      ? Number.isFinite(score) && Number.isFinite(humanScore)
        ? Math.round((score + humanScore) / 2)
        : null
      : score;

    rows.push({
      order: orderIndex >= 0 ? orderIndex + 1 : 999,
      course: definition.course,
      courseId: definition.id,
      passScore: definition.passScore,
      programme: trackDefinition?.name || identity.track,
      ...identity,
      repository: repositoryFullName(repository),
      repositoryName: repository.name,
      repositoryState: repository?._highq?.repositoryState || 'legacy',
      score,
      automatedContext: gradeStatus?.context || null,
      automatedPassed,
      humanReviewRequired: Boolean(definition.humanReviewRequired),
      humanScore,
      humanState:
        humanStatus?.state ||
        (definition.humanReviewRequired ? 'not-submitted' : 'not-required'),
      humanPassed,
      finalScore,
      passed: automatedPassed && humanPassed,
      state: gradeStatus?.state || 'not-graded',
      activityState,
      updatedAt: gradeStatus?.updated_at || repository.updated_at,
      url: repository.html_url,
      detailsUrl: gradeStatus?.target_url || `${repository.html_url}/actions`,
    });
  } catch (error) {
    rows.push({
      order: 999,
      course: definition.course,
      courseId: definition.id,
      passScore: definition.passScore,
      programme: 'Unknown',
      track: 'unknown',
      realName: 'Identity unavailable',
      student:
        repository?._highq?.registry?.githubLogin ||
        repository.name.slice(definition.repositoryPrefix.length) ||
        'unknown',
      githubId: null,
      ownership: repository?._highq?.ownership || 'organization',
      identityState: 'error',
      repository: repositoryFullName(repository),
      repositoryName: repository.name,
      repositoryState: repository?._highq?.repositoryState || 'legacy',
      score: null,
      automatedContext: null,
      automatedPassed: false,
      humanReviewRequired: Boolean(definition.humanReviewRequired),
      humanScore: null,
      humanState: definition.humanReviewRequired ? 'error' : 'not-required',
      humanPassed: !definition.humanReviewRequired,
      finalScore: null,
      passed: false,
      state: 'error',
      activityState: 'unknown',
      updatedAt: repository.updated_at,
      url: repository.html_url,
      detailsUrl: repository.html_url,
      error: error.message,
    });
  }
}

rows.sort(
  (a, b) =>
    a.realName.localeCompare(b.realName) ||
    a.track.localeCompare(b.track) ||
    a.order - b.order,
);
fs.writeFileSync(
  path.join(root, 'gradebook.json'),
  `${JSON.stringify({ organization, generatedAt: new Date().toISOString(), rows }, null, 2)}\n`,
);

const headers = [
  'Real Name',
  'GitHub Username',
  'GitHub ID',
  'Programme',
  'Repo Ownership',
  'Identity',
  'Course',
  'Repository',
  'Automated Score',
  'Automated Context',
  'Human Score',
  'Final Score',
  'Pass Mark',
  'Passed',
  'Automated State',
  'Human State',
  'Activity State',
  'Updated At',
  'Repository URL',
  'Details URL',
];
const csvRows = rows.map((row) => [
  row.realName,
  row.student,
  row.githubId ?? '',
  row.programme,
  row.ownership,
  row.identityState,
  row.course,
  row.repository,
  row.score ?? '',
  row.automatedContext ?? '',
  row.humanScore ?? '',
  row.finalScore ?? '',
  row.passScore,
  row.passed ? 'Yes' : 'No',
  row.state,
  row.humanState,
  row.activityState,
  row.updatedAt,
  row.url,
  row.detailsUrl,
]);
fs.writeFileSync(
  path.join(root, 'gradebook.csv'),
  `${[headers, ...csvRows]
    .map((row) => row.map(csvCell).join(','))
    .join('\n')}\n`,
);

const scored = rows.filter((row) => Number.isFinite(row.finalScore));
const average = scored.length
  ? Math.round(
      scored.reduce((sum, row) => sum + row.finalScore, 0) / scored.length,
    )
  : 0;
const tableRows = rows
  .slice(0, 100)
  .map(
    (row) =>
      `| ${row.realName} | [@${row.student}](${row.url}) | ${row.programme} | ${row.ownership === 'learner' ? 'learner' : 'academy'} | ${row.course} | ${row.score ?? '—'} | ${row.humanReviewRequired ? row.humanScore ?? 'pending' : 'not required'} | ${row.finalScore ?? '—'} | ${row.passed ? 'Passed' : 'In progress'} | ${row.activityState} | ${row.identityState} | [Details](${row.detailsUrl}) |`,
  )
  .join('\n');
const summary = `# High Q instructor gradebook\n\n**${new Set(rows.map((row) => row.githubId || row.student)).size} learners** · **${rows.length} course repositories** · **${scored.length} graded** · **${average}% average**\n\n| Real name | GitHub | Programme | Repo owner | Course | Auto | Human | Final | Result | Activity | Identity | Run |\n| --- | --- | --- | --- | --- | ---: | ---: | ---: | --- | --- | --- | --- |\n${tableRows || '| — | — | — | — | No matching learner repositories found | — | — | — | — | — | — | — |'}\n\nDownload the print-ready HTML, CSV, or JSON from this run's **Artifacts** section. Identity and activity warnings require instructor review.\n`;

if (process.env.GITHUB_STEP_SUMMARY)
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
console.log(summary);
