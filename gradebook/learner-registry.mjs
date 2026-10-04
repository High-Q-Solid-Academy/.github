import { api, organization } from './curriculum-api.mjs';

export const LEARNER_REGISTRY_REPOSITORY =
  process.env.HIGHQ_STATE_REPOSITORY || 'highq-learner-records';

export function learnerRegistryPath(githubId) {
  return `active/${githubId}.json`;
}

export async function ensureLearnerRegistry() {
  try {
    const repository = await api(`/repos/${organization}/${LEARNER_REGISTRY_REPOSITORY}`);
    if (!repository.has_issues) {
      await api(`/repos/${organization}/${LEARNER_REGISTRY_REPOSITORY}`, {
        method: 'PATCH',
        body: JSON.stringify({ has_issues: true }),
      });
      repository.has_issues = true;
    }
    return repository;
  } catch (error) {
    if (error.status !== 404) throw error;
  }

  return api(`/orgs/${organization}/repos`, {
    method: 'POST',
    body: JSON.stringify({
      name: LEARNER_REGISTRY_REPOSITORY,
      description: 'Private High Q learner repository registry, pause and resume state',
      private: true,
      auto_init: true,
      has_issues: true,
      has_projects: false,
      has_wiki: false,
    }),
  });
}

async function registryBranch() {
  const repository = await ensureLearnerRegistry();
  return repository.default_branch || 'main';
}

async function writeRegistryJson(path, value, message) {
  const branch = await registryBranch();
  let sha;
  try {
    const existing = await api(
      `/repos/${organization}/${LEARNER_REGISTRY_REPOSITORY}/contents/${path}?ref=${encodeURIComponent(branch)}`,
    );
    sha = existing.sha;
  } catch (error) {
    if (error.status !== 404) throw error;
  }

  await api(`/repos/${organization}/${LEARNER_REGISTRY_REPOSITORY}/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({
      message,
      branch,
      content: Buffer.from(`${JSON.stringify(value, null, 2)}\n`).toString('base64'),
      ...(sha ? { sha } : {}),
    }),
  });
  return value;
}

export async function writeLearnerRegistryRecord(record) {
  if (!Number.isFinite(Number(record.githubId))) {
    throw new Error('Learner registry records require a numeric githubId.');
  }
  const normalized = {
    schemaVersion: 1,
    status: 'active',
    ownership: 'learner',
    ...record,
    githubId: Number(record.githubId),
    updatedAt: new Date().toISOString(),
  };
  return writeRegistryJson(
    learnerRegistryPath(normalized.githubId),
    normalized,
    `Update learner-owned repository registry for GitHub ID ${normalized.githubId}`,
  );
}

export async function readLearnerRegistryRecord(githubId) {
  const branch = await registryBranch();
  const file = await api(
    `/repos/${organization}/${LEARNER_REGISTRY_REPOSITORY}/contents/${learnerRegistryPath(githubId)}?ref=${encodeURIComponent(branch)}`,
  );
  return JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
}

export async function tryReadLearnerRegistryRecord(githubId) {
  try {
    return await readLearnerRegistryRecord(githubId);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

export async function listLearnerRegistryRecords({ includeInactive = false } = {}) {
  const branch = await registryBranch();
  let files;
  try {
    files = await api(
      `/repos/${organization}/${LEARNER_REGISTRY_REPOSITORY}/contents/active?ref=${encodeURIComponent(branch)}`,
    );
  } catch (error) {
    if (error.status === 404) return [];
    throw error;
  }

  const records = [];
  for (const item of files.filter((entry) => entry.type === 'file' && entry.name.endsWith('.json'))) {
    const file = await api(
      `/repos/${organization}/${LEARNER_REGISTRY_REPOSITORY}/contents/${item.path}?ref=${encodeURIComponent(branch)}`,
    );
    const record = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
    if (includeInactive || record.status === 'active') records.push(record);
  }
  return records;
}

export async function findLearnerRegistryRecordByLogin(login, options = {}) {
  const normalized = String(login || '').trim().toLowerCase();
  const records = await listLearnerRegistryRecords(options);
  return records.find((record) =>
    [record.githubLogin, record.githubLoginAtEnrollment]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase() === normalized),
  ) || null;
}

export async function updateLearnerRegistryStatus(githubId, status, extra = {}) {
  const current = await readLearnerRegistryRecord(githubId);
  return writeLearnerRegistryRecord({
    ...current,
    ...extra,
    status,
  });
}
