# High Q instructor gradebook setup

The course repositories publish a numeric `highq/autograding` commit status after every push. This repository collects those statuses into one instructor-only Actions summary plus downloadable CSV, JSON and print-ready HTML files. A separate progression workflow creates the next private course repository only after the learner reaches the configured 70% pass mark.

## Locked curriculum order

Git & GitHub → HTML5 → CSS3/Bootstrap/Tailwind → JavaScript → PHP/MySQL → Python → React → React/TypeScript → Node/Express → AI/Prompt Engineering → Security & Vulnerabilities.

The source of truth is [`gradebook/courses.json`](gradebook/courses.json). Each entry contains its order, prerequisite, template repository, learner-repository prefix and pass score.

## Repository naming

Create each student repository from the appropriate course template and name it with the configured prefix plus the student's GitHub username. Example:

```text
course-javascript-core-mavis-creator
```

Prefixes are configured in [`gradebook/courses.json`](gradebook/courses.json). Change them there if Classroom 50 uses a different classroom/assignment prefix.

## One-time organization setup

1. In organization **Settings → Member privileges**, set the base repository permission to **None** and disable member-created organization repositories. Otherwise organization members can see every private course template and bypass the progression lock.
2. Create a fine-grained GitHub personal access token from an organization-owned service account.
3. Give the gradebook token read access to **Contents**, **Metadata** and **Commit statuses** for the student repositories.
4. In the `High-Q-Solid-Academy/.github` repository, open **Settings → Secrets and variables → Actions**.
5. Add the token as a repository secret named `GRADEBOOK_TOKEN`.
6. Open **Actions → Collect High Q student grades → Run workflow**.

## One-time locked-progression setup

1. Make every course source repository a GitHub **template repository**.
2. Make course templates and generated learner repositories **private**. A public template cannot be hidden from learners, so it cannot enforce the requested lock.
3. Create a separate fine-grained service-account token with access to all academy course repositories. Under **Repository permissions**, select **Administration: Read and write**, **Contents: Read and write**, and **Commit statuses: Read-only**. Metadata read access is included automatically. GitHub has no separate "Collaborator management" permission: adding a repository collaborator, creating repositories and configuring branch protection are covered by **Administration: Read and write**.
4. Store it in this repository as `CURRICULUM_ADMIN_TOKEN`.
5. Before enrollment, ask the learner to open **GitHub → Settings → Public profile → Name** and enter their real first name and surname.
6. To start a learner, run **Actions → Enroll learner in first course**, enter the exact GitHub username and the same real name. Enrollment stops if the names do not match. Ask the learner to accept the collaborator invitation.
7. The scheduled **Unlock next course for passing learners** workflow checks scores daily. It creates and invites the learner to only the next course after a passing grade. A manual run defaults to dry-run mode so instructors can preview changes safely.

Each private learner repository contains `.highq/enrollment.json` on protected `main`. It binds the instructor-entered real name to GitHub's immutable numeric user ID. The gradebook resolves the current username from that ID, so a later username change does not lose the learner's records. It also warns when the learner changes or removes the real name on their public GitHub profile.

Generated repositories protect `main`: learners submit a pull request, the `Calculate course score` check must pass, one instructor approval is required, stale approvals are dismissed, and force-pushes/deletions are blocked. This prevents a learner from quietly replacing the tests or grading workflow on the graded branch. If the workflow summary reports branch protection as unavailable, check the organization's GitHub plan and repository rules before relying on the score.

> **Private-repository plan requirement:** GitHub Free for organizations does not support protected branches on private repositories. The course-hiding system still works, but authoritative anti-tamper enforcement on private learner repositories requires GitHub Team, GitHub Enterprise Cloud or an eligible GitHub Education benefit. On GitHub Free, treat automated scores as provisional: review the learner's commits and grading-file diff before accepting a result, and do not approve changes to workflows, tests, scripts, package manifests or `.highq/enrollment.json`.

Keep `GRADEBOOK_TOKEN` read-only. Do not reuse the more powerful curriculum administration token for gradebook collection.

The workflow also runs daily at 7:15 PM West Africa Time. The summary lists each learner's real name, current GitHub username, immutable GitHub ID, course, score, identity status and details link. The complete records are available as the `highq-instructor-gradebook` artifact. Download `gradebook.html`, open it in a browser and use **Print** for paper records or **Save as PDF** for a digital signed copy.

## Email the styled reports

GitHub Actions cannot send mail from your address until an email provider authenticates it. The workflow uses Python's built-in SMTP support and needs no npm or Python package installation.

For Gmail or Google Workspace, enable two-step verification on the sending mailbox and create an app password. In **Settings → Secrets and variables → Actions**, add these repository secrets:

| Secret | Value |
| --- | --- |
| `REPORT_SMTP_HOST` | `smtp.gmail.com` |
| `REPORT_SMTP_PORT` | `465` |
| `REPORT_SMTP_SECURITY` | `ssl` for port 465, or `starttls` for port 587 |
| `REPORT_SMTP_USERNAME` | The Gmail or Google Workspace sending address |
| `REPORT_SMTP_PASSWORD` | Its 16-character Google app password, not the normal mailbox password |
| `REPORT_EMAIL_FROM` | Usually the same address as `REPORT_SMTP_USERNAME` |
| `REPORT_EMAIL_RECIPIENTS` | `akintunde.dolapo1@gmail.com,highqsol@highqsolidacademy.com,highqsolidacademy@gmail.com` |

If any required email secret is absent, report collection still succeeds and clearly records that email was skipped. Open **Actions → Collect High Q student grades → latest run → Artifacts → highq-instructor-gradebook** to download the files. If SMTP authentication fails, the email step fails but the artifact upload still runs because it is independent; use **Re-run failed jobs** after correcting the secrets.

Never store the app password, learner personal details or recipient list directly in a workflow file. The real-name enrollment record belongs only in each private learner repository.

## Recommended learner workflow

Do not ask learners to fork or clone the master template into their own personal accounts. A personal fork gives them control over repository settings and grading files. Instead:

1. Keep every master course template private and instructor-only.
2. Enroll each learner through the `.github` workflow, which creates a separate private repository inside the academy organization.
3. Give the learner `push` access but protect `main`; they work on a named branch and open a pull request.
4. Require the autograding check and one instructor approval before merging.
5. Keep tests, workflow files and `.highq/enrollment.json` protected through `CODEOWNERS` or repository rules.
6. Unlock only the next course after the preceding protected-main score reaches the pass mark.

Learners still clone their assigned private academy repository to their computers for normal work. The important distinction is that the authoritative remote repository remains under the academy organization, not under the learner's personal account.

## Classroom 50

GitHub Classroom was retired on August 28, 2026. For new classes, use Classroom 50 for roster management, assignment acceptance and its web dashboard. These course repositories can remain the starter/template content; the numeric grade contract added here is also usable without the retired GitHub Classroom application.

Do not place a token in this repository or in a workflow file. Store it only as the encrypted Actions secret described above.
