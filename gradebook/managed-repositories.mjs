import { api, listRepositories, organization } from './curriculum-api.mjs';
import { installationToken } from './github-app.mjs';
import { listLearnerRegistryRecords } from './learner-registry.mjs';

export async function listManagedRepositories({ includeInactive = false } = {}) {
  const legacy = (await listRepositories()).map((repository) => ({
    ...repository,
    _highq: {
      ownership: 'organization',
      owner: organization,
      installationId: null,
      registry: null,
    },
  }));

  const records = await listLearnerRegistryRecords({ includeInactive });
  const learnerOwned = [];
  for (const record of records) {
    if (!record.repositoryOwner || !record.repositoryName || !record.installationId) continue;
    try {
      const authToken = await installationToken(record.installationId);
      const repository = await api(
        `/repos/${encodeURIComponent(record.repositoryOwner)}/${encodeURIComponent(record.repositoryName)}`,
        {},
        authToken,
      );
      learnerOwned.push({
        ...repository,
        _highq: {
          ownership: 'learner',
          owner: record.repositoryOwner,
          installationId: record.installationId,
          registry: record,
        },
      });
    } catch (error) {
      console.warn(
        `Could not load registered learner repository ${record.repositoryFullName || `${record.repositoryOwner}/${record.repositoryName}`}: ${error.message}`,
      );
    }
  }

  const seen = new Set();
  return [...legacy, ...learnerOwned].filter((repository) => {
    const fullName = String(repository.full_name || `${repository._highq.owner}/${repository.name}`).toLowerCase();
    if (seen.has(fullName)) return false;
    seen.add(fullName);
    return true;
  });
}

export function repositoryRegistryRecord(repository) {
  return repository?._highq?.registry || null;
}

export function isLearnerOwnedRepository(repository) {
  return repository?._highq?.ownership === 'learner';
}
