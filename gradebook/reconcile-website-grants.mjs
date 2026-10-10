// Recover the V2 case where repository + registry update succeeded but website
// confirmation failed. Never create or delete a repository in this job.
import process from 'node:process';
import { listLearnerRegistryRecords } from './learner-registry.mjs';
import { installationToken } from './github-app.mjs';
import { api } from './curriculum-api.mjs';
import { websiteClearance, websiteConfirmProvision } from './website-clearance.mjs';

const apply=process.env.APPLY_UNLOCKS==='true';
let recovered=0;
for (const record of await listLearnerRegistryRecords()) {
  if (record.status!=='active' || !Array.isArray(record.repositories)) continue;
  const current=record.repositories.find(item=>item.state==='current');
  if (!current || !current.courseId) continue;
  const history=record.repositories;
  const index=history.indexOf(current);
  if (index<1) continue;
  const prior=history[index-1];
  if (!prior || prior.state!=='completed' || !prior.courseId) continue;
  const cleared=await websiteClearance({
    githubId:record.githubId,
    courseId:prior.courseId,
    targetCourseId:current.courseId,
    track:record.track,
  });
  if (!cleared) continue;
  // Recheck the referenced repository through the trusted App installation.
  if (!record.installationId) throw new Error('V2 installation ID missing while reconciling');
  const authToken=await installationToken(record.installationId);
  const repository=await api(
    '/repos/'+encodeURIComponent(current.repositoryOwner)+'/'+encodeURIComponent(current.repositoryName),
    {},
    authToken,
  );
  if (!repository?.id || !repository?.default_branch) throw new Error('V2 repository not fully provisioned');
  if (apply) {
    await websiteConfirmProvision({
      githubId:record.githubId,
      courseId:prior.courseId,
      targetCourseId:current.courseId,
      repositoryFullName:repository.full_name,
    });
    recovered++;
  }
}
console.log('HIGH-Q V2 grant reconciliations: '+recovered+' (apply='+apply+')');
