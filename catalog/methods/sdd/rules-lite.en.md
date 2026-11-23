## ⚙️ Method: Spec-Driven Development (SDD)

This project works **spec-first**. The spec is the **source of truth**, not the code.
The order is **non-negotiable**: **spec → tests → code**. Never write code before
you have tests that **fail** (Red).

### Mandatory flow (5 phases, in order)
1. **Constitution** — read `specs/constitution.md` first. Non-negotiable principles (includes Test-First).
2. **Specify** → `specs/NNN-feature/spec.md` — the **WHAT** and the **WHY**. User stories + acceptance criteria in **EARS notation** (`WHEN … THE SYSTEM SHALL …`). No implementation details. Before anything else, `hu.md`: the user story **exactly as** the user delivered it, with its `Source:` line (from a URL or a file it is fetched with `chalc spec --azure <url>`, also `--jira`, `--url` or `--doc`; never ask for a token to be pasted into the chat). Every requirement cites the fragment it comes from (`HU-n`).
3. **Plan** → `plan.md` — the **HOW**: architecture, data model, contracts/interfaces, decisions. It declares `Touches:` (the paths or globs the spec may modify; anything outside blocks the delivery) and, where it applies, `Depends on:` (the specs that must be integrated first). It also declares `Surface:` (`ui`, `api`, `cli` or `none`): with `ui`, the folder also carries `design.md` —the composition of each screen, written by the `disenador` role and approved with the spec—. With `api` or `cli`, the folder carries `probes.json`: the probes (requests or commands, with what is expected) the running service has to meet before delivery.
4. **Tasks** → `tasks.md` — atomic, ordered tasks, each **traced to a requirement** (`R1`, `R2`…). `[P]` marks parallelizable ones.
5. **Implement (strict TDD)** — for each task:
   1. Write the **tests** from the acceptance criteria.
   2. Confirm they **FAIL** (Red).
   3. Write the **minimum code** to pass them (Green).
   4. Refactor without breaking tests.
   5. **Task closing — the advisor decides, not your memory:** run `node .chalc/next.mjs`, do what `NEXT_ACTION` says and run its `COMMAND` if it is not empty; ask again and repeat until it answers `done`. It reads the real state of the repo (evidence date, gate verdict, reviewer log, `tasks.md`), so do not skip an action and do not decide the order yourself. `ask_human`, `approve_spec` and `approve_feature` are the only answers that stop the loop: stop and report it. What measures is the gate (`node .chalc/gate.mjs`): it requires a mutation score of ≥ 80% and lists the survivors, so when the advisor says `fix_gate`, what is missing are tests that kill mutants — not retries.

### Hard rules
- **Spec gate — no tests or code before it:** run `node .chalc/next.mjs` when you finish drafting. While it answers `fix_specs`, fix what it lists (the `especificador` role drafts); on `call_role analista`, THAT role reviews it against the user story, not whoever wrote it; on `approve_spec`, **STOP**: only the user approves the spec, in THEIR terminal, with `node .chalc/gate.mjs --approve-spec`. Do not run that command yourself, do not write the seal by hand, and do not treat the spec as approved. Editing the story, the spec, the plan or the tasks afterwards invalidates the approval.
- **Close — only the user:** when the advisor answers `approve_feature`, everything is done, measured and reviewed. **STOP**: hand over the summary of what was done and wait. The close is approved only by the user, in THEIR terminal, with `node .chalc/gate.mjs --approve-feature`; do not run that command yourself.
- **Sealed red — tests come first, with evidence:** in each task write ONLY its tests, see them fail and register them with `node .chalc/gate.mjs --red` (the advisor asks for it with `red_task`). Without that record the gate rejects production code. Sealed tests are not loosened: to change one, make it fail again and register it again. Cite every requirement of the task in its tests. If a task truly carries no tests: `--red --skip "<reason>"`.
- **Test-First:** no implementation code before a failing, approved test.
- **Traceability:** every task and every test points to a requirement in the spec.
- **Living spec:** if the code or scope changes, update the spec first.
- **One thing per file:** interfaces, DTOs and types in their own file, never inside services/components.
- **Secure code:** BEFORE writing code that touches external input, authentication, sessions, permissions, secrets, storage, network, cryptography or logs, open the `secure-coding` skill (the section for your stack, which points you to the exact reference) and apply it. It is the exception to "skills on demand". The gate blocks the security signals visible on a line and the `seguridad` role reviews OWASP on every task; if it leaves findings, fix them starting with a test that demonstrates the vulnerability.

### How to work (stay focused)
- **Live board (`chalc-live`).** If the user runs the `chalc-live` command (`/chalc-live`; in Codex, `$chalc-live`), or asks where you are, how the work is going or asks for the board, run `node .chalc/live.mjs` and answer with the URL it prints: a local page showing the task in progress, what the gate ran, each role and what is missing, refreshing itself while you work. Do not describe the state yourself: hand over the URL.
- **Project memory:** when writing a spec, fill `Concepts:` from `node .chalc/memory.mjs concepts` (a new one only if none fits): with them the advisor hands you, on each task, the rules the project already learned. For something specific, search with `node .chalc/memory.mjs search <words>` before exploring the repo.
- **One task at a time:** before each task, state which `R#` it implements; when done, carry on with what the advisor says. There is no per-task approval: between the spec and the close, you work on your own.
- **Skills on demand:** open only the skill the active task needs (`.claude/skills` or `.chalc/skills`); don't preload them all.
- **Bounded reading:** read the constitution, this spec/plan/tasks and the files the task touches; don't explore the whole repo.
- **Project tooling:** use the test framework and config the project **already** has; don't invent config. If tooling is missing, the registry is private, or something won't compile, report it as a blocker and ask — don't improvise or switch tools on your own.

Templates in `specs/_template/`. For a new feature: copy `_template/` to `specs/NNN-name/`.
The official folder is always `specs/` (plural). `chalc spec` creates the next folder from the templates and, given a source, copies the user story into `hu.md`; it does not write the spec.
