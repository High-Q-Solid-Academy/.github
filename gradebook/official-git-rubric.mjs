// Academy-owned authoritative Git & GitHub Foundations grader.
// NEVER execute scripts from the learner repository or trust its commit statuses.
// Supports academy-owned (V1) and learner-owned GitHub App (V2) repositories.
import { repoApi } from './curriculum-api.mjs';

const FILES = Object.freeze({
  profile:'exercises/lab-1-commits/student-profile.md',
  card:'exercises/lab-2-branching/my-card.txt',
  reflection:'exercises/lab-3-pull-request/student-reflection.md',
  issue:'exercises/lab-4-issues/issue-plan.md',
  review:'exercises/lab-5-review-merge/review-evidence.md',
  readme:'exercises/lab-6-markdown-profile/profile-readme-template.md',
  conflict:'exercises/lab-7-merge-conflict/conflict-practice.md',
});
const noPlaceholder = s => !/\[(?:Replace|Your|Skill one|First goal)/i.test(s) && !/YOUR-(?:USERNAME|REPOSITORY)|TODO:/i.test(s);
function safeText(buf) {
  if (buf.length>100000) throw Error('Lab evidence exceeds 100 kB');
  return buf.toString('utf8');
}
export function evaluateGitFileEvidence(p) {
  return [
    Boolean(p.profile && noPlaceholder(p.profile) && /Full Name\s*:/i.test(p.profile) && /Email\s*:/i.test(p.profile) && /Current Goals\s*:/i.test(p.profile) && p.profile.trim().length>=100),
    Boolean(p.card && noPlaceholder(p.card) && /\bname\b/i.test(p.card) && /\bcourse\b/i.test(p.card) && /\bgoal\b/i.test(p.card) && p.card.trim().length>=40),
    Boolean(p.reflection && noPlaceholder(p.reflection) && /\bbranch/i.test(p.reflection) && /\bcommit/i.test(p.reflection) && /\b(review|check)/i.test(p.reflection) && p.reflection.trim().length>=120),
    Boolean(p.issue && noPlaceholder(p.issue) && /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/\d+/i.test(p.issue) && /Problem\s*:/i.test(p.issue) && /Planned change\s*:/i.test(p.issue) && /Definition of done\s*:/i.test(p.issue)),
    Boolean(p.review && noPlaceholder(p.review) && /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/i.test(p.review) && /Reviewer GitHub username\s*:/i.test(p.review) && /Review decision\s*:/i.test(p.review) && /One improvement learned/i.test(p.review)),
    Boolean(p.readme && noPlaceholder(p.readme) && /^#\s+\S/m.test(p.readme) && /\*\*[^*]+\*\*/.test(p.readme) && /^\s*[-*]\s+\S/m.test(p.readme) && /\x60{3}/.test(p.readme) && /https:\/\/github\.com\/[^/\s]+/i.test(p.readme)),
    Boolean(p.conflict && noPlaceholder(p.conflict) && !/^<{7}|^={7}|^>{7}/m.test(p.conflict) && /^Campus:\s*\S+/im.test(p.conflict) && /Resolution note:\s*.{16,}/i.test(p.conflict)),
  ];
}
export function evidenceUrl(text, repoFullName, kind) {
  const re=kind==='issues'?/https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/issues\/(\d+)/i:/https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/i;
  const m=String(text||'').match(re);
  if (!m || (m[1]+'/'+m[2]).toLowerCase()!==repoFullName.toLowerCase()) return null;
  return Number(m[3]);
}
export async function gradeGitRepository(repository, enrolledGithubId, options={}) {
  const request=options.request || repoApi;
  const fullName=repository.full_name || repository.owner.login+'/'+repository.name;
  if (!Number.isSafeInteger(Number(enrolledGithubId)) || Number(enrolledGithubId)<=0) throw Error('Invalid immutable learner GitHub ID');
  const head=await request(repository,'/commits/'+encodeURIComponent(repository.default_branch));
  const sha=head?.sha;
  if (!/^[0-9a-f]{40}$/.test(String(sha))) throw Error('Cannot pin the graded head commit');
  const files={};
  for (const [key,path] of Object.entries(FILES)) {
    try {
      const response=await request(repository,'/contents/'+path+'?ref='+sha);
      if (response?.type!=='file' || response.encoding!=='base64' || typeof response.content!=='string') throw Error('Unexpected Github contents response');
      const raw=response.content.replace(/\s/g,'');
      if (raw.length>150000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw)) throw Error('Invalid or oversized evidence');
      files[key]=safeText(Buffer.from(raw,'base64'));
    } catch(e) {
      if (e.status!==404) throw e;
      files[key]='';
    }
  }
  const checks=evaluateGitFileEvidence(files);
  // The Academy independently checks GitHub's actual PR/issue/review records.
  // Markdown links and student-controlled status descriptions alone are not accepted.
  const issueNumber=evidenceUrl(files.issue,fullName,'issues');
  if (checks[3] && issueNumber) {
    const issue=await request(repository,'/issues/'+issueNumber);
    const boxes=(issue.body||'').match(/- \[[ xX]\]/g)||[];
    checks[3]=!issue.pull_request && Number(issue.user?.id)===Number(enrolledGithubId) &&
      /Practice:\s*improve my student profile/i.test(issue.title||'') && boxes.length>=3;
  } else checks[3]=false;
  const reviewNumber=evidenceUrl(files.review,fullName,'pulls');
  if (checks[4] && reviewNumber) {
    const pr=await request(repository,'/pulls/'+reviewNumber);
    const reviews=await request(repository,'/pulls/'+reviewNumber+'/reviews?per_page=100');
    checks[4]=Number(pr.user?.id)===Number(enrolledGithubId) && Array.isArray(reviews) &&
      reviews.some(r=>Number(r.user?.id)>0 && Number(r.user.id)!==Number(enrolledGithubId) &&
      ['APPROVED','CHANGES_REQUESTED','COMMENTED'].includes(r.state));
  } else checks[4]=false;
  const prs=await request(repository,'/pulls?state=all&per_page=100');
  let validCardPr=false;
  if (Array.isArray(prs)) {
    for (const pr of prs.filter(x=>x.head?.ref==='feature/student-card' && Number(x.user?.id)===Number(enrolledGithubId)).slice(0,12)) {
      const affected=await request(repository,'/pulls/'+pr.number+'/files?per_page=100');
      if (Array.isArray(affected) && affected.some(f=>f.filename===FILES.card) &&
          affected.some(f=>f.filename===FILES.reflection)) {validCardPr=true;break;}
    }
  }
  checks[1]=checks[1] && validCardPr;
  checks[2]=checks[2] && validCardPr;
  const completed=checks.filter(Boolean).length;
  const score=Math.round(completed*100/7);
  // Practical platform evidence is mandatory; no pass by filling text files alone.
  const passed=score>=70 && checks[1] && checks[2] && checks[3] && checks[4] && checks[6];
  return {
    courseId:'git',sha,score,completed,total:7,
    passed,context:'highq/official-grade',verifiedBy:'academy-git-rubric-v1',
    checks:checks.map((passed,i)=>({lab:i+1,passed}))
  };
}
