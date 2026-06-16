## ⚙️ Método: Spec-Driven Development (SDD)

Este proyecto trabaja **por especificación**. La spec es la **fuente de verdad**, no el código.
El orden es **innegociable**: **especificación → pruebas → código**. Nunca escribas código antes
de tener tests que **fallen** (Red).

### Flujo obligatorio (5 fases, en orden)
1. **Constitución** — lee `specs/constitution.md` antes de nada. Son principios no negociables (incluye Test-First).
2. **Specify** → `specs/NNN-feature/spec.md` — el **QUÉ** y el **PORQUÉ**. Historias de usuario + criterios de aceptación en **notación EARS** (`WHEN … THE SYSTEM SHALL …`). Sin detalles de implementación.
3. **Plan** → `plan.md` — el **CÓMO**: arquitectura, modelo de datos, contratos/interfaces, decisiones. Pide aprobación antes de seguir.
4. **Tasks** → `tasks.md` — tareas atómicas y ordenadas, cada una **trazada a un requisito** (`R1`, `R2`…). `[P]` marca las paralelizables.
5. **Implement (TDD estricto)** — por cada tarea:
   1. Escribe los **tests** desde los criterios de aceptación.
   2. Confírmalos en **FALLO** (Red).
   3. Escribe el **mínimo código** para pasarlos (Green).
   4. Refactoriza sin romper tests.
   5. Corre **mutation testing** apoyándote en la skill `mutation-testing` del proyecto; si sobreviven mutantes, refuerza los tests hasta matarlos (score ≥ 80%).

### Reglas duras
- **Test-First:** ningún código de implementación antes de un test que falla y esté aprobado.
- **Trazabilidad:** toda tarea y todo test apunta a un requisito de la spec.
- **Spec viva:** si el código o el alcance cambia, actualiza la spec primero.
- **Una cosa por archivo:** interfaces, DTOs y types en su propio archivo, nunca dentro de servicios/componentes.

Plantillas en `specs/_template/`. Para una feature nueva: copia `_template/` a `specs/NNN-nombre/`.
La carpeta oficial siempre es `specs/` en plural. Si está disponible, usa `chalc spec` solo para preparar la carpeta y archivos vacíos; no redacta la spec.
