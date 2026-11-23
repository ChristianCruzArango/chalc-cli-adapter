# Tasks: <feature>

> **Tasks** phase — atomic, ordered tasks derived from `plan.md`.
> `[P]` = can be done in parallel. Each task references its requirement (`R1`…).
> The order within each task is **TDD**: failing test → code → refactor.

## Execution order

- [ ] **T1** (R1) — Tests for <criterion R1> failing and registered (`node .chalc/gate.mjs --red`) → minimum code → refactor.
- [ ] **T2** (R2) `[P]` — Tests for <criterion R2> failing and registered → minimum code → refactor.
- [ ] **T3** (R3) — ...

## Rule
- Every task carries its tests AND its code: there is no "tests" task and a separate "code" task (the gate closes a task with the tests green, and requires its red to have been registered before the code).
- A test sealed at the red is not loosened: to change it, make it fail again and register it again.
- Mutation is not a separate task: the gate (`node .chalc/gate.mjs`) demands it when closing EVERY task (score ≥ 80%). If a mutant survives, strengthen the test until it's killed.
- Every task cites its requirement: a task without an `R#` blocks the spec.
- When the feature is done: every requirement (R1, R2…) has a green test, **mutation score ≥ 80%**, and `spec.md` updated if anything changed.
