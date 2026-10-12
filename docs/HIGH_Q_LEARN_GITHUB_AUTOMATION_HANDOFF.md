# High Q Learn — GitHub automation handoff

## Scope of this PR

Enrollment V2 is learner-owned. Existing `gradebook/curriculum-api.mjs` copied the entire private academy template into each student's personal repository. This PR replaces that behavior with the exact paths reviewed in `gradebook/v2-student-delivery.json`. A short generated README directs students to High Q Learn for protected curriculum content.

### Approved pilots

- `git` — practical student evidence files, required workflow, exercises and tests.
- `html` — four HTML exercise starters and formative validation workflow/test dependencies.
- Every other course, including Computer Engineering Foundations, **fails closed** until an individually reviewed, grader-compatible file list is approved. This is intentional. Never fall back to a full template copy.
- The V1 path is unchanged. No existing V2 repository is rewritten, deleted or cleaned. Previously copied content cannot be remotely recalled.

## Responsibility split

| System | Responsibility |
| --- | --- |
| GitHub workflows / scripts | Trusted enrollment orchestration, V2 student bundle creation, learner code and PR activity, inactivity warnings, approved disenrollment/resumption, official grade evidence |
| High Q Learn website (Antigravity) | Authenticated private lessons/videos, student/admin web and PWA interfaces, per-learner status, course permissions, signed webhook ingestion, auditable admin action requests |
| HIGH-Q AI gateway (Antigravity) | Groq/OpenRouter/Gemini server-side routing, course-grounded retrieval, cost/rate controls, global/per-student access switches; OFF by default |

## Existing GitHub Action entry points

| Action | Workflow | Safeguards |
| --- | --- | --- |
| Enroll learner | `.github/workflows/enroll-student.yml` | Identity/track verification, V1 preserved, V2 learner creates private empty repo and installs App |
| Monitor inactivity | `.github/workflows/monitor-learner-inactivity.yml` | Four-day warning, five-day human review; learner-only activity |
| Disenroll | `.github/workflows/approve-inactive-disenrollment.yml` | Requires selected learners in private review dashboard, `DISENROLL SELECTED`, runtime recheck and protected environment; V2 pauses, V1 preserves/removes |
| Resume | `.github/workflows/resume-paused-learner.yml` | Requires username and `RESUME USERNAME`, protected environment |
| Gradebook + website | `.github/workflows/collect-gradebook.yml` | Only when official sync flag/secret is configured; HTTPS authenticated site import |
| Course progression | `.github/workflows/unlock-next-course.yml` | Approved score, website clearance and authorized next-course provisioning |

Admin portal should call these workflows from its **server**, not from browser JavaScript. Record request ID, actor, action, learner immutable GitHub ID, workflow dispatch/run ID, result, errors and timestamps. GitHub workflow dispatch may not return a run ID immediately: correlate by guarded audit metadata/time, and show 'queued' rather than inventing success. Read back confirmed status before updating portal state. GitHub environment approval remains effective; Admin approval is not a substitute.

## Content & AI protections

- Academy coursebooks, video references/transcripts, lessons, instructor notes, answer keys, diagrams, and teaching materials live behind the website's authorization layer and are NOT in learner-owned repositories.
- Students retain their own code/commits/PRs on pause or cancellation; we cannot erase copies already cloned.
- Webhooks must be verified by signature, bound to immutable student ID and repo ID, deduplicated and replay-safe.
- Never reveal GitHub App secrets, course source tokens, Groq/OpenRouter/Gemini keys, or protected content in page source, JS bundles, the PWA cache, or AI logs.
- Retrieval-augmented answers must use approved, versioned academy curriculum only, permission-scoped to a learner's enrolled courses.
- Student AI is OFF by default. Global OFF overrides all per-student ON settings. Block AI in protected/timed assessments.
- Multi-provider routing uses task-specific providers, capped budgets and one bounded fallback. Do not call all three models for every question.
- Render AI-supplied structured components only after schema validation and sanitization. Never execute AI-provided HTML, scripts or arbitrary tool commands.

## Release gates

1. CI syntax and policy tests pass; reviewer examines all file allowlists and confirms no premium/secret data are copied.
2. On an isolated test GitHub account, install App, prepare empty `highq-git-github`, enroll V2, inspect every delivered file and verify Git grading and PR workflow.
3. Test progression to a second V2 HTML course, website clearance, official grade synchronization, pause/resume, and refusal to provision a course without an approved bundle.
4. Prepare verified manifests and separate student-compatible validation before activating Computer Engineering or later courses.
5. Validate the website admin dashboard, session authorization, AI global OFF and per-user controls in staging. Do not merge/deploy merely because mockups look good.
