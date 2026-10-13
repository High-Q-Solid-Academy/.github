import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const rsa=crypto.generateKeyPairSync("rsa",{modulusLength:2048});
process.env.CURRICULUM_ADMIN_TOKEN="mock-admin";
process.env.CURRICULUM_ORG="High-Q-Solid-Academy";
process.env.HIGHQ_GITHUB_APP_ID="123456";
process.env.HIGHQ_GITHUB_APP_PRIVATE_KEY=rsa.privateKey.export({type:"pkcs8",format:"pem"});
const {provisionLearnerOwnedCourse}=await import("./curriculum-api.mjs");
const manifest=JSON.parse(fs.readFileSync(path.join(import.meta.dirname,"v2-student-delivery.json"),"utf8"));
const git={id:"git",template:"course-git-github",course:"Git & GitHub Foundations"};
const engine={id:"embedded-systems",template:"course-embedded-systems",course:"Embedded Systems"};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json"}});

function createMock({missing=null,privateRepo=true,missingRepository=false}={}){
  const calls=[];
  const files=manifest.bundles.git.files.filter(x=>x!==missing);
  const sourceTree={truncated:false,tree:[...files,"COURSE_BOOK.md","VIDEO_LESSONS.md","modules/10/INSTRUCTOR_NOTES.md"]
    .map((file,i)=>({path:file,type:"blob",sha:(i+1).toString(16).padStart(40,"0"),mode:"100644"}))};
  const fetch=async(input,options={})=>{
    const url=new URL(input),route=url.pathname+url.search,method=options.method||"GET";
    calls.push({route,method,body:options.body});
    if(route==="/users/example/installation")return json({id:42});
    if(route==="/app/installations/42/access_tokens"&&method==="POST")
      return json({token:"mock-app-token",expires_at:"2035-01-01T00:00:00Z"},201);
    if(route==="/repos/example/highq-git-github"&&method==="GET")
      return missingRepository?json({message:"Not Found"},404):json({private:privateRepo,owner:{login:"example"},default_branch:"main"});
    if(route==="/repos/example/highq-embedded-systems"&&method==="GET")
      return json({private:privateRepo,owner:{login:"example"},default_branch:"main"});
    if(route==="/repos/High-Q-Solid-Academy/course-git-github")return json({default_branch:"main"});
    if(route==="/repos/High-Q-Solid-Academy/course-embedded-systems")return json({default_branch:"main"});
    if(route.endsWith("/git/ref/heads/main")&&route.startsWith("/repos/High-Q-Solid-Academy/"))
      return json({object:{sha:"a".repeat(40)}});
    if(route.endsWith("/git/commits/"+"a".repeat(40))&&route.startsWith("/repos/High-Q-Solid-Academy/"))
      return json({tree:{sha:"b".repeat(40)}});
    if(route.endsWith("/git/trees/"+"b".repeat(40)+"?recursive=1")&&route.startsWith("/repos/High-Q-Solid-Academy/"))
      return json(sourceTree);
    if(route==="/repos/example/highq-git-github/branches?per_page=2")return json([]);
    if(route==="/repos/example/highq-git-github/contents/.highq/provisioning-bootstrap.txt"&&method==="PUT")
      return json({content:{sha:"c".repeat(40)}},201);
    if(route.startsWith("/repos/High-Q-Solid-Academy/course-git-github/git/blobs/"))
      return json({content:"eA==",encoding:"base64"});
    if(route==="/repos/example/highq-git-github/git/blobs"&&method==="POST")
      return json({sha:"c".repeat(40)},201);
    if(route==="/repos/example/highq-git-github/git/trees"&&method==="POST")
      return json({sha:"d".repeat(40)},201);
    if(route==="/repos/example/highq-git-github/git/ref/heads/main"&&method==="GET")
      return json({object:{sha:"a".repeat(40)}});
    if(route==="/repos/example/highq-git-github/git/commits"&&method==="POST")
      return json({sha:"e".repeat(40)},201);
    if(route==="/repos/example/highq-git-github/git/refs/heads/main"&&method==="PATCH")
      return json({ok:true});
    if(route==="/repos/example/highq-git-github/branches/main/protection"&&method==="PUT")
      return json({ok:true});
    throw new Error("Unexpected mocked GitHub route: "+method+" "+route);
  };
  return {fetch,calls};
}
test("V2 dry-run lists student-owned destination without any GitHub calls",async()=>{
  const old=globalThis.fetch;globalThis.fetch=()=>{throw Error("Dry-run must not call GitHub")};
  try{
    const output=await provisionLearnerOwnedCourse(git,"example",false);
    assert.equal(output.repositoryFullName,"example/highq-git-github");
    assert.equal(output.action,"would-provision");
  }finally{globalThis.fetch=old;}
});
test("V2 blocks unsupported course before modifying the learner's repository",async()=>{
  const mock=createMock(),old=globalThis.fetch;globalThis.fetch=mock.fetch;
  try{
    await assert.rejects(provisionLearnerOwnedCourse(engine,"example",true),/required before enrollment|not approved/);
    assert.equal(mock.calls.filter(c=>["POST","PUT","PATCH","DELETE"].includes(c.method)&&!c.route.includes("/access_tokens")).length,0);
  }finally{globalThis.fetch=old;}
});
test("V2 requires a private personal repository and does not modify public repos",async()=>{
  const mock=createMock({privateRepo:false}),old=globalThis.fetch;globalThis.fetch=mock.fetch;
  try{
    await assert.rejects(provisionLearnerOwnedCourse(git,"example",true),/must be private/);
    assert.equal(mock.calls.filter(c=>c.route.includes("/contents/.highq/")).length,0);
  }finally{globalThis.fetch=old;}
});
test("V2 fails validation before initializing an empty repository when source file missing",async()=>{
  const mock=createMock({missing:"package.json"}),old=globalThis.fetch;globalThis.fetch=mock.fetch;
  try{
    await assert.rejects(provisionLearnerOwnedCourse(git,"example",true),/missing from source template/);
    assert.equal(mock.calls.filter(c=>c.route.includes("/contents/.highq/")).length,0);
    assert.equal(mock.calls.filter(c=>c.method==="POST"&&c.route.endsWith("/git/blobs")).length,0);
  }finally{globalThis.fetch=old;}
});
test("V2 actually constructs a student-only Git tree without premium files",async()=>{
  const mock=createMock(),old=globalThis.fetch;globalThis.fetch=mock.fetch;
  try{
    const result=await provisionLearnerOwnedCourse(git,"example",true);
    assert.equal(result.ownership,"learner");
    assert.equal(result.repositoryFullName,"example/highq-git-github");
    assert.equal(result.protection,"enabled");
    const tree=mock.calls.find(c=>c.route==="/repos/example/highq-git-github/git/trees"&&c.method==="POST");
    assert.ok(tree);
    assert.deepEqual(JSON.parse(tree.body).tree.map(f=>f.path).sort(),
      [...manifest.bundles.git.files,"README.md"].sort());
    assert.equal(mock.calls.filter(c=>/COURSE_BOOK|INSTRUCTOR_NOTES|VIDEO_LESSONS/.test(c.route)).length,0);
    assert.equal(mock.calls.filter(c=>c.method==="POST"&&c.route.endsWith("/git/blobs")).length,manifest.bundles.git.files.length+1);
    assert.equal(mock.calls.filter(c=>c.route.endsWith("/branches/main/protection")).length,1);
  }finally{globalThis.fetch=old;}
});
