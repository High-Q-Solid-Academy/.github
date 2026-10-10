import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceUrl } from './official-git-rubric.mjs';
test('evidence URL must match repository', () => { assert.equal(evidenceUrl('https://github.com/owner/repo/issues/1','owner/repo','issues'),1); assert.equal(evidenceUrl('https://github.com/other/repo/issues/1','owner/repo','issues'),null); });

import { officialPayload } from './official-enrollment-sync.mjs';
const verifiedUser = { id: 2525, login: 'learner', name: 'Sample Learner' };
const verifiedEnrollment = { schemaVersion:4, enrolledAt:'2026-10-01T09:00:00Z', githubId:2525, githubLoginAtEnrollment:'learner', realName:'Sample Learner', track:'computer-science' };
const gitCourse = {id:'git', humanReviewRequired:false};
const officialGrade = {sha:'a'.repeat(40), score:86, passed:true, verifiedBy:'academy-git-rubric-v1', total:7, completed:6};
test('academy V1 enrollment imports official score', () => {
 const repository={id:712,owner:{login:'High-Q-Solid-Academy'},name:'course-git-github-learner',full_name:'High-Q-Solid-Academy/course-git-github-learner'};
 const result=officialPayload({repository,course:gitCourse,enrollment:verifiedEnrollment,user:verifiedUser,grade:officialGrade});
 assert.equal(result.enrollment_version,'v1');
 assert.equal(result.grade_context,'highq/official-grade');
});
test('learner-owned V2 enrollment is bound to Academy registry', () => {
 const repository={id:801,owner:{login:'learner'},name:'course-git-github',full_name:'learner/course-git-github',
 _highq:{ownership:'learner',registry:{githubId:2525,repositoryOwner:'learner',installationId:1005,status:'active'}}};
 const result=officialPayload({repository,course:gitCourse,enrollment:verifiedEnrollment,user:verifiedUser,grade:officialGrade});
 assert.equal(result.enrollment_version,'v2');
 assert.equal(result.github_repository_id,801);
});
test('ordinary student autograding cannot become an official pass', () => {
 const repository={id:712,owner:{login:'High-Q-Solid-Academy'},name:'course-git-github-learner'};
 const result=officialPayload({repository,course:gitCourse,enrollment:verifiedEnrollment,user:verifiedUser,
  grade:{sha:'a'.repeat(40),score:100,passed:true,verifiedBy:'student-side'}});
 assert.equal(result.grade_context,'');
 assert.equal(result.grade_score,null);
});
