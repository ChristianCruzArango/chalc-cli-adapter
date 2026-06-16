# Tasks: <feature>

> **Tasks** phase — atomic, ordered tasks derived from `plan.md`.
> `[P]` = can be done in parallel. Each task references its requirement (`R1`…).
> The order within each task is **TDD**: failing test → code → refactor.

## Execution order

- [ ] **T1** (R1) — Write the test for <criterion R1> and confirm it **FAILS** (Red).
- [ ] **T2** (R1) — Implement the minimum code to pass T1 (Green) and refactor.
- [ ] **T3** (R2) `[P]` — Test for <criterion R2> FAILING, then implementation.
- [ ] **T4** — ...
- [ ] **Tm** — Mutation testing: run the tool and strengthen tests until the mutants are killed (score ≥ 80%).

## Rule
- Don't mark a code task done if its test didn't exist **before** and doesn't pass **now**.
- Run **mutation testing** when closing each block: if a mutant survives, strengthen the test until it's killed.
- When the feature is done: every requirement (R1, R2…) has a green test, **mutation score ≥ 80%**, and `spec.md` updated if anything changed.
