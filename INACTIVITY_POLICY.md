# Learner inactivity and resumable disenrollment

High-Q evaluates only the learner's current unfinished course. Completed earlier courses and their progression records are never inactivity-cleanup targets.

## Timeline

- After **4 full days** without qualifying learner-originated activity, the learner receives an issue warning in the current course repository.
- The learner receives **1 additional full day** to resume.
- At 5 full inactive days, the issue becomes **INACTIVE — DISENROLLMENT REVIEW**.
- No scheduled process deletes a repository.
- Learner activity before approval closes the warning automatically.

Activity is attributed using the immutable GitHub account ID in `.highq/enrollment.json` and GitHub-recorded event timestamps. Commits and changes made by `MAVIS-creator`, instructors, maintainers, templates, bots, GitHub Actions and other automation do not reset the learner's timer.

## Manual approval

Run **Actions → Approve inactive learner disenrollment** with the learner's current username and the exact confirmation `DISENROLL USERNAME`.

The workflow rechecks all safeguards, captures the current score/status, course position, completed labs/checkpoints and a bounded snapshot of learner exercise/project work, and saves it in the private `highq-learner-records` repository. Only after that record succeeds does it delete the current unfinished repository. Completed earlier course repositories remain intact.

## Return and resume

Run **Actions → Resume paused learner** with `RESUME USERNAME`. The workflow recreates the course from which the learner was removed, restores the saved exercise/project files in one commit, reapplies enrollment and protection, and reruns grading. The ordinary enrollment workflow refuses to restart a learner who has a paused-course record.

For an additional human gate, configure the `learner-disenrollment` GitHub environment with the academy owner as required reviewer.
