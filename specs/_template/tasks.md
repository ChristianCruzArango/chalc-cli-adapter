# Tasks: <feature>

> Fase **Tasks** — tareas atómicas y ordenadas, derivadas de `plan.md`.
> `[P]` = se puede hacer en paralelo. Cada tarea referencia su requisito (`R1`…).
> El orden dentro de cada tarea es **TDD**: test que falla → código → refactor.

## Orden de ejecución

- [ ] **T1** (R1) — Escribir test de <criterio R1> y confirmarlo en **FALLO** (Red).
- [ ] **T2** (R1) — Implementar el mínimo código para pasar T1 (Green) y refactorizar.
- [ ] **T3** (R2) `[P]` — Test de <criterio R2> en FALLO, luego implementación.
- [ ] **T4** — ...

## Regla
- No marques una tarea de código como hecha si su test no existía **antes** y no pasa **ahora**.
- Al terminar la feature: revisa que cada requisito (R1, R2…) tenga test verde y actualiza `spec.md` si algo cambió.
