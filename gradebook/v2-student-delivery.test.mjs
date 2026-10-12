import test from "node:test";
import assert from "node:assert/strict";
import { studentBundleFiles, studentReadme, gitBlobSha } from "./v2-student-delivery.mjs";

const course = {id:"git",template:"course-git-github",course:"Git & GitHub Foundations"};
const allowed = ["package.json",".github/workflows/verify-git.yml","exercises/lab-1-commits/student-profile.md"];
const tree = (files=allowed) => ({
  truncated:false,
  tree: files.map(file => ({path:file,type:"blob",sha:"a".repeat(40),mode:"100644"}))
});
const rule = (files=allowed,sourceTemplate="course-git-github") => ({
  schemaVersion:1,mode:"deny-unlisted",
  bundles:{git:{sourceTemplate,files}}
});

test("only explicit learner files are copied; private coursebooks are excluded",()=>{
  const source=tree([...allowed,"COURSE_BOOK.md","VIDEO_LESSONS.md","modules/01/INSTRUCTOR_NOTES.md"]);
  assert.deepEqual(studentBundleFiles(course,source,rule()).map(item=>item.path),allowed);
});
test("unreviewed later courses fail closed",()=>{
  assert.throws(()=>studentBundleFiles({...course,id:"embedded-systems"},tree(),rule()),/not approved/);
});
test("prohibited documents and secret paths cannot be delivered",()=>{
  for (const item of ["COURSE_BOOK.md","modules/01/INSTRUCTOR_NOTES.md","../private",".highq/enrollment.json",
    "README.md","x//y",".env","secrets/.npmrc","modules/01/QUIZ_KEY.md"]) {
    assert.throws(()=>studentBundleFiles(course,tree([...allowed,item]),rule([...allowed,item])),/Forbidden/);
  }
});
test("unknown, missing, duplicated or truncated source entries fail closed",()=>{
  assert.throws(()=>studentBundleFiles(course,tree(),rule([...allowed,allowed[0]])),/distinct/);
  assert.throws(()=>studentBundleFiles(course,tree(),rule([...allowed,"absent.txt"])),/missing/);
  assert.throws(()=>studentBundleFiles(course,{...tree(),truncated:true},rule()),/truncated/);
  assert.throws(()=>studentBundleFiles(course,tree(),rule(allowed,"different-template")),/not approved/);
});
test("formative workflow is mandatory and generated README is minimal",()=>{
  assert.throws(()=>studentBundleFiles(course,tree(),rule(["package.json"])),/formative workflow/);
  const text=studentReadme(course);
  assert.match(text,/High Q Learn/);
  assert.match(text,/https:\/\/highqsolidacademy.com\/learning\//);
  assert.match(gitBlobSha(text),/^[0-9a-f]{40}$/);
});
