import process from "node:process";
import { enrollmentPath } from "./identity.mjs";
import {
  githubAppConfigured,
  installationForOrganization,
  installationForUser,
  installationToken,
  installationTokenForUser,
} from "./github-app.mjs";
import { studentBundleFiles, studentReadme, gitBlobSha, hasDeclaredStudentBundle } from "./v2-student-delivery.mjs";

export const organization =
  process.env.CURRICULUM_ORG || "High-Q-Solid-Academy";
export const token = process.env.CURRICULUM_ADMIN_TOKEN;
export const apiBase = process.env.GITHUB_API_URL || "https://api.github.com";

export async function api(route, options = {}, authToken = token) {
  if (!authToken)
    throw new Error(`Authentication token is required for ${route}.`);
  const response = await fetch(`${apiBase}${route}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${authToken}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2026-03-10",
      "User-Agent": "highq-curriculum-progression",
      ...options.headers,
    },
  });
  if (response.status === 204) return null;
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(
      `${response.status} ${response.statusText}: ${route}${body?.message ? ` — ${body.message}` : ""}`,
    );
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
    const batch = await api(
      `/orgs/${organization}/repos?type=all&per_page=100&page=${page}`,
    );
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
  return (
    repository?.full_name || `${repositoryOwner(repository)}/${repository.name}`
  );
}

export async function repositoryToken(repository) {
  const owner = repositoryOwner(repository);
  if (owner.toLowerCase() === organization.toLowerCase()) {
    // Official evidence reads need pull-request and issue permissions. Prefer
    // the existing Academy App installation instead of a legacy PAT whenever
    // App credentials are configured.
    if (githubAppConfigured()) {
      const installation = await installationForOrganization(organization);
      return installationToken(installation.id);
    }
    return token;
  }
  if (repository?._highq?.installationId) {
    return installationToken(repository._highq.installationId);
  }
  return (await installationTokenForUser(owner)).token;
}

export async function repoApi(repository, suffix = "", options = {}) {
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

export async function waitForRepositoryReady(
  owner,
  repository,
  authToken = token,
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const details = await api(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`,
        {},
        authToken,
      );
      const branch = details.default_branch || "main";
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
  throw new Error(
    `${owner}/${repository} was created but its default branch did not become available in time.`,
  );
}

export async function waitForTemplateReady(repository) {
  return waitForRepositoryReady(organization, repository, token);
}

export async function writeEnrollment(
  repository,
  enrollment,
  branch = "main",
  options = {},
) {
  const owner = options.owner || organization;
  const authToken = options.authToken || token;
  const content = Buffer.from(
    `${JSON.stringify(enrollment, null, 2)}\n`,
  ).toString("base64");
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
      method: "PUT",
      body: JSON.stringify({
        message: `${sha ? "Update" : "Record"} enrollment identity for ${enrollment.realName}`,
        content,
        branch,
        ...(sha ? { sha } : {}),
      }),
    },
    authToken,
  );
}

async function applyCourseProtection(owner, repository, branch, authToken) {
  let protection = "enabled";
  try {
    await api(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/branches/${encodeURIComponent(branch)}/protection`,
      {
        method: "PUT",
        body: JSON.stringify({
          required_status_checks: {
            strict: true,
            contexts: ["Calculate course score"],
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
    .replace(/^course-/, "")
    .replace(/[^a-z0-9-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `highq-${base}`;
}

const provisioningBootstrapPath = ".highq/provisioning-bootstrap.txt";

async function prepareEmptyLearnerRepository(owner, repository, authToken) {
  const branches = await api(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/branches?per_page=2`,
    {},
    authToken,
  );
  if (!Array.isArray(branches)) {
    throw new Error(
      `Could not verify whether ${owner}/${repository} is empty.`,
    );
  }
  if (branches.length === 0) {
    await api(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/contents/${provisioningBootstrapPath}`,
      {
        method: "PUT",
        body: JSON.stringify({
          message: "Initialize secure High Q course provisioning",
          content: Buffer.from("High Q provisioning bootstrap\n").toString(
            "base64",
          ),
          branch: "main",
        }),
      },
      authToken,
    );
    return "main";
  }
  if (branches.length !== 1 || branches[0]?.name !== "main") {
    throw new Error(
      `${owner}/${repository} must be empty. High Q will never overwrite learner content.`,
    );
  }
  const tree = await api(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/trees/main?recursive=1`,
    {},
    authToken,
  );
  const blobs = (tree.tree || []).filter((entry) => entry.type === "blob");
  if (
    tree.truncated ||
    blobs.length !== 1 ||
    blobs[0].path !== provisioningBootstrapPath
  ) {
    throw new Error(
      `${owner}/${repository} must be empty. High Q will never overwrite learner content.`,
    );
  }
  return "main";
}

async function isRecoverablePartialProvision(
  course,
  owner,
  repository,
  authToken,
  enrollment,
) {
  if (!enrollment?.githubId || !enrollment?.githubLoginAtEnrollment)
    return false;
  try {
    const [source, target, stored] = await Promise.all([
      api(
        `/repos/${organization}/${course.template}/git/trees/main?recursive=1`,
      ),
      api(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/trees/main?recursive=1`,
        {},
        authToken,
      ),
      api(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/contents/${enrollmentPath()}?ref=main`,
        {},
        authToken,
      ),
    ]);
    if (source.truncated || target.truncated) return false;
    const expected = studentBundleFiles(course, source)
      .map(item => item.path + ":" + item.sha);
    expected.push("README.md:" + gitBlobSha(studentReadme(course)));
    const actual = (target.tree || [])
      .filter(item => item.type === "blob" && item.path !== enrollmentPath())
      .map(item => item.path + ":" + item.sha);
    if (JSON.stringify(expected.sort()) !== JSON.stringify(actual.sort())) {
      return false;
    }
    const recorded = JSON.parse(
      Buffer.from(
        String(stored.content || "").replace(/\s/g, ""),
        "base64",
      ).toString("utf8"),
    );
    return (
      Number(recorded.githubId) === Number(enrollment.githubId) &&
      String(recorded.githubLoginAtEnrollment).toLowerCase() ===
        String(enrollment.githubLoginAtEnrollment).toLowerCase() &&
      recorded.ownership === "learner"
    );
  } catch {
    return false;
  }
}

async function approvedStudentBundle(course) {
  // Validate against the reviewed allowlist BEFORE creating or initializing a repository.
  const source = await api(`/repos/${organization}/${course.template}`);
  const sourceBranch = source.default_branch || "main";
  const sourceRef = await api(
    `/repos/${organization}/${course.template}/git/ref/heads/${encodeURIComponent(sourceBranch)}`,
  );
  const sourceCommit = await api(
    `/repos/${organization}/${course.template}/git/commits/${sourceRef.object.sha}`,
  );
  const sourceTree = await api(
    `/repos/${organization}/${course.template}/git/trees/${sourceCommit.tree.sha}?recursive=1`,
  );
  return studentBundleFiles(course, sourceTree);
}

async function copyReviewedStudentBundleToRepository(
  course,
  targetOwner,
  targetRepository,
  targetToken,
  targetBranch,
  approvedFiles,
) {
  if (!Array.isArray(approvedFiles) || approvedFiles.length === 0)
    throw new Error("Reviewed student bundle required before any repository writes");

  const targetEntries = [];
  for (const item of approvedFiles) {
    const blob = await api(
      `/repos/${organization}/${course.template}/git/blobs/${item.sha}`,
    );
    const created = await api(
      `/repos/${encodeURIComponent(targetOwner)}/${encodeURIComponent(targetRepository)}/git/blobs`,
      {
        method: "POST",
        body: JSON.stringify({
          content: String(blob.content || "").replace(/\s/g, ""),
          encoding: "base64",
        }),
      },
      targetToken,
    );
    targetEntries.push({
      path: item.path,
      mode: item.mode || "100644",
      type: "blob",
      sha: created.sha,
    });
  }

  // Generate a non-premium repository entry point; lessons remain in High Q Learn.
  const readmeBlob = await api(
    "/repos/" + encodeURIComponent(targetOwner) + "/" +
      encodeURIComponent(targetRepository) + "/git/blobs",
    {
      method: "POST",
      body: JSON.stringify({ content: studentReadme(course), encoding: "utf-8" }),
    },
    targetToken,
  );
  targetEntries.push({
    path: "README.md", mode: "100644", type: "blob", sha: readmeBlob.sha
  });

  const targetTree = await api(
    `/repos/${encodeURIComponent(targetOwner)}/${encodeURIComponent(targetRepository)}/git/trees`,
    {
      method: "POST",
      body: JSON.stringify({ tree: targetEntries }),
    },
    targetToken,
  );
  const currentRef = targetBranch
    ? await api(
        `/repos/${encodeURIComponent(targetOwner)}/${encodeURIComponent(targetRepository)}/git/ref/heads/${encodeURIComponent(targetBranch)}`,
        {},
        targetToken,
      )
    : null;
  const commit = await api(
    `/repos/${encodeURIComponent(targetOwner)}/${encodeURIComponent(targetRepository)}/git/commits`,
    {
      method: "POST",
      body: JSON.stringify({
        message: `Start High Q course: ${course.course}`,
        tree: targetTree.sha,
        parents: currentRef ? [currentRef.object.sha] : [],
      }),
    },
    targetToken,
  );
  if (currentRef) {
    await api(
      `/repos/${encodeURIComponent(targetOwner)}/${encodeURIComponent(targetRepository)}/git/refs/heads/${encodeURIComponent(targetBranch)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ sha: commit.sha, force: false }),
      },
      targetToken,
    );
  } else {
    await api(
      `/repos/${encodeURIComponent(targetOwner)}/${encodeURIComponent(targetRepository)}/git/refs`,
      {
        method: "POST",
        body: JSON.stringify({ ref: "refs/heads/main", sha: commit.sha }),
      },
      targetToken,
    );
  }
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
      ownership: "learner",
      action: hasDeclaredStudentBundle(course) ? "would-provision" : "blocked-unreviewed-student-bundle",
    };
  }

  const installation = await installationForUser(student);
  const authToken = await installationToken(installation.id);

  let target;
  try {
    target = await api(
      `/repos/${encodeURIComponent(student)}/${encodeURIComponent(repository)}`,
      {},
      authToken,
    );
  } catch (error) {
    if (error.status !== 404) throw error;
    throw new Error(
      `${student}/${repository} is required before enrollment. The learner must create this exact empty private repository and grant the High Q GitHub App access, then rerun enrollment.`,
    );
  }
  const owner = String(target.owner?.login || "");
  if (owner.toLowerCase() !== String(student).toLowerCase()) {
    throw new Error(`Repository owner mismatch for ${student}/${repository}.`);
  }
  if (target.private !== true) {
    throw new Error(
      `${student}/${repository} must be private before High Q can provision it.`,
    );
  }
  const reviewedFiles = await approvedStudentBundle(course);
  let branch;
  let partialRecovery = false;
  try {
    branch = await prepareEmptyLearnerRepository(owner, repository, authToken);
  } catch (error) {
    partialRecovery = await isRecoverablePartialProvision(
      course,
      owner,
      repository,
      authToken,
      enrollment,
    );
    if (!partialRecovery) throw error;
    branch = "main";
    await api(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/branches/main/protection`,
      { method: "DELETE" },
      authToken,
    );
  }
  if (!partialRecovery) {
    await copyReviewedStudentBundleToRepository(
      course,
      owner,
      repository,
      authToken,
      branch,
      reviewedFiles,
    );
  }

  let recordedEnrollment = null;
  if (enrollment) {
    recordedEnrollment = {
      ...enrollment,
      ownership: "learner",
      installationId: installation.id,
      repositoryOwner: owner,
      repositoryName: repository,
      repositoryFullName: `${owner}/${repository}`,
    };
    await writeEnrollment(repository, recordedEnrollment, branch, {
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
    ownership: "learner",
    installationId: installation.id,
    action: "provisioned",
    protection,
    branch,
    enrollment: recordedEnrollment,
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
  if (!apply)
    return {
      repository,
      action: hasDeclaredStudentBundle(course) ? "would-create" : "blocked-unreviewed-student-bundle",
      ownership: "organization",
    };

  // V1 and V2 share the SAME deny-by-default student bundle policy.
  // Never generate an organization-owned learner repo from the full premium template.
  const reviewedFiles = await approvedStudentBundle(course);
  await api(`/orgs/${organization}/repos`, {
    method: "POST",
    body: JSON.stringify({
      name: repository,
      description: `${course.course} — private practical workspace for @${student}`,
      private: true,
      auto_init: true,
      has_issues: true,
    }),
  });
  const branch = await waitForTemplateReady(repository);
  await copyReviewedStudentBundleToRepository(
    course, organization, repository, token, branch, reviewedFiles
  );

  if (enrollment) {
    await writeEnrollment(repository, enrollment, branch);
  }

  if (options.beforeProtect) {
    await options.beforeProtect({
      repository,
      owner: organization,
      branch,
      authToken: token,
    });
  }

  await api(`/repos/${organization}/${repository}/collaborators/${student}`, {
    method: "PUT",
    body: JSON.stringify({ permission: "push" }),
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
    ownership: "organization",
    action: "created",
    protection,
    branch,
  };
}
