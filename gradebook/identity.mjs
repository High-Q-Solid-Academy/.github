export function normalizeName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\d]+/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
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

export function buildEnrollment(user, realName, enrolledAt = new Date().toISOString()) {
  return {
    schemaVersion: 1,
    realName: String(realName).trim(),
    githubId: user.id,
    githubLoginAtEnrollment: user.login,
    githubProfileUrl: user.html_url,
    enrolledAt
  };
}
