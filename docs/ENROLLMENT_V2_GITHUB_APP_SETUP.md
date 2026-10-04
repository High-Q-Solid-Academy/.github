# High Q Enrollment V2 — GitHub App setup

Enrollment V2 creates future High Q course repositories inside each learner's personal GitHub account while keeping the academy's curriculum templates private.

Existing academy-owned learner repositories are not migrated by this setup.

## 1. Create the GitHub App

Create a GitHub App owned by **High-Q-Solid-Academy**.

Suggested name: **High Q Learner Courses**

The App must be installable on personal accounts because future learners install it on their own GitHub account before enrollment.

### Repository permissions

Grant the minimum permissions needed by the current Enrollment V2 code:

- **Metadata:** Read
- **Contents:** Read and write
- **Issues:** Read and write
- **Commit statuses:** Read and write
- **Pull requests:** Read and write
- **Administration:** Read and write

Administration write is used for creating/configuring the learner-owned repository and applying repository settings when GitHub permits them.

The App does not need permission to delete a learner-owned repository. High Q never deletes Enrollment V2 personal repositories during inactivity disenrollment.

## 2. Repository access when learners install the App

For the smoothest enrollment/progression flow, the learner should grant the App access that will include newly created High Q repositories.

If GitHub offers **All repositories**, this avoids requiring the learner to revisit App settings every time the next course is unlocked.

High Q only records and acts on repositories registered in the private `highq-learner-records` registry. Other repositories in the learner account are outside the curriculum workflow.

## 3. Create a private key

From the GitHub App settings, generate a private key.

Keep the downloaded key private. Never commit it to a repository.

## 4. Add repository secrets to `High-Q-Solid-Academy/.github`

Create these Actions secrets:

- `HIGHQ_GITHUB_APP_ID` — numeric App ID
- `HIGHQ_GITHUB_APP_PRIVATE_KEY` — complete PEM private key contents
- `HIGHQ_GITHUB_APP_SLUG` — App slug used in `https://github.com/apps/<slug>`

`CURRICULUM_ADMIN_TOKEN` remains the academy-side token used to read private curriculum templates and maintain the private learner registry.

## 5. New learner enrollment flow

1. Learner creates/uses their personal GitHub account.
2. Learner sets their real **Name** on the GitHub public profile.
3. Learner installs the High Q GitHub App on their account.
4. Instructor opens **Actions → Enroll learner in programme** in `High-Q-Solid-Academy/.github`.
5. Enter:
   - exact GitHub username
   - real name
   - email address
   - programme
6. Run the workflow.

For a brand-new learner, High Q creates a private repository such as:

`learner/highq-git-github`

The repository is owned by the learner. High Q retains curriculum access through the GitHub App installation.

## 6. What stays in the academy organization

The source curriculum/template repositories stay private under **High-Q-Solid-Academy**.

Enrollment V2 does not expose or transfer the private template repository. The provisioning workflow reads the academy template and writes a course copy into the learner-owned repository.

The private central registry remains:

`High-Q-Solid-Academy/highq-learner-records`

It stores the learner identity, programme, GitHub App installation ID, current course repository and course-repository history.

## 7. Inactivity behavior

For Enrollment V2:

- 4 full inactive days → warning
- 1 additional grace day → instructor review
- instructor selects learner in the private checkbox dashboard
- approved disenrollment → **High Q enrollment is paused**
- learner-owned repository → **not deleted**
- resume → the same personal repository is reactivated in the High Q programme

Legacy academy-owned learners keep the existing preserve-and-remove/resume behavior.

## 8. Grading note

The copied course repository still contains the learner-facing autograder for immediate feedback.

High Q's central grade readers already prefer the reserved status context `highq/official-grade` when it exists, and fall back to `highq/autograding` for compatibility.

A separate trusted official-grading pipeline should publish `highq/official-grade` before treating learner-owned repositories as tamper-resistant final grades. Until that central grader is enabled, the learner-facing autograder should be treated as formative rather than the final authoritative grade.
