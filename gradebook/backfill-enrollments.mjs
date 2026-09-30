import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { api, listRepositories, token, writeEnrollment } from './curriculum-api.mjs';
import { buildEnrollment, decodeEnrollment, DEFAULT_TRACK, enrollmentPath, normalizeTrack } from './identity.mjs';

if (!token) {
  console.error('CURRICULUM_ADMIN_TOKEN is required.');
  process.exit(1);
}

const apply = String(process.env.APPLY || '').toLowerCase() === 'true';
const curriculum = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'courses.json'), 'utf8'));
const prefixes = curriculum.courses.map((course) => course.repositoryPrefix);
const repositories = (await listRepositories()).filter((repository) =>
  prefixes.some((prefix) => repository.name.startsWith(prefix) && repository.name.length > prefix.length)
);

let repaired = 0;
let migrated = 0;
let skipped = 0;
let reviewRequired = 0;

for (const repository of repositories) {
  let existingFile = null;
  try {
    existingFile = await api(`/repos/${process.env.CURRICULUM_ORG || 'High-Q-Solid-Academy'}/${repository.name}/contents/${enrollmentPath()}?ref=${repository.default_branch}`);
  } catch (error) {
    if (error.status !== 404) throw error;
  }

  if (existingFile) {
    const enrollment = decodeEnrollment(existingFile.content);
    if (enrollment.track) {
      try {
        normalizeTrack(enrollment.track);
        console.log(`SKIP ${repository.name}: programme already recorded as ${enrollment.track}.`);
        skipped += 1;
      } catch {
        console.log(`REVIEW ${repository.name}: invalid existing programme value "${enrollment.track}"; not changed automatically.`);
        reviewRequired += 1;
      }
      continue;
    }

    const migratedEnrollment = {
      ...enrollment,
      schemaVersion: 2,
      track: DEFAULT_TRACK,
      legacyTrackDefaultedAt: new Date().toISOString()
    };
    if (!apply) {
      console.log(`WOULD_MIGRATE ${repository.name}: legacy enrollment -> ${DEFAULT_TRACK}.`);
      continue;
    }
    await writeEnrollment(repository.name, migratedEnrollment, repository.default_branch);
    console.log(`MIGRATED ${repository.name}: existing learner assigned to ${DEFAULT_TRACK}.`);
    migrated += 1;
    continue;
  }

  const prefix = prefixes.find((value) => repository.name.startsWith(value));
  const username = repository.name.slice(prefix.length);
  const user = await api(`/users/${username}`);
  if (!user.name || user.name.trim().split(/\s+/).length < 2) {
    console.log(`SKIP ${repository.name}: @${username} has no usable public real name.`);
    skipped += 1;
    continue;
  }

  const enrollment = buildEnrollment(user, user.name, DEFAULT_TRACK);
  if (!apply) {
    console.log(`WOULD_REPAIR ${repository.name}: create ${enrollmentPath()} for @${username} as ${DEFAULT_TRACK}.`);
    continue;
  }

  await writeEnrollment(repository.name, enrollment, repository.default_branch);
  console.log(`REPAIRED ${repository.name}: ${enrollmentPath()} committed with ${DEFAULT_TRACK}.`);
  repaired += 1;
}

console.log(`${apply ? 'Completed' : 'Dry run complete'}: ${repaired} repaired, ${migrated} migrated to ${DEFAULT_TRACK}, ${skipped} already safe/skipped, ${reviewRequired} require review, ${repositories.length} learner repositories checked.`);
