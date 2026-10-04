import { api, listRepositories, organization } from './curriculum-api.mjs';
import { installationToken } from './github-app.mjs';
import { listLearnerRegistryRecords } from './learner-registry.mjs';

function repositoryDescriptors(record) {
  if (Array.isArray(record.repositories) && record.repositories.length) {
    return record.repositories;
  }
  if (!record.repositoryOwner || !record.repositoryName) return [];
  return [{
    courseId: record.currentCourseId || null,
    courseName: record.currentCourseName || null,
    repositoryOwner: record.repositoryOwner,
    repositoryName: record.repositoryName,
    repositoryFullName:
      record.repositoryFullName || `${record.repositoryOwner}/${record.repositoryName}`,
    defaultBranch: record.defaultBranch || 'main',
    state: 'current',
  }];
}

export async function listManagedRepositories({ includeInactive = false } = {}) {
  const legacy = (await listRepositories()).map((repository) => ({
    ...repository,
    _highq: {
      ownership: 'organization',
      owner: organization,
      installationId: null,
      registry: null,
      courseId: null,
      repositoryState: 'legacy',
    },
  }));

  const records = await listLearnerRegistryRecords({ includeInactive });
  const learnerOwned = [];
  for (const record of records) {
    if (!record.installationId) continue;
    const authToken = await installationToken(record.installationId);
    for (const descriptor of repositoryDescriptors(record)) {
      try {
        const repository = await api(
          `/repos/${encodeURIComponent(descriptor.repositoryOwner)}/${encodeURIComponent(descriptor.repositoryName)}`,
          {},
          authToken,
        );
        learnerOwned.push({
          ...repository,
          _highq: {
            ownership: 'learner',
            owner: descriptor.repositoryOwner,
            installationId: record.installationId,
            registry: record,
            courseId: descriptor.courseId || null,
            repositoryState: descriptor.state || 'historical',
          },
        });
      } catch (error) {
        console.warn(
          `Could not load registered learner repository ${descriptor.repositoryFullName || `${descriptor.repositoryOwner}/${descriptor.repositoryName}`}: ${error.message}`,
        );
      }
    }
  }

  const seen = new Set();
  return [...legacy, ...learnerOwned].filter((repository) => {
    const fullName = String(
      repository.full_name || `${repository._highq.owner}/${repository.name}`,
    ).toLowerCase();
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
