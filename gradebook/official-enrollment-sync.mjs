// Trusted Academy GitHub enrollment/grade bridge. Does not consume student-side
// statuses as official assessment evidence and never runs learner-controlled code.
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { api, repositoryFullName, repoApi, organization } from './curriculum-api.mjs';
import { listManagedRepositories } from './managed-repositories.mjs';
import { decodeEnrollment, enrollmentPath, enrollmentTrack, normalizeName } from './identity.mjs';
import { matchCourse } from './inactivity-lib.mjs';
import { gradeGitRepository } from './official-git-rubric.mjs';
import fs from 'node:fs';
import path from 'node:path';

const curriculum=JSON.parse(fs.readFileSync(path.join(import.meta.dirname,'courses.json'),'utf8'));
export function officialPayload({repository,course,enrollment,user,grade}) {
  const fullName=repositoryFullName(repository);
  const v2=repository?._highq?.ownership==='learner';
  const record=repository?._highq?.registry;
  const track=enrollmentTrack(enrollment);
  if (!curriculum.tracks[track]?.courses.includes(course.id)) throw Error('Enrollment track/course mismatch');
  if (Number(enrollment.githubId)!==Number(user.id) || normalizeName(enrollment.realName)!==normalizeName(user.name)) {
    throw Error('Unverified learner identity');
  }
  if (!/^[0-9a-f]{40}$/.test(String(grade?.sha))) throw Error('Missing pinned head commit');
  if (!Number.isSafeInteger(Number(repository.id)) || Number(repository.id)<1) throw Error('Missing immutable GitHub repository ID');
  if (v2) {
    if (!record || Number(record.githubId)!==Number(enrollment.githubId) ||
        String(record.repositoryOwner).toLowerCase()!==String(repository.owner?.login).toLowerCase() ||
        !Number(record.installationId)) throw Error('V2 learner registry mismatch');
  } else {
    if (String(repository.owner?.login).toLowerCase()!==organization.toLowerCase()) throw Error('V1 repo must be Academy-owned');
    // V1 binding must have a recorded Academy enrollment, not inferred from repo name.
    if (!enrollment.schemaVersion || !enrollment.enrolledAt) throw Error('V1 enrollment needs trusted backfill');
    const expectedPrefix=course.repositoryPrefix;
    const expectedLogin=String(enrollment.githubLoginAtEnrollment || user.login).toLowerCase();
    if (String(repository.name).toLowerCase()!==String(expectedPrefix+expectedLogin).toLowerCase()) {
      throw Error('V1 enrollment repository does not match recorded learner');
    }
  }
  const explicitStatus=v2 ? String(record.status || 'active').toLowerCase() : 'active';
  if (!['active','paused'].includes(explicitStatus)) throw Error('Inactive/enrollment unrecognized; instructor review needed');
  const verified=grade?.verifiedBy==='academy-git-rubric-v1';
  return {
    github_id:Number(user.id),
    github_repository_id:Number(repository.id),
    github_login:user.login,
    real_name:enrollment.realName,
    track,
    learner_status:explicitStatus,
    enrollment_version:v2?'v2':'v1',
    course_id:course.id,
    repository_full_name:fullName,
    head_sha:grade.sha,
    grade_context:verified?'highq/official-grade':'',
    grade_state:verified ? (grade.passed?'success':'failure'):'pending',
    grade_score:verified?grade.score:null,
    official_verifier:verified?grade.verifiedBy:null,
    official_checks_total:verified?grade.total:null,
    official_checks_passed:verified?grade.completed:null,
    human_required: Boolean(course.humanReviewRequired),
    // Only the Academy instructor-controlled capstone review can set human grades.
    // It is NOT derived from learner-controlled status contexts.
    human_state:'pending',
    human_score:null,
  };
}
export async function collectOfficialPayloads(deps={}) {
  const managed=await (deps.listManagedRepositories || listManagedRepositories)({includeInactive:true});
  const makeRequest=deps.repoApi || repoApi;
  const userRequest=deps.api || api;
  const payloads=[];
  const skipped=[];
  for (const repository of managed) {
    const course=matchCourse(repository,curriculum.courses);
    if (!course) continue;
    const fullName=repositoryFullName(repository);
    try {
      // No name-based fallback: V1 and V2 must carry Academy enrollment metadata.
      const file=await makeRequest(repository,'/contents/'+enrollmentPath()+'?ref='+encodeURIComponent(repository.default_branch));
      if (file?.encoding!=='base64' || file?.type!=='file') throw Error('Academy enrollment file missing');
      const enrollment=decodeEnrollment(file.content);
      if (!enrollment?.githubId) throw Error('Enrollment has no immutable GitHub ID');
      const user=await userRequest('/user/'+Number(enrollment.githubId));
      const head=await makeRequest(repository,'/commits/'+encodeURIComponent(repository.default_branch));
      if (!/^[0-9a-f]{40}$/.test(String(head?.sha))) throw Error('Repository HEAD not verifiable');
      let grade={sha:head.sha};
      if (course.id==='git') grade=await gradeGitRepository(repository,Number(enrollment.githubId),{request:makeRequest});
      const data=officialPayload({repository,course,enrollment,user,grade});
      payloads.push(data);
    } catch (error) {
      // Never downgrade an error to an "active/passed" student. Report only.
      skipped.push({repository:fullName,course:course.id,reason:String(error.message).slice(0,180)});
    }
  }
  return {payloads,skipped};
}
export async function syncOfficialEnrollments(env=process.env,deps={}) {
  const {payloads,skipped}=await collectOfficialPayloads(deps);
  const armed=env.HIGHQ_OFFICIAL_GRADE_SYNC_ENABLED==='1';
  let synced=0;
  if (armed) {
    const token=String(env.HIGHQ_GRADE_SYNC_SECRET||'');
    const endpoint=String(env.HIGHQ_GRADE_SYNC_URL||'');
    if (token.length<32) throw Error('HIGHQ_GRADE_SYNC_SECRET is missing');
    const url=new URL(endpoint);
    if (url.protocol!=='https:' || url.hostname!=='highqsolidacademy.com' || url.pathname!=='/api/learning/github-sync.php') {
      throw Error('Official grade sync must target the fixed HIGH-Q HTTPS import route');
    }
    for (const record of payloads) {
      const reply=await (deps.fetch || fetch)(url,{
        method:'POST',
        headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json'},
        body:JSON.stringify(record),redirect:'error',signal:AbortSignal.timeout(15000)
      });
      if (!reply.ok) throw Error('Website sync returned HTTP '+reply.status+' for '+record.course_id);
      synced++;
    }
  }
  return {discovered:payloads.length,synced,skipped,
    officialPasses:payloads.filter(r=>r.grade_context==='highq/official-grade' && r.grade_state==='success').length,
    pending:payloads.filter(r=>r.grade_context!=='highq/official-grade').length,
    mode:armed?'APPLY':'DRY_RUN'};
}
if (process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const report=await syncOfficialEnrollments();
  const summary={
    mode:report.mode,discovered:report.discovered,synced:report.synced,
    officialPasses:report.officialPasses,pending:report.pending,
    skipped:report.skipped.length,
  };
  console.log(JSON.stringify(summary,null,2));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    '## V1/V2 official enrollment sync\n\n'+
    '- Mode: '+summary.mode+'\n- Verified enrollments: '+summary.discovered+
    '\n- Website records sent: '+summary.synced+
    '\n- Academy-verified Git passes: '+summary.officialPasses+
    '\n- Courses pending official graders: '+summary.pending+
    '\n- Skipped records for review: '+summary.skipped+'\n');
}
