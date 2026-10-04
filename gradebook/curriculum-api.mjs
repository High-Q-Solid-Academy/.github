import process from 'node:process';
import { enrollmentPath } from './identity.mjs';
import {
  installationForUser,
  installationToken,
  installationTokenForUser,
} from './github-app.mjs';

export const organization = process.env.CURRICULUM_ORG || 'High-Q-Solid-Academy';
export const token = process.env.CURRICULUM_ADMIN_TOKEN;
export const apiBase = process.env.GITHUB_API_URL || 'https://api.github.com';

export async function api(route, options = {}, authToken = token) {
  if (!authToken) throw new Error(`Authentication token is required for ${route}.`);
  const response = await fetch(`${apiBase}${route}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2026-03-10',
      'User-Agent': 'highq-curriculum-progression',
      ...options.headers,
    },
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

export async function apiWithToken(authToken, route, options = {}) {
  return api(route, options, authToken);
}

export async function listRepositories() {
  const repositories = [];
  for (let page = 1; ; page += 1) {
    const batch = await api(`/orgs/${organization}/repos?type=all&per_page=100&page=${page}`);
    repositories.push(...batch);
    if (batch.length < 100) return repositories;
  }
}

export function repositoryOwner(repository) {
  return (
    repository?._highq?.owner ||
    repository?.repositoryOwner ||
    repository?.owner?.login ||
    organization
  );
}

export function repositoryFullName(repository) {
  return repository?.full_name || `${repositoryOwner(repository)}/${repository.name}`;
}

export async function repositoryToken(repository) {
  const owner = repositoryOwner(repository);
  if (owner.toLowerCase() === organization.toLowerCase()) return token;
  if (repository?._highq?.installationId) {
    return installationToken(repository._highq.installationId);
  }
  return (await installationTokenForUser(owner)).token;
}

export async function repoApi(repository, suffix = '', options = {}) {
  const owner = repositoryOwner(repository);
  const authToken = await repositoryToken(repository);
  return api(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository.name)}${suffix}`,
    options,
    authToken,
  );
}

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function waitForRepositoryReady(owner, repository, authToken = token) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const details = await api(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`,
        {},
        authToken,
      );
      const branch = details.default_branch || 'main';
      await api(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/ref/heads/${encodeURIComponent(branch)}`,
        {},
        authToken,
      );
      return branch;
    } catch (error) {
      if (![404, 409].includes(error.status)) throw error;
      await delay(1500);
    }
  }
  throw new Error(`${owner}/${repository} was created but its default branch did not become available in time.`);
}

export async function waitForTemplateReady(repository) {
  return waitForRepositoryReady(organization, repository, token);
}

export async function writeEnrollment(
  repository,
  enrollment,
  branch = 'main',
  options = {},
) {
  const owner = options.owner || organization;
  const authToken = options.authToken || token;
  const content = Buffer.from(`${JSON.stringify(enrollment, null, 2)}\n`).toString('base64');
  let sha = null;
  try {
    const existing = await api(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/contents/${enrollmentPath()}?ref=${encodeURIComponent(branch)}`,
      {},
      authToken,
    );
    sha = existing.sha;
  } catch (error) {
    if (error.status !== 404) throw error;
  }

  await api(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/contents/${enrollmentPath()}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        message: `${sha ? 'Update' : 'Record'} enrollment identity for ${enrollment.realName}`,
        content,
        branch,
        ...(sha ? { sha } : {}),
      }),
    },
    authToken,
  );
}

async function applyCourseProtection(owner, repository, branch, authToken) {
  let protection = 'enabled';
  try {
    await api(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/branches/${encodeURIComponent(branch)}/protection`,
      {
        method: 'PUT',
        body: JSON.stringify({
          required_status_checks: {
            strict: true,
            contexts: ['Calculate course score'],
          },
          enforce_admins: true,
          required_pull_request_reviews: {
            dismiss_stale_reviews: true,
            required_approving_review_count: 1,
          },
          restrictions: null,
          required_linear_history: true,
          allow_force_pushes: false,
          allow_deletions: false,
        }),
      },
      authToken,
    );
  } catch (error) {
    if (![403, 404, 422].includes(error.status)) throw error;
    protection = `unavailable (${error.status})`;
  }
  return protection;
}

export function learnerOwnedRepositoryName(course) {
  const base = String(course.template || course.id)
    .replace(/^course-/, '')
    .replace(/[^a-z0-9-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `highq-${base}`;
}

async function copyPrivateTemplateToLearnerRepository(
  course,
  targetOwner,
  targetRepository,
  targetToken,
  targetBranch,
) {
  const source = await api(`/repos/${organization}/${course.template}`);
  const sourceBranch = source.default_branch || 'main';
  const sourceRef = await api(
    `/repos/${organization}/${course.template}/git/ref/heads/${encodeURIComponent(sourceBranch)}`,
  );
  const sourceCommit = await api(
    `/repos/${organization}/${course.template}/git/commits/${sourceRef.object.sha}`,
  );
  const sourceTree = await api(
    `/repos/${organization}/${course.template}/git/trees/${sourceCommit.tree.sha}?recursive=1`,
  );
  if (sourceTree.truncated) {
    throw new Error(`${course.template} template tree is too large for safe learner provisioning.`);
  }

  const targetEntries = [];
  for (const item of sourceTree.tree.filter((entry) => entry.type === 'blob')) {
    const blob = await api(`/repos/${organization}/${course.template}/git/blobs/${item.sha}`);
    const created = await api(
      `/repos/${encodeURIComponent(targetOwner)}/${encodeURIComponent(targetRepository)}/git/blobs`,
      {
        method: 'POST',
        body: JSON.stringify({
          content: String(blob.content || '').replace(/\s/g, ''),
          encoding: 'base64',
        }),
      },
      targetToken,
    );
    targetEntries.push({
      path: item.path,
      mode: item.mode || '100644',
      type: 'blob',
      sha: created.sha,
    });
  }

  const targetTree = await api(
    `/repos/${encodeURIComponent(targetOwner)}/${encodeURIComponent(targetRepository)}/git/trees`,
    {
      method: 'POST',
      body: JSON.stringify({ tree: targetEntries }),
    },
    targetToken,
  );
  const currentRef = await api(
    `/repos/${encodeURIComponent(targetOwner)}/${encodeURIComponent(targetRepository)}/git/ref/heads/${encodeURIComponent(targetBranch)}`,
    {},
    targetToken,
  );
  const commit = await api(
    `/repos/${encodeURIComponent(targetOwner)}/${encodeURIComponent(targetRepository)}/git/commits`,
    {
      method: 'POST',
      body: JSON.stringify({
        message: `Start High Q course: ${course.course}`,
        tree: targetTree.sha,
        parents: [currentRef.object.sha],
      }),
    },
    targetToken,
  );
  await api(
    `/repos/${encodeURIComponent(targetOwner)}/${encodeURIComponent(targetRepository)}/git/refs/heads/${encodeURIComponent(targetBranch)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: false }),
    },
    targetToken,
  );
  return commit.sha;
}

export async function provisionLearnerOwnedCourse(
  course,
  student,
  apply,
  enrollment = null,
  options = {},
) {
  const repository = learnerOwnedRepositoryName(course);
  if (!apply) {
    return {
      repository,
      repositoryOwner: student,
      repositoryFullName: `${student}/${repository}`,
      ownership: 'learner',
      action: 'would-create',
    };
  }

  const installation = await installationForUser(student);
  const authToken = await installationToken(installation.id);

  try {
    await api(
      `/repos/${encodeURIComponent(student)}/${encodeURIComponent(repository)}`,
      {},
      authToken,
    );
    throw new Error(`${student}/${repository} already exists. High Q will not overwrite a learner-owned repository.`);
  } catch (error) {
    if (error.status !== 404) throw error;
  }

  const created = await api(
    '/user/repos',
    {
      method: 'POST',
      body: JSON.stringify({
        name: repository,
        description: `${course.course} — High Q learner-owned course repository`,
        private: true,
        auto_init: true,
        has_issues: true,
        has_projects: false,
        has_wiki: false,
        allow_merge_commit: true,
        allow_squash_merge: true,
        allow_rebase_merge: true,
      }),
    },
    authToken,
  );

  const owner = created.owner?.login || student;
  const branch = await waitForRepositoryReady(owner, repository, authToken);
  await copyPrivateTemplateToLearnerRepository(
    course,
    owner,
    repository,
    authToken,
    branch,
  );

  if (enrollment) {
    await writeEnrollment(repository, enrollment, branch, {
      owner,
      authToken,
    });
  }

  if (options.beforeProtect) {
    await options.beforeProtect({
      repository,
      owner,
      branch,
      authToken,
    });
  }

  const protection = await applyCourseProtection(
    owner,
    repository,
    branch,
    authToken,
  );

  return {
    repository,
    repositoryOwner: owner,
    repositoryFullName: `${owner}/${repository}`,
    ownership: 'learner',
    installationId: installation.id,
    action: 'created',
    protection,
    branch,
  };
}

export async function provisionCourse(
  course,
  student,
  apply,
  enrollment = null,
  options = {},
) {
  const repository = `${course.repositoryPrefix}${student}`;
  if (!apply) return { repository, action: 'would-create', ownership: 'organization' };

  await api(`/repos/${organization}/${course.template}/generate`, {
    method: 'POST',
    body: JSON.stringify({
      owner: organization,
      name: repository,
      description: `${course.course} — private learner repository for @${student}`,
      include_all_branches: false,
      private: true,
    }),
  });

  const branch = await waitForTemplateReady(repository);

  if (enrollment) {
    await writeEnrollment(repository, enrollment, branch);
  }

  if (options.beforeProtect) {
    await options.beforeProtect({ repository, owner: organization, branch, authToken: token });
  }

  await api(`/repos/${organization}/${repository}/collaborators/${student}`, {
    method: 'PUT',
    body: JSON.stringify({ permission: 'push' }),
  });

  const protection = await applyCourseProtection(
    organization,
    repository,
    branch,
    token,
  );
  return {
    repository,
    repositoryOwner: organization,
    repositoryFullName: `${organization}/${repository}`,
    ownership: 'organization',
    action: 'created',
    protection,
    branch,
  };
}
