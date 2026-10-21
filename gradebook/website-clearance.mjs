// HIGH-Q course progression attestation. GitHub grade alone cannot unlock a course.
const DEFAULT_ENDPOINT = 'https://highqsolidacademy.com/api/learning/course-clearance.php';
export async function websiteClearance({ githubId, courseId, targetCourseId, track }, env = process.env) {
  const token = String(env.HIGHQ_PROGRESS_API_TOKEN || '');
  const endpoint = String(env.HIGHQ_CERT_GATE_URL || DEFAULT_ENDPOINT);
  if (token.length < 32) throw new Error('HIGHQ_PROGRESS_API_TOKEN missing: course provisioning denied.');
  const parsed = new URL(endpoint);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'highqsolidacademy.com' || parsed.username || parsed.password) {
    throw new Error('Course clearance must be requested from the official HIGH-Q HTTPS host.');
  }
  for (const [key, value] of Object.entries({ github_id: githubId, course_id: courseId, target_course_id: targetCourseId, track })) {
    parsed.searchParams.set(key, String(value));
  }
  const response = await fetch(parsed, {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
    signal: AbortSignal.timeout(12000),
    redirect: 'error',
  });
  if (!response.ok) {
    throw new Error('HIGH-Q clearance unavailable (HTTP ' + response.status + '): denying course provisioning.');
  }
  const body = await response.json();
  return body?.eligible === true && body?.reason === 'authorized_for_provisioning';
}

export async function websiteConfirmProvision({ githubId, courseId, targetCourseId, repositoryFullName }, env = process.env) {
  const token = String(env.HIGHQ_PROGRESS_API_TOKEN || '');
  if (token.length < 32) throw new Error('HIGHQ_PROGRESS_API_TOKEN missing: cannot confirm provisioning.');
  const endpoint = String(env.HIGHQ_PROVISION_CONFIRM_URL || 'https://highqsolidacademy.com/api/learning/confirm-provision.php');
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.hostname !== 'highqsolidacademy.com' || url.username || url.password) {
    throw new Error('Provision confirmation requires official HIGH-Q HTTPS host.');
  }
  const response = await fetch(url,{
    method: 'POST',
    headers: {Authorization: 'Bearer ' + token,'Content-Type':'application/json',Accept:'application/json'},
    body: JSON.stringify({
      github_id:githubId,
      course_id:courseId,
      target_course_id:targetCourseId,
      repository_full_name:repositoryFullName,
    }),
    signal:AbortSignal.timeout(12000),
    redirect:'error',
  });
  const body = await response.json().catch(()=>null);
  if (!response.ok || !['confirmed','already_confirmed'].includes(body?.status)) {
    throw new Error('HIGH-Q did not confirm a successful course provision: HTTP ' + response.status);
  }
}

export async function websiteConfirmEnrollment(payload, env = process.env) {
  const token = String(env.HIGHQ_PROGRESS_API_TOKEN || '');
  if (token.length < 32) throw new Error('HIGHQ_PROGRESS_API_TOKEN missing: cannot send enrollment acceptance.');
  const endpoint = String(env.HIGHQ_ENROLLMENT_COMPLETE_URL || 'https://learn.highqsolidacademy.com/api/enrollment-complete.php');
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.hostname !== 'learn.highqsolidacademy.com' || url.username || url.password) {
    throw new Error('Enrollment completion requires the official HIGH-Q Learn HTTPS host.');
  }
  const requestOptions = {
    method: 'POST',
    headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json'},
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
    redirect: 'manual',
  };
  let response = await fetch(url, requestOptions);
  if ([301, 302, 307, 308].includes(response.status)) {
    const location = response.headers?.get?.('location');
    const redirected = location ? new URL(location, url) : null;
    if (!redirected || redirected.protocol !== 'https:' || redirected.hostname !== 'learn.highqsolidacademy.com' || redirected.username || redirected.password) {
      throw new Error('Enrollment completion redirect was not an official HIGH-Q Learn HTTPS URL.');
    }
    response = await fetch(redirected, requestOptions);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok || !['sent', 'already_sent'].includes(body?.status)) {
    throw new Error('HIGH-Q enrollment acceptance email was not confirmed: HTTP ' + response.status + ' (' + String(body?.status || 'invalid_response') + ').');
  }
  return body.status;
}
