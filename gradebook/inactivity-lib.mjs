import fs from 'node:fs';
import path from 'node:path';
import {
  api,
  organization,
  repoApi,
  repositoryOwner,
  waitForTemplateReady,
} from './curriculum-api.mjs';
import {
  buildEnrollment,
  decodeEnrollment,
  enrollmentPath,
  enrollmentTrack,
} from './identity.mjs';
import { listManagedRepositories } from './managed-repositories.mjs';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const WARNING_DAYS = 4;
export const REVIEW_DAYS = 5;
export const STATE_REPOSITORY =
  process.env.HIGHQ_STATE_REPOSITORY || 'highq-learner-records';
export const INACTIVITY_MARKER = '<!-- highq-inactivity-monitor -->';
const SNAPSHOT_LIMIT_BYTES = 650 * 1024;
const sourceExtensions = new Set([
  '.html', '.css', '.js', '.jsx', '.ts', '.tsx', '.php', '.py', '.c', '.cc',
  '.cpp', '.h', '.hpp', '.ino', '.v', '.sv', '.md', '.json',
]);
const unfinishedPattern = /TODO Instructions|\[Replace with|TODO:/i;

export function loadCurriculum() {
  return JSON.parse(
    fs.readFileSync(path.join(import.meta.dirname, 'courses.json'), 'utf8'),
  );
}

export function matchCourse(repositoryOrName, courses) {
  const repository =
    typeof repositoryOrName === 'string' ? null : repositoryOrName;
  const registryCourseId = repository?._highq?.registry?.currentCourseId;
  if (registryCourseId) {
    return courses.find((course) => course.id === registryCourseId) || null;
  }
  const repositoryName =
    typeof repositoryOrName === 'string' ? repositoryOrName : repositoryOrName?.name;
  return courses.find(
    (course) =>
      repositoryName?.startsWith(course.repositoryPrefix) &&
      repositoryName.length > course.repositoryPrefix.length,
  ) || null;
}

export async function repositoryEnrollment(repository, course) {
  const registryEnrollment = repository?._highq?.registry?.enrollment;
  try {
    const file = await repoApi(
      repository,
      `/contents/${enrollmentPath()}?ref=${encodeURIComponent(repository.default_branch)}`,
    );
    return decodeEnrollment(file.content);
  } catch (error) {
    if (error.status !== 404) throw error;
    if (registryEnrollment) return registryEnrollment;
    const login = repository.name.slice(course.repositoryPrefix.length);
    const user = await api(`/users/${login}`);
    return buildEnrollment(user, user.name || user.login);
  }
}

function automatedGrade(statuses) {
  return (
    statuses.find((status) => status.context === 'highq/official-grade') ||
    statuses.find((status) => status.context === 'highq/autograding')
  );
}

export async function coursePassed(repository, course) {
  const combined = await repoApi(
    repository,
    `/commits/${encodeURIComponent(repository.default_branch)}/status`,
  );
  const grade = automatedGrade(combined.statuses);
  const score = Number(
    grade?.description?.match(/(\d+)\s*\/\s*100/)?.[1] ?? -1,
  );
  if (grade?.state !== 'success' || score < course.passScore) return false;
  if (!course.humanReviewRequired) return true;
  const human = combined.statuses.find(
    (status) => status.context === 'highq/human-capstone',
  );
  const humanScore = Number(
    human?.description?.match(/(\d+)\s*\/\s*100/)?.[1] ?? -1,
  );
  return (
    human?.state === 'success' && humanScore >= (course.humanPassScore || 70)
  );
}

export async function courseGrade(repository, course) {
  const combined = await repoApi(
    repository,
    `/commits/${encodeURIComponent(repository.default_branch)}/status`,
  );
  const automated = automatedGrade(combined.statuses);
  const human = combined.statuses.find(
    (status) => status.context === 'highq/human-capstone',
  );
  const score = Number(
    automated?.description?.match(/(\d+)\s*\/\s*100/)?.[1] ?? -1,
  );
  const humanScore = Number(
    human?.description?.match(/(\d+)\s*\/\s*100/)?.[1] ?? -1,
  );
  return {
    headSha: combined.sha,
    score: score >= 0 ? score : null,
    automatedState: automated?.state || 'not-graded',
    automatedDescription: automated?.description || null,
    automatedContext: automated?.context || null,
    humanScore: humanScore >= 0 ? humanScore : null,
    humanState:
      human?.state ||
      (course.humanReviewRequired ? 'not-submitted' : 'not-required'),
    humanDescription: human?.description || null,
  };
}

function learnerWorkPath(filePath) {
  const normalized = filePath.replaceAll('\\', '/');
  const first = normalized.split('/')[0].toLowerCase();
  const learnerDirectories = new Set([
    'exercises', 'labs', 'projects', 'project', 'capstone', 'submissions', 'src',
  ]);
  const extension = path.extname(normalized).toLowerCase();
  if (!sourceExtensions.has(extension)) return false;
  if (learnerDirectories.has(first))
    return !normalized.toLowerCase().endsWith('/readme.md');
  return (
    !normalized.includes('/') &&
    !['readme.md', 'package.json', 'package-lock.json'].includes(
      normalized.toLowerCase(),
    )
  );
}

export async function captureCourseProgress(entry) {
  const grade = await courseGrade(entry.repository, entry.course);
  const tree = await repoApi(
    entry.repository,
    `/git/trees/${encodeURIComponent(entry.repository.default_branch)}?recursive=1`,
  );
  const blobs = tree.tree.filter(
    (item) => item.type === 'blob' && learnerWorkPath(item.path),
  );
  const snapshot = [];
  let snapshotBytes = 0;
  for (const item of blobs) {
    const blob = await repoApi(
      entry.repository,
      `/git/blobs/${item.sha}`,
    );
    const content = String(blob.content || '').replace(/\s/g, '');
    const decodedBytes = Buffer.from(content, 'base64').length;
    snapshotBytes += decodedBytes;
    if (snapshotBytes > SNAPSHOT_LIMIT_BYTES) {
      throw new Error(
        `${entry.repository.name} learner-work snapshot exceeds ${SNAPSHOT_LIMIT_BYTES} bytes; disenrollment stopped so work is not lost.`,
      );
    }
    snapshot.push({
      path: item.path,
      mode: item.mode || '100644',
      encoding: 'base64',
      content,
    });
  }

  const modules = new Map();
  for (const file of snapshot.filter(
    (item) =>
      item.path.startsWith('exercises/') || item.path.startsWith('labs/'),
  )) {
    const [group, moduleName] = file.path.split('/');
    if (!moduleName) continue;
    const checkpointId = `${group}/${moduleName}`;
    const module = modules.get(checkpointId) || {
      id: checkpointId,
      files: [],
      pendingFiles: [],
    };
    module.files.push(file.path);
    const text = Buffer.from(file.content, 'base64').toString('utf8');
    if (unfinishedPattern.test(text)) module.pendingFiles.push(file.path);
    modules.set(checkpointId, module);
  }
  const checkpoints = [...modules.values()].map((module) => ({
    ...module,
    completed: module.files.length > 0 && module.pendingFiles.length === 0,
  }));
  const trackCourses = loadCurriculum().tracks[entry.track]?.courses || [];
  return {
    courseId: entry.course.id,
    coursePosition: entry.order + 1,
    courseCount: trackCourses.length,
    repositoryOwner: repositoryOwner(entry.repository),
    repositoryName: entry.repository.name,
    headSha: grade.headSha,
    lastScore: grade.score,
    automatedState: grade.automatedState,
    automatedDescription: grade.automatedDescription,
    humanScore: grade.humanScore,
    humanState: grade.humanState,
    humanDescription: grade.humanDescription,
    completedCheckpoints: checkpoints
      .filter((checkpoint) => checkpoint.completed)
      .map((checkpoint) => checkpoint.id),
    checkpoints,
    snapshotBytes,
    snapshotFiles: snapshot,
  };
}

function restoreRepositoryReference(repository, options = {}) {
  if (typeof repository !== 'string') return repository;
  const owner = options.owner || organization;
  return {
    name: repository,
    owner: { login: owner },
    _highq: {
      ownership: owner.toLowerCase() === organization.toLowerCase()
        ? 'organization'
        : 'learner',
      owner,
      installationId: options.installationId || null,
      registry: null,
    },
  };
}

export async function restoreCourseProgress(
  repository,
  branch,
  progress,
  options = {},
) {
  const files = progress?.snapshotFiles || [];
  if (!files.length) return null;
  const reference = restoreRepositoryReference(repository, options);
  const ref = await repoApi(
    reference,
    `/git/ref/heads/${encodeURIComponent(branch)}`,
  );
  const baseCommit = await repoApi(
    reference,
    `/git/commits/${ref.object.sha}`,
  );
  const treeEntries = [];
  for (const file of files) {
    const blob = await repoApi(reference, '/git/blobs', {
      method: 'POST',
      body: JSON.stringify({ content: file.content, encoding: 'base64' }),
    });
    treeEntries.push({
      path: file.path,
      mode: file.mode || '100644',
      type: 'blob',
      sha: blob.sha,
    });
  }
  const tree = await repoApi(reference, '/git/trees', {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree: treeEntries }),
  });
  const commit = await repoApi(reference, '/git/commits', {
    method: 'POST',
    body: JSON.stringify({
      message: `Restore paused course progress (${progress.completedCheckpoints?.length || 0} completed checkpoints)`,
      tree: tree.sha,
      parents: [ref.object.sha],
    }),
  });
  await repoApi(
    reference,
    `/git/refs/heads/${encodeURIComponent(branch)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: false }),
    },
  );
  return commit.sha;
}

export async function currentUnfinishedCourses() {
  const curriculum = loadCurriculum();
  const repositories = await listManagedRepositories();
  const learners = new Map();

  for (const repository of repositories) {
    const course = matchCourse(repository, curriculum.courses);
    if (!course) continue;
    const enrollment = await repositoryEnrollment(repository, course);
    const githubId = Number(enrollment.githubId);
    if (!Number.isFinite(githubId)) continue;
    const track = enrollmentTrack(enrollment);
    const order = curriculum.tracks[track]?.courses?.indexOf(course.id) ?? -1;
    if (order < 0) continue;
    const entry = { repository, course, enrollment, track, order };
    const existing = learners.get(githubId);
    if (!existing || entry.order > existing.order)
      learners.set(githubId, entry);
  }

  const unfinished = [];
  for (const [githubId, entry] of learners) {
    if (await coursePassed(entry.repository, entry.course)) continue;
    const user = await api(`/user/${githubId}`);
    unfinished.push({ ...entry, githubId, user });
  }
  return unfinished;
}

function activityTimestamp(event) {
  return Date.parse(event.created_at || '') || 0;
}

export async function lastLearnerActivity(repository, user) {
  const candidates = [Date.parse(repository.created_at || '') || 0];
  const learnerEvents = new Set([
    'PushEvent',
    'PullRequestEvent',
    'PullRequestReviewEvent',
    'PullRequestReviewCommentEvent',
    'IssuesEvent',
    'IssueCommentEvent',
    'CommitCommentEvent',
    'CreateEvent',
  ]);
  for (let page = 1; page <= 3; page += 1) {
    const events = await repoApi(
      repository,
      `/events?per_page=100&page=${page}`,
    );
    for (const event of events) {
      if (
        Number(event.actor?.id) === Number(user.id) &&
        learnerEvents.has(event.type)
      )
        candidates.push(activityTimestamp(event));
    }
    if (events.length < 100) break;
  }
  return new Date(Math.max(...candidates));
}

export async function findOpenInactivityIssue(repository) {
  if (!repository.has_issues) {
    await repoApi(repository, '', {
      method: 'PATCH',
      body: JSON.stringify({ has_issues: true }),
    });
    repository.has_issues = true;
  }
  const issues = await repoApi(repository, '/issues?state=open&per_page=100');
  return (
    issues.find(
      (issue) => !issue.pull_request && issue.body?.includes(INACTIVITY_MARKER),
    ) || null
  );
}

export async function createWarningIssue(entry, lastActivity, inactiveDays) {
  const body = `${INACTIVITY_MARKER}\n\n@${entry.user.login}, your current High Q course has had no learner-originated activity for **${inactiveDays} full days**.\n\nPlease push a course commit, open/update a pull request, or participate in a course issue within the next day. Instructor, maintainer, bot, template and automation activity does not reset this timer. Nothing will be changed automatically.`;
  return repoApi(entry.repository, '/issues', {
    method: 'POST',
    body: JSON.stringify({
      title: 'INACTIVE — 1-DAY ACTIVITY WARNING',
      body: `${body}\n\nLast learner activity: ${lastActivity.toISOString()}`,
    }),
  });
}

export async function markForReview(entry, issue, lastActivity, inactiveDays) {
  const learnerOwned = entry.repository?._highq?.ownership === 'learner';
  const actionText = learnerOwned
    ? 'The High Q enrollment is now awaiting manual instructor review. Your personal repository remains yours and will not be deleted by High Q.'
    : 'This repository is now awaiting manual instructor review. Nothing is deleted automatically.';
  const body = `${INACTIVITY_MARKER}\n\n@${entry.user.login}, this unfinished course has had no learner-originated activity for **${inactiveDays} full days**. The four-day inactivity limit and one-day grace period have elapsed.\n\n${actionText} Activity can still resume before an instructor approves disenrollment.\n\nLast learner activity: ${lastActivity.toISOString()}`;
  return repoApi(
    entry.repository,
    `/issues/${issue.number}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ title: 'INACTIVE — DISENROLLMENT REVIEW', body }),
    },
  );
}

export async function closeInactivityIssue(repository, issue, user) {
  await repoApi(
    repository,
    `/issues/${issue.number}/comments`,
    {
      method: 'POST',
      body: JSON.stringify({
        body: `Activity from @${user.login} has resumed. The inactivity review is cleared automatically.`,
      }),
    },
  );
  await repoApi(
    repository,
    `/issues/${issue.number}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ state: 'closed', state_reason: 'completed' }),
    },
  );
}

export async function ensureStateRepository() {
  try {
    const repository = await api(`/repos/${organization}/${STATE_REPOSITORY}`);
    if (!repository.has_issues) {
      await api(`/repos/${organization}/${STATE_REPOSITORY}`, {
        method: 'PATCH',
        body: JSON.stringify({ has_issues: true }),
      });
      repository.has_issues = true;
    }
    return repository;
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  await api(`/orgs/${organization}/repos`, {
    method: 'POST',
    body: JSON.stringify({
      name: STATE_REPOSITORY,
      description:
        'Private High Q learner pause, disenrollment and resume records',
      private: true,
      auto_init: true,
      has_issues: true,
      has_projects: false,
      has_wiki: false,
    }),
  });
  const branch = await waitForTemplateReady(STATE_REPOSITORY);
  return { name: STATE_REPOSITORY, default_branch: branch, has_issues: true };
}

export function pausedRecordPath(githubId) {
  return `paused/${githubId}.json`;
}

export async function writePausedRecord(record) {
  const stateRepository = await ensureStateRepository();
  const branch = stateRepository.default_branch || 'main';
  const filePath = pausedRecordPath(record.githubId);
  let sha;
  try {
    const existing = await api(
      `/repos/${organization}/${STATE_REPOSITORY}/contents/${filePath}?ref=${encodeURIComponent(branch)}`,
    );
    sha = existing.sha;
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  await api(`/repos/${organization}/${STATE_REPOSITORY}/contents/${filePath}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: `${sha ? 'Update' : 'Record'} paused course for GitHub ID ${record.githubId}`,
      branch,
      content: Buffer.from(`${JSON.stringify(record, null, 2)}\n`).toString(
        'base64',
      ),
      ...(sha ? { sha } : {}),
    }),
  });
}

export async function readPausedRecord(githubId) {
  const stateRepository = await ensureStateRepository();
  const branch = stateRepository.default_branch || 'main';
  const file = await api(
    `/repos/${organization}/${STATE_REPOSITORY}/contents/${pausedRecordPath(githubId)}?ref=${encodeURIComponent(branch)}`,
  );
  return JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
}

export async function tryReadPausedRecord(githubId) {
  let stateRepository;
  try {
    stateRepository = await api(`/repos/${organization}/${STATE_REPOSITORY}`);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
  const branch = stateRepository.default_branch || 'main';
  try {
    const file = await api(
      `/repos/${organization}/${STATE_REPOSITORY}/contents/${pausedRecordPath(githubId)}?ref=${encodeURIComponent(branch)}`,
    );
    return JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}
