# specs/ — Spec-Driven Development (SDD)

The official folder is named **`specs/`** (plural). Do not use `spec/`, `spect/` or `specifications/`.
Every new feature lives in `specs/NNN-name/`.

The **spec is the source of truth**, not the code. Nothing is implemented without an approved spec,
and **no code is written before its tests** (Test-First).

> Based on GitHub Spec Kit (Constitution → Specify → Plan → Tasks → Implement, with strict TDD)
> and AWS Kiro (requirements in EARS notation, traceable to tests and tasks).

## The 5 phases (in order)

| Phase | File | What it produces |
|---|---|---|
| 1. Constitution | `constitution.md` | Non-negotiable principles (incl. Test-First). Read first, not improvised. |
| 2. Specify | `NNN-feature/spec.md` | The **what**: user stories + acceptance criteria in **EARS**. |
| 3. Plan | `NNN-feature/plan.md` | The **how**: architecture, data model, contracts, decisions. |
| 4. Tasks | `NNN-feature/tasks.md` | Atomic, ordered tasks, traced to requirements (`R1`…), `[P]` = parallel. |
| 5. Implement | (code + tests) | **Strict TDD**: failing test (Red) → minimum code (Green) → refactor. |

## How to start a feature

Recommended, to prepare the folder and empty files:

```bash
chalc spec
```

`chalc spec` writes no content: it only copies the template. The real spec is written in `spec.md`.

Manual:

```bash
cp -R specs/_template specs/001-login    # number and name the feature
```

Then fill `spec.md` → `plan.md` (approve) → `tasks.md` → implement with TDD.

## The non-negotiable order

```
spec  ──►  tests  ──►  code
(spec.md)  (tests)   (implementation)
```

If scope changes: **edit the spec first**, then the tests, then the code.

## Conventions

- One thing per file (interfaces / DTOs / types in their own file).
- Every task and every test references the requirement it fulfills (`R1`, `R2`…).
