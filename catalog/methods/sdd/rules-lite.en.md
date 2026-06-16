## ⚙️ Method: Spec-Driven Development (SDD)

This project works **spec-first**. The spec is the **source of truth**, not the code.
The order is **non-negotiable**: **spec → tests → code**. Never write code before
you have tests that **fail** (Red).

### Mandatory flow (5 phases, in order)
1. **Constitution** — read `specs/constitution.md` first. Non-negotiable principles (includes Test-First).
2. **Specify** → `specs/NNN-feature/spec.md` — the **WHAT** and the **WHY**. User stories + acceptance criteria in **EARS notation** (`WHEN … THE SYSTEM SHALL …`). No implementation details.
3. **Plan** → `plan.md` — the **HOW**: architecture, data model, contracts/interfaces, decisions. Ask for approval before continuing.
4. **Tasks** → `tasks.md` — atomic, ordered tasks, each **traced to a requirement** (`R1`, `R2`…). `[P]` marks parallelizable ones.
5. **Implement (strict TDD)** — for each task:
   1. Write the **tests** from the acceptance criteria.
   2. Confirm they **FAIL** (Red).
   3. Write the **minimum code** to pass them (Green).
   4. Refactor without breaking tests.
   5. Run **mutation testing** using the project's `mutation-testing` skill; if mutants survive, strengthen the tests until they are killed (score ≥ 80%).

### Hard rules
- **Test-First:** no implementation code before a failing, approved test.
- **Traceability:** every task and every test points to a requirement in the spec.
- **Living spec:** if the code or scope changes, update the spec first.
- **One thing per file:** interfaces, DTOs and types in their own file, never inside services/components.

Templates in `specs/_template/`. For a new feature: copy `_template/` to `specs/NNN-name/`.
The official folder is always `specs/` (plural). If available, use `chalc spec` only to prepare the empty folder and files; it does not write the spec.
