import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { api, listRepositories, organization, token, writeEnrollment } from './curriculum-api.mjs';
import { buildEnrollment, enrollmentPath } from './identity.mjs';

if (!token) {
  console.error('CURRICULUM_ADMIN_TOKEN is required.');
  process.exit(1);
}

const apply = String(process.env.APPLY || '').toLowerCase() === 'true';
const courses = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'courses.json'), 'utf8'));
const prefixes = courses.map((course) => course.repositoryPrefix);
const repositories = (await listRepositories()).filter((repository) =>
  prefixes.some((prefix) => repository.name.startsWith(prefix) && repository.name.length > prefix.length)
);

let repaired = 0;
let skipped = 0;
for (const repository of repositories) {
  try {
    await api(`/repos/${organization}/${repository.name}/contents/${enrollmentPath()}?ref=${repository.default_branch}`);
    console.log(`SKIP ${repository.name}: enrollment record already exists.`);
    skipped += 1;
    continue;
  } catch (error) {
    if (error.status !== 404) throw error;
  }

  const prefix = prefixes.find((value) => repository.name.startsWith(value));
  const username = repository.name.slice(prefix.length);
  const user = await api(`/users/${username}`);
  if (!user.name || user.name.trim().split(/\s+/).length < 2) {
    console.log(`SKIP ${repository.name}: @${username} has no usable public real name.`);
    skipped += 1;
    continue;
  }

  const enrollment = buildEnrollment(user, user.name);
  if (!apply) {
    console.log(`WOULD_REPAIR ${repository.name}: ${enrollmentPath()} for @${username}.`);
    continue;
  }

  await writeEnrollment(repository.name, enrollment, repository.default_branch);
  console.log(`REPAIRED ${repository.name}: ${enrollmentPath()} committed to ${repository.default_branch}.`);
  repaired += 1;
}

console.log(`${apply ? 'Completed' : 'Dry run complete'}: ${repaired} repaired, ${skipped} skipped, ${repositories.length} learner repositories checked.`);
