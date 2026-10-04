export const DEFAULT_TRACK = 'computer-science';
export const VALID_TRACKS = new Set(['computer-science', 'computer-engineering']);

export function normalizeName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\d]+/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function normalizeTrack(value, fallback = DEFAULT_TRACK) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return fallback;
  const aliases = new Map([
    ['cs', 'computer-science'],
    ['cse', 'computer-science'],
    ['computer science', 'computer-science'],
    ['computer-science', 'computer-science'],
    ['ce', 'computer-engineering'],
    ['computer engineering', 'computer-engineering'],
    ['computer-engineering', 'computer-engineering']
  ]);
  const normalized = aliases.get(raw);
  if (!normalized || !VALID_TRACKS.has(normalized)) {
    throw new Error(`Unknown programme track: ${value}. Expected computer-science or computer-engineering.`);
  }
  return normalized;
}

export function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('STUDENT_EMAIL must be a valid email address.');
  }
  return email;
}

export function assertRealNameMatches(expectedName, profileName) {
  const expected = normalizeName(expectedName);
  const profile = normalizeName(profileName);
  if (!expected || expected.split(' ').length < 2) {
    throw new Error('REAL_NAME must contain at least a first name and surname.');
  }
  if (!profile) {
    throw new Error('The learner must add their real name to the public Name field on their GitHub profile before enrollment.');
  }
  if (expected !== profile) {
    throw new Error(`GitHub profile name mismatch. Expected "${expectedName}" but the public profile says "${profileName}". Ask the learner to update Settings → Public profile → Name, then retry.`);
  }
}

export function enrollmentPath() {
  return '.highq/enrollment.json';
}

export function decodeEnrollment(content) {
  return JSON.parse(Buffer.from(content, 'base64').toString('utf8'));
}

export function enrollmentTrack(enrollment) {
  return normalizeTrack(enrollment?.track, DEFAULT_TRACK);
}

export function buildEnrollment(
  user,
  realName,
  track = DEFAULT_TRACK,
  enrolledAt = new Date().toISOString(),
  email = null,
) {
  return {
    schemaVersion: 3,
    realName: String(realName).trim(),
    email: normalizeEmail(email),
    githubId: user.id,
    githubLoginAtEnrollment: user.login,
    githubProfileUrl: user.html_url,
    track: normalizeTrack(track),
    enrolledAt
  };
}
