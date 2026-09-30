# High-Q curriculum tracks

High-Q uses one shared enrollment system with two explicit programme tracks.

## Enrollment

The enrollment workflow requires the instructor to choose one programme:

- `computer-science` — Computer Science
- `computer-engineering` — Computer Engineering

Both programmes begin with the shared **Git & GitHub Foundations** repository. The selected programme is stored in `.highq/enrollment.json` and is carried into every later learner repository.

Legacy learner records created before programme selection existed are assigned to **Computer Science** during migration. They must never be moved to Computer Engineering automatically.

## Computer Science

1. Git & GitHub Foundations
2. HTML5 Foundations
3. CSS3, Bootstrap 5 & Tailwind CSS
4. JavaScript (ES6+)
5. PHP & MySQL
6. Python Automation & Engineering Tools (shared repository, CS path)
7. React.js
8. React with TypeScript
9. Node.js & Express REST APIs
10. AI & Prompt Engineering
11. Understanding Security & Vulnerabilities (shared repository, CS path)

## Computer Engineering

1. Git & GitHub Foundations
2. Computer Engineering Foundations
3. Embedded Systems & Microcontrollers
4. Python Automation & Engineering Tools (shared repository, engineering track)
5. Computer Architecture, Assembly & HDL
6. C++ Systems, RTOS & Robotics
7. Understanding Security & Vulnerabilities (shared repository, embedded/IoT track)

## Progression safety

`unlock-next-course.mjs` reads the learner's recorded programme before calculating the next course. A Computer Science learner therefore cannot be sent into a Computer Engineering repository simply because that template exists, and a Computer Engineering learner skips the web-development-only sequence.

Changing an existing learner's programme is intentionally not performed by the normal enrollment workflow. Programme changes require an explicit migration decision so completed shared courses can be preserved safely.
