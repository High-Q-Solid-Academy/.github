import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { decodeEnrollment, enrollmentPath, normalizeName } from './identity.mjs';

const organization = process.env.GRADEBOOK_ORG || 'High-Q-Solid-Academy';
const token = process.env.GRADEBOOK_TOKEN;
const apiBase = process.env.GITHUB_API_URL || 'https://api.github.com';
const root = path.resolve(import.meta.dirname, '..');
const courses = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'courses.json'), 'utf8'));

if (!token) {
  console.error('GRADEBOOK_TOKEN is required. Add it as an Actions repository secret.');
  process.exit(1);
}

async function api(route) {
  const response = await fetch(`${apiBase}${route}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'highq-gradebook'
    }
  });
  if (response.status === 204) return null;
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(`${response.status} ${response.statusText}: ${route}${body?.message ? ` — ${body.message}` : ''}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

async function listRepositories() {
  const repositories = [];
  for (let page = 1; ; page += 1) {
    const batch = await api(`/orgs/${organization}/repos?type=all&per_page=100&page=${page}`);
    repositories.push(...batch);
    if (batch.length < 100) return repositories;
  }
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function resolveIdentity(repository, definition) {
  const repositoryLogin = repository.name.slice(definition.repositoryPrefix.length) || 'unknown';
  try {
    const file = await api(`/repos/${organization}/${repository.name}/contents/${enrollmentPath()}?ref=${repository.default_branch}`);
    const enrollment = decodeEnrollment(file.content);
    const currentUser = await api(`/user/${enrollment.githubId}`);
    const nameMatches = normalizeName(currentUser.name) === normalizeName(enrollment.realName);
    return {
      realName: enrollment.realName,
      githubId: enrollment.githubId,
      student: currentUser.login,
      profileName: currentUser.name,
      identityState: nameMatches ? 'verified' : 'profile-name-mismatch'
    };
  } catch (error) {
    if (error.status !== 404) throw error;
    const user = await api(`/users/${repositoryLogin}`);
    return {
      realName: user.name || user.login,
      githubId: user.id,
      student: user.login,
      profileName: user.name,
      identityState: user.name ? 'legacy-unregistered' : 'missing-profile-name'
    };
  }
}

const repositories = await listRepositories();
const rows = [];

for (const repository of repositories) {
  const definition = courses.find((course) => repository.name.startsWith(course.repositoryPrefix));
  if (!definition) continue;

  try {
    const identity = await resolveIdentity(repository, definition);
    const status = await api(`/repos/${organization}/${repository.name}/commits/${repository.default_branch}/status`);
    const gradeStatus = status.statuses.find((item) => item.context === 'highq/autograding');
    const match = gradeStatus?.description?.match(/(\d+)\s*\/\s*100/);
    const score = match ? Number(match[1]) : null;
    rows.push({
      order: definition.order,
      course: definition.course,
      passScore: definition.passScore,
      ...identity,
      repository: repository.name,
      score,
      passed: Number.isFinite(score) && gradeStatus?.state === 'success' && score >= definition.passScore,
      state: gradeStatus?.state || 'not-graded',
      updatedAt: gradeStatus?.updated_at || repository.updated_at,
      url: repository.html_url,
      detailsUrl: gradeStatus?.target_url || `${repository.html_url}/actions`
    });
  } catch (error) {
    rows.push({
      order: definition.order,
      course: definition.course,
      passScore: definition.passScore,
      realName: 'Identity unavailable',
      student: repository.name.slice(definition.repositoryPrefix.length) || 'unknown',
      githubId: null,
      identityState: 'error',
      repository: repository.name,
      score: null,
      passed: false,
      state: 'error',
      updatedAt: repository.updated_at,
      url: repository.html_url,
      detailsUrl: repository.html_url,
      error: error.message
    });
  }
}

rows.sort((a, b) => a.realName.localeCompare(b.realName) || a.order - b.order);
fs.writeFileSync(path.join(root, 'gradebook.json'), `${JSON.stringify({ organization, generatedAt: new Date().toISOString(), rows }, null, 2)}\n`);

const headers = ['Real Name', 'GitHub Username', 'GitHub ID', 'Identity', 'Course', 'Repository', 'Score', 'Pass Mark', 'Passed', 'State', 'Updated At', 'Repository URL', 'Details URL'];
const csvRows = rows.map((row) => [row.realName, row.student, row.githubId ?? '', row.identityState, row.course, row.repository, row.score ?? '', row.passScore, row.passed ? 'Yes' : 'No', row.state, row.updatedAt, row.url, row.detailsUrl]);
fs.writeFileSync(path.join(root, 'gradebook.csv'), `${[headers, ...csvRows].map((row) => row.map(csvCell).join(',')).join('\n')}\n`);

const scored = rows.filter((row) => Number.isFinite(row.score));
const average = scored.length ? Math.round(scored.reduce((sum, row) => sum + row.score, 0) / scored.length) : 0;
const tableRows = rows.slice(0, 100).map((row) =>
  `| ${row.realName} | [@${row.student}](${row.url}) | ${row.course} | ${row.score ?? '—'}/100 | ${row.passed ? 'Passed' : row.state} | ${row.identityState} | [Details](${row.detailsUrl}) |`
).join('\n');
const summary = `# High Q instructor gradebook

**${new Set(rows.map((row) => row.githubId || row.student)).size} learners** · **${rows.length} course repositories** · **${scored.length} graded** · **${average}% average**

| Real name | GitHub | Course | Score | Result | Identity | Run |
| --- | --- | --- | ---: | --- | --- | --- |
${tableRows || '| — | — | No matching learner repositories found | — | — | — | — |'}

Download the print-ready HTML, CSV, or JSON from this run's **Artifacts** section. Identity warnings require instructor review.
`;

if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
console.log(summary);
