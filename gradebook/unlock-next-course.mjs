import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  api,
  learnerOwnedRepositoryName,
  organization,
  provisionCourse,
  provisionLearnerOwnedCourse,
  token,
  writeEnrollment,
} from './curriculum-api.mjs';
import { installationToken } from './github-app.mjs';
import { enrollmentTrack } from './identity.mjs';
import {
  courseGrade,
  matchCourse,
  repositoryEnrollment,
} from './inactivity-lib.mjs';
import {
  isLearnerOwnedRepository,
  listManagedRepositories,
} from './managed-repositories.mjs';
import { writeLearnerRegistryRecord } from './learner-registry.mjs';

if (!token) {
  console.error('CURRICULUM_ADMIN_TOKEN is required.');
  process.exit(1);
}

const apply = process.env.APPLY_UNLOCKS === 'true';
const curriculum = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, 'courses.json'), 'utf8'),
);
const courses = curriculum.courses;
const courseById = new Map(courses.map((course) => [course.id, course]));
const repositories = await listManagedRepositories();
const legacyRepositoryNames = new Set(
  repositories
    .filter((repository) => !isLearnerOwnedRepository(repository))
    .map((repository) => repository.name),
);
const results = [];

function currentRepositoryHistory(record, repository, course) {
  if (Array.isArray(record.repositories) && record.repositories.length) {
    return record.repositories.map((item) => ({ ...item }));
  }
  return [{
    courseId: course.id,
    courseName: course.course,
    repositoryOwner: repository._highq.owner,
    repositoryName: repository.name,
    repositoryFullName: repository.full_name,
    defaultBranch: repository.default_branch,
    state: 'current',
    startedAt: record.enrolledAt || new Date().toISOString(),
  }];
}

for (const repository of repositories) {
  const learnerOwned = isLearnerOwnedRepository(repository);
  if (learnerOwned && repository._highq.repositoryState !== 'current') continue;

  const current = matchCourse(repository, courses);
  if (!current) continue;

  const enrollment = await repositoryEnrollment(repository, current);
  const track = enrollmentTrack(enrollment);
  const trackDefinition = curriculum.tracks?.[track];
  const repositoryStudent = learnerOwned
    ? repository._highq.registry?.githubLogin || enrollment.githubLoginAtEnrollment
    : repository.name.slice(current.repositoryPrefix.length);

  if (!trackDefinition) {
    results.push({
      student: repositoryStudent,
      realName: enrollment.realName,
      track,
      ownership: learnerOwned ? 'learner' : 'academy',
      passed: current.course,
      score: null,
      humanScore: null,
      unlocked: 'none',
      action: 'invalid-track',
      protection: 'not applicable',
    });
    continue;
  }

  const index = trackDefinition.courses.indexOf(current.id);
  if (index < 0 || index >= trackDefinition.courses.length - 1) continue;
  const nextId = trackDefinition.courses[index + 1];
  const next = courseById.get(nextId);
  if (!next) throw new Error(`Track ${track} references missing course ${nextId}.`);

  const currentUser = await api(`/user/${enrollment.githubId}`);
  const student = currentUser.login;

  if (!learnerOwned && legacyRepositoryNames.has(`${next.repositoryPrefix}${student}`)) {
    continue;
  }

  if (learnerOwned) {
    const record = repository._highq.registry;
    if (record?.currentCourseId && record.currentCourseId !== current.id) continue;
    const known = (record?.repositories || []).some(
      (item) => item.courseId === next.id && item.state !== 'removed',
    );
    if (known) continue;
  }

  const grade = await courseGrade(repository, current);
  const score = Number(grade.score ?? -1);
  if (grade.automatedState !== 'success' || score < current.passScore) continue;

  let humanScore = null;
  if (current.humanReviewRequired) {
    humanScore = Number(grade.humanScore ?? -1);
    if (grade.humanState !== 'success' || humanScore < (current.humanPassScore || 70)) {
      results.push({
        student,
        realName: enrollment.realName,
        track,
        ownership: learnerOwned ? 'learner' : 'academy',
        passed: current.course,
        score,
        humanScore: humanScore >= 0 ? humanScore : null,
        unlocked: next.course,
        action: 'waiting-for-human-review',
        protection: 'not applicable',
      });
      continue;
    }
  }

  if (learnerOwned) {
    const record = repository._highq.registry;
    const provisionalEnrollment = {
      ...enrollment,
      schemaVersion: Math.max(Number(enrollment.schemaVersion || 0), 4),
      track,
      ownership: 'learner',
    };
    const outcome = await provisionLearnerOwnedCourse(
      next,
      student,
      apply,
      provisionalEnrollment,
    );

    if (apply) {
      const authToken = await installationToken(outcome.installationId);
      const finalEnrollment = {
        ...provisionalEnrollment,
        installationId: outcome.installationId,
        repositoryOwner: outcome.repositoryOwner,
        repositoryName: outcome.repository,
        repositoryFullName: outcome.repositoryFullName,
      };
      await writeEnrollment(
        outcome.repository,
        finalEnrollment,
        outcome.branch,
        { owner: outcome.repositoryOwner, authToken },
      );

      const history = currentRepositoryHistory(record, repository, current).map(
        (item) =>
          item.courseId === current.id && item.state === 'current'
            ? {
                ...item,
                state: 'completed',
                completedAt: new Date().toISOString(),
                finalAutomatedScore: score,
                finalHumanScore: humanScore,
              }
            : item,
      );
      history.push({
        courseId: next.id,
        courseName: next.course,
        repositoryOwner: outcome.repositoryOwner,
        repositoryName: outcome.repository,
        repositoryFullName: outcome.repositoryFullName,
        defaultBranch: outcome.branch,
        state: 'current',
        startedAt: new Date().toISOString(),
      });

      await writeLearnerRegistryRecord({
        ...record,
        status: 'active',
        githubLogin: student,
        track,
        currentCourseId: next.id,
        currentCourseName: next.course,
        repositoryOwner: outcome.repositoryOwner,
        repositoryName: outcome.repository,
        repositoryFullName: outcome.repositoryFullName,
        defaultBranch: outcome.branch,
        installationId: outcome.installationId,
        enrollment: finalEnrollment,
        repositories: history,
      });
    }

    results.push({
      student,
      realName: enrollment.realName,
      track,
      ownership: 'learner',
      passed: current.course,
      score,
      humanScore,
      unlocked: next.course,
      expectedRepository: `${student}/${learnerOwnedRepositoryName(next)}`,
      ...outcome,
    });
    continue;
  }

  const normalizedEnrollment = {
    ...enrollment,
    schemaVersion: Math.max(Number(enrollment.schemaVersion || 0), 4),
    track,
    ownership: 'organization',
  };
  const outcome = await provisionCourse(
    next,
    student,
    apply,
    normalizedEnrollment,
  );
  results.push({
    student,
    realName: enrollment.realName,
    track,
    ownership: 'academy',
    passed: current.course,
    score,
    humanScore,
    unlocked: next.course,
    ...outcome,
  });
  legacyRepositoryNames.add(outcome.repository);
}

const lines = results
  .map(
    (item) =>
      `| ${item.realName} (@${item.student}) | ${item.track} | ${item.ownership} | ${item.passed} | ${item.score === null ? '—' : `${item.score}/100`} | ${item.humanScore === null ? 'not required or pending' : `${item.humanScore}/100`} | ${item.unlocked} | ${item.action} | ${item.protection || 'not applicable'} |`,
  )
  .join('\n');
const summary = `# Curriculum progression\n\nMode: **${apply ? 'APPLY' : 'DRY RUN'}**\n\n| Learner | Programme | Repo owner | Passed | Auto score | Human capstone | Next course | Result | Main protection |\n| --- | --- | --- | --- | ---: | ---: | --- | --- | --- |\n${lines || '| — | — | — | No new qualifying learners | — | — | — | no change | — |'}\n`;
if (process.env.GITHUB_STEP_SUMMARY)
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
console.log(summary);
