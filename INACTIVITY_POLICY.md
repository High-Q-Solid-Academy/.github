# Learner inactivity policy

High-Q learner-course repositories use an inactivity review policy to keep the organization tidy without treating instructor/template maintenance as learner progress.

## Policy

- Inactivity threshold: **4 full days** with no qualifying learner-originated activity in the learner's current unfinished course repository.
- Grace period after warning: **1 full day**.
- Activity from `MAVIS-creator`, maintainers, template maintenance, bots, or GitHub Actions does **not** count as learner activity.
- Existing learners and future learners are checked under the same rule.
- A learner who resumes qualifying activity during the grace period has the inactivity episode cleared.
- After the grace period, the repository is sent to **manual instructor review**. Nothing is deleted by the scanner.
- Completed prior-course repositories are never inactivity-cleanup targets.
- If learner activity attribution is unclear, the system opens a manual-review item rather than making a deletion recommendation.

## Daily scan

The existing `Collect High Q student grades` workflow also runs:

```bash
node gradebook/check-learner-inactivity.mjs
```

The scanner creates a warning issue inside the learner's current course repository after 4 full inactive days. The issue mentions the learner so the warning appears in their GitHub notifications. After one additional inactive day, the scanner creates an instructor review issue in the central `.github` repository.

## Instructor approval

Repository removal is intentionally a separate explicit admin action. The approval script validates that:

1. the repository belongs to a configured learner course;
2. an enrollment record exists and resolves to the learner;
3. the repository is the learner's current/highest course, not an earlier completed course;
4. the course has not already passed its automated completion gate;
5. an open inactivity-review issue exists;
6. the 1-day grace deadline has passed; and
7. the instructor supplies the exact confirmation string.

From a secure admin checkout with `CURRICULUM_ADMIN_TOKEN` and `CURRICULUM_ORG=High-Q-Solid-Academy` configured:

```bash
COURSE_REPOSITORY='course-name-student' \
DISENROLL_CONFIRMATION='DISENROLL course-name-student' \
CURRICULUM_INSTRUCTOR_LOGIN='MAVIS-creator' \
node gradebook/approve-inactive-disenrollment.mjs
```

The script posts a final notice to the learner before repository removal, preserves earlier completed course repositories, records the deletion in the central review issue, and stores the course ID to resume from later.

## Re-enrollment

The normal enrollment script checks central completed inactivity records. If a learner was previously removed for inactivity, re-enrollment recreates the removed course rather than restarting the learner at Git foundations. Earlier completed courses remain untouched.

## Important boundary

The activity scanner never deletes a learner repository automatically. The destructive step requires a separate explicit instructor/admin confirmation.
