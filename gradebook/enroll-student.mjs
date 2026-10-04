import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  api,
  organization,
  provisionCourse,
  token,
  writeEnrollment,
} from "./curriculum-api.mjs";
import {
  assertRealNameMatches,
  buildEnrollment,
  decodeEnrollment,
  DEFAULT_TRACK,
  enrollmentPath,
  enrollmentTrack,
  normalizeEmail,
  normalizeTrack,
} from "./identity.mjs";
import { tryReadPausedRecord } from "./inactivity-lib.mjs";

if (!token) {
  console.error("CURRICULUM_ADMIN_TOKEN is required.");
  process.exit(1);
}

const student = String(process.env.STUDENT_USERNAME || "").trim();
const realName = String(process.env.REAL_NAME || "").trim();
const email = normalizeEmail(process.env.STUDENT_EMAIL);
const track = normalizeTrack(process.env.STUDENT_TRACK, DEFAULT_TRACK);
if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(student)) {
  console.error("STUDENT_USERNAME must be a valid GitHub username.");
  process.exit(1);
}
if (!email) {
  console.error("STUDENT_EMAIL is required.");
  process.exit(1);
}

const curriculum = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "courses.json"), "utf8"),
);
const trackDefinition = curriculum.tracks?.[track];
if (!trackDefinition?.courses?.length)
  throw new Error(`Programme ${track} is not configured.`);
const courseById = new Map(
  curriculum.courses.map((course) => [course.id, course]),
);
const first = courseById.get(trackDefinition.courses[0]);
if (!first)
  throw new Error(
    `First course ${trackDefinition.courses[0]} is missing from course definitions.`,
  );

const user = await api(`/users/${student}`);
assertRealNameMatches(realName, user.name);
const pausedRecord = await tryReadPausedRecord(user.id);
if (pausedRecord?.status === "paused") {
  throw new Error(
    `@${user.login} has a preserved paused-course record for ${pausedRecord.removedCourseName}. Use Actions → Resume paused learner so completed checkpoints and saved work are restored; enrollment will not restart the learner at Git foundations.`,
  );
}

const targetRepository = `${first.repositoryPrefix}${user.login}`;

try {
  const repository = await api(`/repos/${organization}/${targetRepository}`);
  try {
    const file = await api(
      `/repos/${organization}/${repository.name}/contents/${enrollmentPath()}?ref=${repository.default_branch}`,
    );
    const existing = decodeEnrollment(file.content);
    const existingTrack = enrollmentTrack(existing);
    if (existingTrack !== track) {
      throw new Error(
        `@${user.login} is already enrolled in ${existingTrack}. Programme changes must be handled explicitly; enrollment will not switch tracks automatically.`,
      );
    }

    const updatedEnrollment = buildEnrollment(
      user,
      realName,
      track,
      existing.enrolledAt || new Date().toISOString(),
      email,
    );
    if (
      existing.email !== updatedEnrollment.email ||
      existing.realName !== updatedEnrollment.realName ||
      Number(existing.schemaVersion || 0) < updatedEnrollment.schemaVersion
    ) {
      await writeEnrollment(
        repository.name,
        updatedEnrollment,
        repository.default_branch,
      );
      console.log(
        `Updated enrollment contact record for @${user.login} without changing the original enrollment date.`,
      );
    }
  } catch (error) {
    if (error.status !== 404) throw error;
    if (track !== DEFAULT_TRACK) {
      throw new Error(
        `@${user.login} already has a legacy learner repository with no programme record. Migrate the learner explicitly before assigning Computer Engineering.`,
      );
    }
    const enrollment = buildEnrollment(user, realName, track, new Date().toISOString(), email);
    await writeEnrollment(
      repository.name,
      enrollment,
      repository.default_branch,
    );
  }
  console.log(
    `@${user.login} is already enrolled in ${trackDefinition.name}; ${first.course} repository already exists.`,
  );
} catch (error) {
  if (error.status !== 404) throw error;
  const enrollment = buildEnrollment(user, realName, track, new Date().toISOString(), email);
  const result = await provisionCourse(first, user.login, true, enrollment);
  console.log(
    `Enrolled in ${trackDefinition.name}: ${realName} (@${user.login}, GitHub ID ${user.id}) -> ${result.repository}. The collaborator invitation may need acceptance.`,
  );
}
