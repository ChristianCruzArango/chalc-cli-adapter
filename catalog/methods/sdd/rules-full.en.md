## ⚙️ Method: Spec-Driven Development (SDD) — full mode

This project works **spec-first**. The spec is the **source of truth**, not the code.
The order is **non-negotiable**: **spec → tests → code**. Never write code before
you have tests that **fail** (Red).

### Mandatory flow (in order)
1. **Constitution** — read `specs/constitution.md` first (non-negotiable principles, includes Test-First).
2. **Specify** → `specs/NNN-feature/spec.md` — the **WHAT**: user stories + criteria in **EARS** (`WHEN … THE SYSTEM SHALL …`).
3. **Research** → `research.md` — technical options evaluated and the decision.
4. **Plan** → `plan.md` — the **HOW**: architecture and decisions. Ask for approval.
   - **Data model** → `data-model.md` (entities, fields, relations, validations).
   - **Contracts** → `contracts/<resource>.<action>.contract.md` (one per file).
   - **Validation** → `quickstart.md` (end-to-end scenarios).
5. **Tasks** → `tasks.md` — atomic, ordered tasks, traced to requirements (`R1`…), `[P]` = parallel.
6. **Implement (strict TDD)** — per task: test from the contract/criterion → confirm it **FAILS** (Red) → minimum code (Green) → refactor.
7. **Task closing — the advisor decides, not your memory:** run `node .chalc/next.mjs`, do what `NEXT_ACTION` says and run its `COMMAND` if it is not empty; ask again and repeat until it answers `done`. It reads the real state of the repo (evidence date, gate verdict, reviewer log, `tasks.md`), so do not skip an action and do not decide the order yourself. `ask_human` is the only answer that stops the loop: stop and report it. What measures is the gate (`node .chalc/gate.mjs`): it requires a mutation score of ≥ 80% and lists the survivors, so when the advisor says `fix_gate`, what is missing are tests that kill mutants — not retries.

### Hard rules
- **Test-First:** no code before a failing, approved test.
- **Traceability:** every requirement, contract, test and task references its `R#`.
- **Living spec:** if scope changes, update the spec (and data-model/contracts) first.
- **One thing per file:** interfaces, DTOs, types and each contract in their own file.

### How to work (stay focused)
- **One task at a time:** before each task, state which `R#` it implements; when done, stop and wait for OK.
- **Skills on demand:** open only the skill the active task needs (`.claude/skills` or `.chalc/skills`); don't preload them all.
- **Bounded reading:** read the constitution, this spec/plan/tasks (and data-model/contracts) and the files the task touches; don't explore the whole repo.
- **Project tooling:** use the test framework and config the project **already** has; don't invent config. If tooling is missing, the registry is private, or something won't compile, report it as a blocker and ask — don't improvise or switch tools on your own.

For a new feature: copy `specs/_template/` to `specs/NNN-name/`.
The official folder is always `specs/` (plural). If available, use `chalc spec` only to prepare the empty folder and files; it does not write the spec.
