# specs/ — Spec-Driven Development (SDD)

La carpeta oficial se llama **`specs/`** en plural. No uses `spec/`, `spect/` ni `specifications/`.
Cada nueva feature vive en `specs/NNN-nombre/`.

La **especificación es la fuente de verdad**, no el código. Nada se implementa sin una spec aprobada,
y **ningún código se escribe antes que sus tests** (Test-First).

> Basado en GitHub Spec Kit (Constitution → Specify → Plan → Tasks → Implement, con TDD estricto)
> y AWS Kiro (requisitos en notación EARS, trazables a tests y tareas).

## Las 5 fases (en orden)

| Fase | Archivo | Qué produce |
|---|---|---|
| 1. Constitución | `constitution.md` | Principios no negociables (incl. Test-First). Se lee primero, no se improvisa. |
| 2. Specify | `NNN-feature/spec.md` | El **qué**: historias de usuario + criterios de aceptación en **EARS**. |
| 3. Plan | `NNN-feature/plan.md` | El **cómo**: arquitectura, modelo de datos, contratos, decisiones. |
| 4. Tasks | `NNN-feature/tasks.md` | Tareas atómicas ordenadas, trazadas a requisitos (`R1`…), `[P]` = paralelas. |
| 5. Implement | (código + tests) | **TDD estricto**: test que falla (Red) → código mínimo (Green) → refactor. |

## Cómo arrancar una feature

Recomendado para preparar la carpeta y los archivos vacíos:

```bash
chalc spec
```

`chalc spec` no redacta contenido: solo copia la plantilla. La especificación real se escribe en `spec.md`.

Manual:

```bash
cp -R specs/_template specs/001-login    # numera y nombra la feature
```

Luego llena `spec.md` → `plan.md` (aprobar) → `tasks.md` → implementa con TDD.

## El orden innegociable

```
especificación  ──►  pruebas  ──►  código
   (spec.md)         (tests)      (implementación)
```

Si el alcance cambia: **se edita la spec primero**, luego los tests, luego el código.

## Convenciones

- Una cosa por archivo (interfaces / DTOs / types en su propio archivo).
- Toda tarea y todo test referencia el requisito que cumple (`R1`, `R2`…).
