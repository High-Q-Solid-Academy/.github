import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

process.env.CURRICULUM_ADMIN_TOKEN = "mock-curriculum-token";
process.env.CURRICULUM_ORG = "High-Q-Solid-Academy";
const { provisionCourse } = await import("./curriculum-api.mjs");
const manifest = JSON.parse(fs.readFileSync(path.join(import.meta.dirname,"v2-student-delivery.json"),"utf8"));
const git = {id:"git",template:"course-git-github",repositoryPrefix:"course-git-github-",course:"Git & GitHub Foundations"};
const engine = {id:"computer-engineering-foundations",template:"course-computer-engineering-foundations",repositoryPrefix:"course-computer-engineering-foundations-",course:"Engineering"};
const good = () => new Response(JSON.stringify({}),{status:200,headers:{"Content-Type":"application/json"}});
function simulatedAPI({missingFile=null,protectionStatus=200}={}) {
  const calls=[];
  const sourcePaths = manifest.bundles.git.files.filter(x=>x!==missingFile);
  const sourceTree = {
    truncated:false,
    tree: [...sourcePaths,"COURSE_BOOK.md","modules/01/INSTRUCTOR_NOTES.md","VIDEO_LESSONS.md"]
      .map((file,i)=>({path:file,type:"blob",mode:"100644",sha:(i+1).toString(16).padStart(40,"0")}))
  };
  const json = (body,status=200) => new Response(JSON.stringify(body), {status,headers:{"Content-Type":"application/json"}});
  const fetch = async (raw, init={}) => {
    const url = new URL(raw);
    const route = url.pathname + url.search;
    const method=init.method||"GET";
    calls.push({route,method,body:init.body});
    if(route==="/repos/High-Q-Solid-Academy/course-git-github" && method==="GET")
      return json({default_branch:"main"});
    if(route==="/repos/High-Q-Solid-Academy/course-git-github/git/ref/heads/main" && method==="GET")
      return json({object:{sha:"a".repeat(40)}});
    if(route==="/repos/High-Q-Solid-Academy/course-git-github/git/commits/"+"a".repeat(40))
      return json({tree:{sha:"b".repeat(40)}});
    if(route==="/repos/High-Q-Solid-Academy/course-git-github/git/trees/"+"b".repeat(40)+"?recursive=1")
      return json(sourceTree);
    if(route==="/repos/High-Q-Solid-Academy/course-computer-engineering-foundations")
      return json({default_branch:"main"});
    if(route==="/repos/High-Q-Solid-Academy/course-computer-engineering-foundations/git/ref/heads/main")
      return json({object:{sha:"a".repeat(40)}});
    if(route==="/repos/High-Q-Solid-Academy/course-computer-engineering-foundations/git/commits/"+"a".repeat(40))
      return json({tree:{sha:"b".repeat(40)}});
    if(route==="/repos/High-Q-Solid-Academy/course-computer-engineering-foundations/git/trees/"+"b".repeat(40)+"?recursive=1")
      return json(sourceTree);
    if(route==="/orgs/High-Q-Solid-Academy/repos" && method==="POST")return json({private:true},201);
    if(route==="/repos/High-Q-Solid-Academy/course-git-github-example" && method==="GET")
      return json({default_branch:"main"});
    if(route==="/repos/High-Q-Solid-Academy/course-git-github-example/git/ref/heads/main")
      return json({object:{sha:"c".repeat(40)}});
    if(route.startsWith("/repos/High-Q-Solid-Academy/course-git-github/git/blobs/"))
      return json({content:"eA==",encoding:"base64"});
    if(route==="/repos/High-Q-Solid-Academy/course-git-github-example/git/blobs" && method==="POST")
      return json({sha:"d".repeat(40)},201);
    if(route==="/repos/High-Q-Solid-Academy/course-git-github-example/git/trees" && method==="POST")
      return json({sha:"e".repeat(40)},201);
    if(route==="/repos/High-Q-Solid-Academy/course-git-github-example/git/commits" && method==="POST")
      return json({sha:"f".repeat(40)},201);
    if(route==="/repos/High-Q-Solid-Academy/course-git-github-example/git/refs/heads/main" && method==="PATCH")
      return good();
    if(route==="/repos/High-Q-Solid-Academy/course-git-github-example/collaborators/example" && method==="PUT")
      return good();
    if(route==="/repos/High-Q-Solid-Academy/course-git-github-example/branches/main/protection" && method==="PUT")
      return protectionStatus===200?good():json({message:"not supported"},protectionStatus);
    throw new Error("Unexpected test GitHub API request: "+method+" "+route);
  };
  return {calls,fetch};
}

test("V1 historical architecture is preserved; dry-run does not contact GitHub",async()=>{
  const before=globalThis.fetch;
  globalThis.fetch=()=>{throw Error("Dry run made a network request");};
  try {
    const result=await provisionCourse(git,"example",false);
    assert.equal(result.ownership,"organization");
    assert.equal(result.action,"would-create");
    const blocked=await provisionCourse(engine,"example",false);
    assert.equal(blocked.action,"blocked-unreviewed-student-bundle");
  } finally {globalThis.fetch=before;}
});
test("V1 refuses unsupported course BEFORE a new organization repository is created",async()=>{
  const before=globalThis.fetch,sim=simulatedAPI();
  globalThis.fetch=sim.fetch;
  try{
    await assert.rejects(provisionCourse(engine,"example",true),/not approved/);
    assert.equal(sim.calls.filter(x=>x.method!=="GET").length,0);
  }finally{globalThis.fetch=before;}
});
test("V1 refuses missing approved source file BEFORE creating anything",async()=>{
  const before=globalThis.fetch,sim=simulatedAPI({missingFile:"package.json"});
  globalThis.fetch=sim.fetch;
  try{
    await assert.rejects(provisionCourse(git,"example",true),/missing from source template/);
    assert.equal(sim.calls.filter(x=>x.method!=="GET").length,0);
  }finally{globalThis.fetch=before;}
});
test("V1 creates an academy-owned practical-only repo; it does not generate the full template",async()=>{
  const before=globalThis.fetch,sim=simulatedAPI();
  globalThis.fetch=sim.fetch;
  try{
    const result=await provisionCourse(git,"example",true);
    assert.equal(result.repositoryFullName,"High-Q-Solid-Academy/course-git-github-example");
    assert.equal(result.ownership,"organization");
    assert.equal(result.protection,"enabled");
    const creates=sim.calls.filter(x=>x.route==="/orgs/High-Q-Solid-Academy/repos"&&x.method==="POST");
    assert.equal(creates.length,1);
    assert.deepEqual(JSON.parse(creates[0].body).private,true);
    assert.equal(sim.calls.filter(x=>x.route.includes("/generate")).length,0);
    assert.equal(sim.calls.filter(x=>x.route.includes("COURSE_BOOK")).length,0);
    assert.equal(sim.calls.filter(x=>x.route.includes("INSTRUCTOR_NOTES")).length,0);
    assert.equal(sim.calls.filter(x=>x.route.includes("VIDEO_LESSONS")).length,0);
    const blobs=sim.calls.filter(x=>x.route.endsWith("/git/blobs") && x.method==="POST");
    assert.equal(blobs.length,manifest.bundles.git.files.length+1);
    const createdTree=sim.calls.find(x=>x.route.endsWith("/git/trees") && x.method==="POST");
    assert.deepEqual(JSON.parse(createdTree.body).tree.map(x=>x.path).sort(),
      [...manifest.bundles.git.files,"README.md"].sort());
    assert.equal(sim.calls.some(x=>x.route.endsWith("/branches/main/protection")),true);
    assert.equal(sim.calls.some(x=>x.route.endsWith("/collaborators/example")),true);
  }finally{globalThis.fetch=before;}
});
test("V1 reports unavailable branch protection instead of silently claiming enabled",async()=>{
  const before=globalThis.fetch,sim=simulatedAPI({protectionStatus:403});
  globalThis.fetch=sim.fetch;
  try{
    const result=await provisionCourse(git,"example",true);
    assert.equal(result.protection,"unavailable (403)");
  }finally{globalThis.fetch=before;}
});
