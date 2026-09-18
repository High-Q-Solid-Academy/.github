# High Q learner start guide

Welcome to the High Q Solid Academy software engineering program. You will receive one private course at a time and progress through eleven courses in order.

## Before your instructor enrolls you

1. Sign in to the GitHub account you will use throughout the program.
2. Open **GitHub → Settings → Public profile**.
3. Put your real first name and surname in the **Name** field and save it.
4. Accept the invitation to join the `High-Q-Solid-Academy` organization.
5. Send your exact GitHub username to your instructor.

Do not create copies of the academy's master course repositories. Your instructor will give you a separate private learner repository.

## Your course order

1. Git & GitHub Foundations
2. HTML5 Foundations
3. CSS3, Bootstrap 5 and Tailwind CSS
4. JavaScript ES6+
5. PHP and MySQL
6. Python Automation and Scripting
7. React.js
8. React with TypeScript
9. Node.js and Express REST APIs
10. AI and Prompt Engineering
11. Understanding Security and Vulnerabilities

You begin with **Git & GitHub Foundations**. You must earn at least **70/100** before the next private course is released.

Four major stage transitions also require a deployed project and human review:

| Completed stage | Required deployed capstone | Unlocks |
| --- | --- | --- |
| HTML, CSS, JavaScript, PHP and MySQL | Full-stack website | Python |
| Python | Production Python web application or API | React |
| React and React TypeScript | Production frontend application | Node.js and Express |
| Node.js and Express | Production backend API or full-stack service | AI and Prompt Engineering |

At these milestones, an automated exercise score alone does not unlock the next course.

## Accept and clone your assigned course

After enrollment, open your GitHub notifications and accept the repository invitation if GitHub displays one. Your first repository is named like:

```text
course-git-github-yourusername
```

Open that repository, select **Code → HTTPS**, copy its URL, and run:

```bash
git clone https://github.com/High-Q-Solid-Academy/course-git-github-yourusername.git
cd course-git-github-yourusername
```

Replace `yourusername` with your exact GitHub username.

## Complete and submit a lesson

1. Read `README.md` and `VIDEO_LESSONS.md` before editing exercises.
2. Create a branch for your work:

   ```bash
   git switch -c lesson/git-foundations
   ```

3. Complete the requested exercises and remove only the relevant `TODO` markers.
4. Run the course's test command shown in its README.
5. Save and push your work:

   ```bash
   git add .
   git commit -m "feat: complete Git foundations exercises"
   git push -u origin lesson/git-foundations
   ```

6. Open the link Git prints, or open the repository on GitHub, and create a pull request into `main`.
7. Wait for **Calculate course score** to finish. Open the check for module feedback and your numeric score.
8. Correct any failed exercises on the same branch, commit and push again. The pull request updates automatically.
9. When the score is at least 70, request instructor review. Only the instructor can approve changes to protected grading files and merge the pull request.

Never edit tests, grading scripts, workflow files, package manifests or `.highq/enrollment.json`. Changing those files does not count as solving an exercise and requires academy approval.

## Receiving the next course

After a passing pull request is approved and merged into `main`, GitHub grades `main`. The academy progression workflow then creates your next private repository and grants you access. The scheduled check runs daily; an instructor can also run it immediately.

The same process repeats for every course: learn, practise, test, push, open a pull request, receive a score, correct mistakes and pass.

## Submitting a major capstone

When a course contains `CAPSTONE.md`:

1. Build the complete project described in that file inside your assigned repository.
2. Merge the reviewed version to `main` and deploy the same commit to a public HTTPS address.
3. Open **Actions → Submit capstone for human review → Run workflow** in that repository.
4. Enter the HTTPS GitHub URL of the assigned repository, the live deployment URL and a detailed project summary.
5. Run the workflow. It checks that the GitHub URL belongs to the assigned repository, confirms the live site responds and opens a private review issue.
6. Demonstrate the project to the instructor and wait for the five-part human rubric.
7. If revision is required, fix the project, redeploy and submit again.

Both the automated course score and human capstone score must be at least 70/100. The report shows automated, human and combined final scores separately.

## How your results are recorded

Your report connects your real profile name, current GitHub username and permanent GitHub account ID. It shows every course score and pass status. The academy keeps downloadable digital records and print-ready report cards.

If you change your GitHub username, inform your instructor. Do not remove or replace your real profile name during the program, because the gradebook will flag an identity mismatch.

## If you cannot see your repository

- Confirm that you are signed in to the correct GitHub account.
- Check GitHub notifications and email for an invitation.
- Confirm that you accepted the academy organization invitation.
- Ask the instructor to verify the exact spelling of your GitHub username.
- Do not create a personal fork as a workaround.
