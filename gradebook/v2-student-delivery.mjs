// Private curriculum stays at HIGH-Q; V2 student repositories contain reviewed practical files only.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const manifest = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "v2-student-delivery.json"), "utf8"));
const teachingFile = /(?:^|\/)(?:COURSE_BOOK|DEEP_DIVE|DEEP_DIVE_NOTES|STUDY_GUIDE|BEFORE_YOU_START|VIDEO_LESSONS|WORKED_EXAMPLES|INSTRUCTOR_NOTES|LEARNING_RESOURCES|QUIZ_KEY|ANSWER_KEY|SOLUTION|SOLUTIONS|RUBRIC|CAPSTONE_STUDY_GUIDE|GUIDED_RESOURCES|C_MASTERCLASS|TOOL_GUIDE|ADVANCED_PREPARATION)\.(?:md|json|txt)$/i;

function allowedPath(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 240 &&
    !value.startsWith("/") && !value.includes("\\") &&
    !value.split("/").some(part => !part || part === "." || part === "..") &&
    !teachingFile.test(value) &&
    !/(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|node_modules|\.git)(?:\/|$)/i.test(value);
}

export function studentReadme(course) {
  return [
    "# High Q Learn — Practical Workspace",
    "",
    "Course: " + course.course,
    "",
    "This learner-owned repository contains your practical files, not the academy coursebook.",
    "Sign in at https://highqsolidacademy.com/learning/ to read your lessons and videos.",
    "Create a feature branch, complete your work, push changes and request review.",
    "Local or GitHub Actions checks provide feedback; only HIGH-Q can confirm official results.",
    "Do not publish premium lessons, passwords, tokens, or private personal information.",
    ""
  ].join("\n");
}

export function gitBlobSha(content) {
  const bytes = Buffer.from(content, "utf8");
  return crypto.createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
}

export function hasDeclaredStudentBundle(course, selectedManifest = manifest) {
  const rule = selectedManifest?.bundles?.[course?.id];
  return selectedManifest?.schemaVersion === 1 &&
    selectedManifest?.mode === "deny-unlisted" &&
    Boolean(rule && rule.sourceTemplate === course?.template &&
      Array.isArray(rule.files) && rule.files.length > 0);
}

export function studentBundleFiles(course, sourceTree, selectedManifest = manifest) {
  if (!course?.id || !course?.template) throw new Error("Missing course definition");
  if (selectedManifest?.schemaVersion !== 1 || selectedManifest?.mode !== "deny-unlisted") {
    throw new Error("Invalid V2 student file manifest");
  }
  const rule = selectedManifest.bundles?.[course.id];
  if (!rule || rule.sourceTemplate !== course.template || !Array.isArray(rule.files)) {
    throw new Error("V2 bundle not approved for " + course.id + ". Provisioning denied until reviewed.");
  }
  if (!Array.isArray(sourceTree?.tree) || sourceTree.truncated) {
    throw new Error("V2 template tree missing or truncated");
  }
  if (!rule.files.length || new Set(rule.files).size !== rule.files.length) {
    throw new Error("V2 bundle must list distinct files");
  }
  const sourceFiles = new Map(sourceTree.tree.filter(item => item.type === "blob").map(item => [item.path, item]));
  const chosen = [];
  for (const file of rule.files) {
    if (!allowedPath(file) || file === "README.md" || file.startsWith(".highq/")) {
      throw new Error("Forbidden V2 student path: " + file);
    }
    const source = sourceFiles.get(file);
    if (!source || !/^[0-9a-f]{40}$/i.test(String(source.sha))) {
      throw new Error("V2 starter file missing from source template: " + file);
    }
    chosen.push(source);
  }
  if (!chosen.some(file => file.path.startsWith(".github/workflows/"))) {
    throw new Error("Missing a reviewed formative workflow for V2");
  }
  return chosen;
}
