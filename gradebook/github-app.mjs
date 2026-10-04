import crypto from 'node:crypto';
import process from 'node:process';

const apiBase = process.env.GITHUB_API_URL || 'https://api.github.com';
const appId = String(process.env.HIGHQ_GITHUB_APP_ID || '').trim();
const privateKey = String(process.env.HIGHQ_GITHUB_APP_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
const appSlug = String(process.env.HIGHQ_GITHUB_APP_SLUG || '').trim();
const tokenCache = new Map();

function base64url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export function githubAppConfigured() {
  return Boolean(appId && privateKey);
}

export function githubAppInstallUrl() {
  return appSlug ? `https://github.com/apps/${appSlug}/installations/new` : null;
}

export function createAppJwt() {
  if (!githubAppConfigured()) {
    throw new Error('HIGHQ_GITHUB_APP_ID and HIGHQ_GITHUB_APP_PRIVATE_KEY are required for learner-owned repositories.');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iat: now - 60,
    exp: now + 8 * 60,
    iss: appId,
  }));
  const unsigned = `${header}.${payload}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), privateKey);
  return `${unsigned}.${base64url(signature)}`;
}

async function appRequest(route, options = {}, authToken = createAppJwt()) {
  const response = await fetch(`${apiBase}${route}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2026-03-10',
      'User-Agent': 'highq-learner-repository-app',
      ...options.headers,
    },
  });
  if (response.status === 204) return null;
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(`${response.status} ${response.statusText}: ${route}${body?.message ? ` — ${body.message}` : ''}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

export async function installationForUser(username) {
  const login = String(username || '').trim();
  if (!login) throw new Error('A GitHub username is required to resolve a GitHub App installation.');
  try {
    return await appRequest(`/users/${encodeURIComponent(login)}/installation`);
  } catch (error) {
    if (error.status === 404) {
      const installUrl = githubAppInstallUrl();
      throw new Error(
        `High Q GitHub App is not installed on @${login}'s account.${installUrl ? ` Install it first: ${installUrl}` : ' Install the High Q GitHub App on the learner account, then retry enrollment.'}`,
      );
    }
    throw error;
  }
}

export async function installationToken(installationId) {
  const id = Number(installationId);
  if (!Number.isFinite(id)) throw new Error('A valid GitHub App installation ID is required.');

  const cached = tokenCache.get(id);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const result = await appRequest(`/app/installations/${id}/access_tokens`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  const expiresAt = Date.parse(result.expires_at || '') || Date.now() + 50 * 60_000;
  tokenCache.set(id, { token: result.token, expiresAt });
  return result.token;
}

export async function installationTokenForUser(username) {
  const installation = await installationForUser(username);
  return {
    installation,
    token: await installationToken(installation.id),
  };
}
