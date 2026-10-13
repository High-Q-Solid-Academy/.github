# HIGH Q LEARN — ANTIGRAVITY HYBRID V1/V2 IMPLEMENTATION FOLLOW-UP

This is an addendum to the previously supplied full High Q Learn UI/PWA/AI build prompt. Work against the existing HIGH-Q PHP/MySQL codebase, not an imagined new application. Inspect deployed routes, SSO, assessment eligibility, certificate system, AI provider integration, and database before coding. GitHub workflow changes are being handled in a separate draft PR: https://github.com/High-Q-Solid-Academy/.github/pull/10. Do not merge or modify those workflow files.

## Product architecture decisions

- Keep EXISTING V1 students in Academy-owned repositories. Do not migrate or rewrite historical repositories.
- Keep EXISTING V2 students in learner-owned repositories. New students should use V2 once the safety checks and protected portal are ready.
- Both V1 future course progression and V2 new course provisioning will use GitHub practical-only student bundles. The central academy-owned templates retain protected coursebooks, diagrams, instructor notes, premium videos and protected answer content.
- Both enrollment models must use the SAME High Q Learn web app, PWA, grade history, assessment engine and certificates. Ownership model is displayed only where relevant to GitHub/recovery operations.
- Lesson content must come from approved central GitHub template revisions via an authorization-checked PHP reader, NOT from a learner-owned repository.
- A user cannot be prevented from preserving content already received or cloned. Existing repository copies are not automatically destroyed or scrubbed.
- Until per-course manifest and grading regression testing is complete, only Git and HTML future student bundles are prepared. Unreviewed future courses must display a clearly explained migration/publishing blocker and never fall back to copying full protected templates.
- HIGH-Q AI student master toggle defaults OFF.

## Design the real app

Brand: High Q Learn. Preserve existing academy logo, dark navy/gold identity, accessible contrast, subtle teal progress, complete light/dark mode. High-quality, clean, restrained educational design (not generic AI visuals). Maintain persistent sidebar on desktop normal web; collapsible rail for tablet, accessible drawer on mobile web. Main menu: Continue Learning, Courses, Lessons, Videos, Labs, Progress, Assessments, Certificates, AI (if enabled), Support, Settings. Dashboard prioritizes next action, lesson, time estimate, evidence-based progress, and exactly why assessments are locked.

Installed PWA should be a DISTINCT interface shell, not the identical browser layout: compact header and bottom navigation on mobile standalone; compact navigation rail and lesson workspace on desktop standalone. Detect actual standalone display mode. DO NOT display PWA-installed badges. Share backend and login, and explicitly avoid caching premium lessons, authenticated API replies, secrets, grades, AI history or signed video tokens. Support captions, transcript, diagram, code blocks, quick practice, offline shell only, accessibility and lower-bandwidth devices.

Admin sidebar: Learner Roster, Enrollment V1/V2, Programmes, Curriculum, Lessons, Videos, GitHub Practicals, Grading, Assessments, Inactivity, Disenrollment Reviews, Resume Learner, Workflow Jobs & Logs, Certificates, HIGH-Q AI Access, AI Providers & Costs, Reports, Audit. Search/filter all enrolled learners, show last genuine learner activity, warnings, GitHub repo IDs, ownership, verified scores, incomplete checkpoints, and next course gating. Never fabricate student records.

## Backend integration expectations

Use existing PHP/MySQL, SSO and role checks; inspect and reuse current service implementations first. Design versioned reversible migrations rather than duplicate tables. Map immutable GitHub numeric user ID and repository ID to HIGH-Q account ID, verified enrollment version/track/course and current status. Support username changes. Preserve official GitHub grade verified by the academy and human review; student-owned workflow checks are only provisional when not verified by the central rubric.

All Admin workflow actions run through authenticated authorized SERVER code. Use allowlisted workflow dispatch names and validated inputs, CSRF protection and audit records, idempotent operation IDs, async queued/running/failed/succeeded status, correlated GitHub run links, signed webhook verification, replay protection, reconciler retries and no browser-side GitHub token. GitHub acceptance is not completion. Never bypass the required environment approval or exact confirmation for disenrollment.

Preserve: 4 inactive days -> one-day warning; after 5 full inactive days -> manual instructor review. Count meaningful learner-owned GitHub activity only. Existing V1 preservation/deletion and V2 pause/retain semantics remain distinct and must be disclosed before approval. Resume a learner at the correct course, preserving history.

Private course delivery should authorize each request, retrieve only approved academy curriculum versions, sanitize Markdown and SVG, use appropriate protected streaming media, log entitlement decisions without exposing secrets, and revoke lesson/video/AI access on pause. No premium material in V1/V2 student repos.

## Existing HIGH-Q AI + provider routing

Audit current Groq, OpenRouter and Gemini keys/configuration; reuse existing backend where suitable. Build model capability registry for latency, cost, context limits, coding accuracy, reasoning and vision support. Route by task. Basic explanations -> economical low-latency; complex code and concepts -> capable model; image analysis -> configured vision model; known facts about the current course -> retrieval first. Evaluate health, budgets, quotas, rate limits and safe bounded fallback on timeout/429/5xx. NEVER send every query to all three by default. Don't claim a provider supports a capability without a validated model config.

Use RAG from approved academy-owned, versioned GitHub modules: course ID, path, SHA, access level, source links and filtered retrieval. Do not ingest private student submissions into the shared index, instructor-private notes, hidden exam solutions, confidential credentials or exam question banks. Verified source references in answers; unknown source -> admit limitations.

Rich AI UI can render safe code, table, lesson card, diagrams, knowledge-check MCQs and citations using a strict server/client schema; NEVER execute arbitrary AI-generated HTML, JS or commands. Protected live assessments must block tutoring. All student AI endpoints enforce global_enabled AND per_student_enabled AND active_enrollment AND course_entitlement AND NOT protected_assessment with quotas. Global OFF overrides per-student ON. Instructor-only sandbox testing may be allowed separately.

## Proposed test suite (must implement, not assume)

1. Verify existing V1 students retain their accounts, repos, grades and current course.
2. Verify existing V2 students retain their account, repo ownership, and pause/resume state.
3. Test new V2 enrollment with the GitHub App and empty private repo in a disposable account, assert only practical files delivered.
4. Test V1 next-course repository provisioning in a sandbox, assert NO coursebooks or answer keys and correct protected GitHub settings.
5. Test unapproved Computer Engineering and later course bundles FAIL CLOSED without creating or modifying student repositories.
6. Test gradebook, instructor review and website-clearance gates stay authoritative.
7. Test signed webhook authentication, duplicate handling, audit trail and queued async GitHub operation confirmation.
8. Test 4-day warning, 5-day review, fresh activity clearing, V1 preserve/remove and V2 pause/retain behavior WITHOUT destructive production tests.
9. Test protected lessons and premium videos immediately deny paused/unauthorized students at the backend.
10. Test AI master OFF, individual OFF, provider-level OFF, rate/cost limits, safe fallback, no hidden-answer leakage and refusal in exams.
11. Test accessibility/responsiveness on desktop, tablet, 390px mobile web, installed mobile PWA and standalone desktop PWA. No accidental protected caches.
12. Rehearse reversible DB migrations, staging deployment and rollback with logs and screenshots.

## Deliverable and stop condition

First return a factual audit and UI mockups for owner review. Then create the real modular PHP/CSS/JS functionality in separate reviewable PRs with test evidence. No production deploy, migration, certificate policy change or GitHub PR merge without explicit owner approval. The GitHub PR contains the provisioning changes; this Antigravity work owns the website frontend/backend only.
