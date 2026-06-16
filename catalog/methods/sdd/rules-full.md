## ⚙️ Método: Spec-Driven Development (SDD) — modo grande

Este proyecto trabaja **por especificación**. La spec es la **fuente de verdad**, no el código.
El orden es **innegociable**: **especificación → pruebas → código**. Nunca escribas código antes
de tener tests que **fallen** (Red).

### Flujo obligatorio (en orden)
1. **Constitución** — lee `specs/constitution.md` antes de nada (principios no negociables, incluye Test-First).
2. **Specify** → `specs/NNN-feature/spec.md` — el **QUÉ**: historias de usuario + criterios en **EARS** (`WHEN … THE SYSTEM SHALL …`).
3. **Research** → `research.md` — opciones técnicas evaluadas y decisión.
4. **Plan** → `plan.md` — el **CÓMO**: arquitectura y decisiones. Pide aprobación.
   - **Modelo de datos** → `data-model.md` (entidades, campos, relaciones, validaciones).
   - **Contratos** → `contracts/<recurso>.<acción>.contract.md` (uno por archivo).
   - **Validación** → `quickstart.md` (escenarios end-to-end).
5. **Tasks** → `tasks.md` — tareas atómicas ordenadas, trazadas a requisitos (`R1`…), `[P]` = paralelas.
6. **Implement (TDD estricto)** — por tarea: test desde el contrato/criterio → confírmalo en **FALLO** (Red) → mínimo código (Green) → refactor → **mutation testing** con la skill `mutation-testing` (mata los mutantes, score ≥ 80%).

### Reglas duras
- **Test-First:** ningún código antes de un test que falla y esté aprobado.
- **Trazabilidad:** cada requisito, contrato, test y tarea referencia su `R#`.
- **Spec viva:** si el alcance cambia, se actualiza la spec (y data-model/contracts) primero.
- **Una cosa por archivo:** interfaces, DTOs, types y cada contrato en su propio archivo.

Para una feature nueva: copia `specs/_template/` a `specs/NNN-nombre/`.
La carpeta oficial siempre es `specs/` en plural. Si está disponible, usa `chalc spec` solo para preparar la carpeta y archivos vacíos; no redacta la spec.
