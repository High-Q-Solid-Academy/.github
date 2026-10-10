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
