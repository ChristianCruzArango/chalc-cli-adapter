# Tasks: <feature>

> Fase **Tasks** — tareas atómicas y ordenadas, derivadas de `plan.md`.
> `[P]` = se puede hacer en paralelo. Cada tarea referencia su requisito (`R1`…).
> El orden dentro de cada tarea es **TDD**: test que falla → código → refactor.

## Orden de ejecución

- [ ] **T1** (R1) — Tests de <criterio R1> en rojo y registrados (`node .chalc/gate.mjs --red`) → código mínimo → refactor.
- [ ] **T2** (R2) `[P]` — Tests de <criterio R2> en rojo y registrados → código mínimo → refactor.
- [ ] **T3** (R3) — ...

## Regla
- Cada tarea lleva sus tests Y su código: no hay una tarea «de tests» y otra «de código» (el portón cierra una tarea con los tests en verde, y exige que su rojo se registrara antes del código).
- Un test sellado en el rojo no se afloja: para cambiarlo, hazlo fallar otra vez y vuelve a registrarlo.
- La mutación no es una tarea aparte: el portón (`node .chalc/gate.mjs`) la exige al cerrar CADA tarea (score ≥ 80%). Si un mutante sobrevive, refuerza el test hasta matarlo.
- Toda tarea cita su requisito: una tarea sin `R#` bloquea la spec.
- Al terminar la feature: cada requisito (R1, R2…) con test verde, **mutation score ≥ 80%**, y `spec.md` actualizada si algo cambió.
