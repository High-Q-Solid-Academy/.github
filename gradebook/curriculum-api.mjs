import process from 'node:process';
import { enrollmentPath } from './identity.mjs';

export const organization = process.env.CURRICULUM_ORG || 'High-Q-Solid-Academy';
export const token = process.env.CURRICULUM_ADMIN_TOKEN;
export const apiBase = process.env.GITHUB_API_URL || 'https://api.github.com';

export async function api(route, options = {}) {
  const response = await fetch(`${apiBase}${route}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'highq-curriculum-progression',
      ...options.headers
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

export async function listRepositories() {
  const repositories = [];
  for (let page = 1; ; page += 1) {
    const batch = await api(`/orgs/${organization}/repos?type=all&per_page=100&page=${page}`);
    repositories.push(...batch);
    if (batch.length < 100) return repositories;
  }
}

export async function provisionCourse(course, student, apply, enrollment = null) {
  const repository = `${course.repositoryPrefix}${student}`;
  if (!apply) return { repository, action: 'would-create' };

  await api(`/repos/${organization}/${course.template}/generate`, {
    method: 'POST',
    body: JSON.stringify({
      owner: organization,
      name: repository,
      description: `${course.course} — private learner repository for @${student}`,
      include_all_branches: false,
      private: true
    })
  });

  let ready = false;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await api(`/repos/${organization}/${repository}`);
      ready = true;
      break;
    } catch (error) {
      if (error.status !== 404) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  if (!ready) throw new Error(`${repository} was created but did not become available in time`);

  if (enrollment) {
    const content = Buffer.from(`${JSON.stringify(enrollment, null, 2)}\n`).toString('base64');
    await api(`/repos/${organization}/${repository}/contents/${enrollmentPath()}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `Record enrollment identity for ${enrollment.realName}`,
        content,
        branch: 'main'
      })
    });
  }

  await api(`/repos/${organization}/${repository}/collaborators/${student}`, {
    method: 'PUT',
    body: JSON.stringify({ permission: 'push' })
  });

  let protection = 'enabled';
  try {
    await api(`/repos/${organization}/${repository}/branches/main/protection`, {
      method: 'PUT',
      body: JSON.stringify({
        required_status_checks: {
          strict: true,
          contexts: ['Calculate course score']
        },
        enforce_admins: true,
        required_pull_request_reviews: {
          dismiss_stale_reviews: true,
          require_code_owner_reviews: true,
          required_approving_review_count: 1
        },
        restrictions: null,
        required_linear_history: true,
        allow_force_pushes: false,
        allow_deletions: false
      })
    });
  } catch (error) {
    if (![403, 404].includes(error.status)) throw error;
    protection = `unavailable (${error.status})`;
  }
  return { repository, action: 'created', protection };
}
