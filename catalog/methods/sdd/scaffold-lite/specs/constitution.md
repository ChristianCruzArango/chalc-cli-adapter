# Constitución del proyecto

Principios **no negociables**. Toda spec, plan, tarea y código debe respetarlos.
Solo se cambian con una enmienda explícita registrada aquí.

## Artículo 1 — La especificación es la fuente de verdad
El comportamiento del sistema se define en la spec, no en el código. Si hay conflicto, manda la spec.
Si el alcance cambia, se actualiza la spec **antes** que el código.

## Artículo 2 — Test-First (TDD estricto)
Ningún código de implementación se escribe antes de:
1. Escribir los tests derivados de los criterios de aceptación.
2. Que el usuario los apruebe.
3. Confirmar que **fallan** (fase Red).
Recién entonces se escribe el código mínimo para pasarlos (Green) y se refactoriza.

## Artículo 3 — Trazabilidad total
Cada requisito tiene un id (`R1`, `R2`…). Cada test y cada tarea referencia el requisito que cumple.
Nada de código "huérfano" sin requisito que lo justifique.

## Artículo 4 — Una cosa por archivo
Interfaces, DTOs, types y enums viven en su **propio archivo** y se importan.
Nunca declarados dentro de servicios, componentes o controladores.

## Artículo 5 — Simplicidad primero
Resuelve el requisito con la solución más simple que funcione. Nada de abstracciones
ni capas "por si acaso" que no pida un requisito.

## Artículo 6 — Requisitos testeables (EARS)
Los criterios de aceptación se escriben en notación EARS para que sean verificables:
`WHEN <condición> THE SYSTEM SHALL <comportamiento>`. Si no se puede convertir en test, no es un requisito.

## Artículo 7 — Calidad de los tests (mutation testing)
Los tests no solo deben **pasar**: deben **detectar fallos reales**. Después de Green/refactor se corre
**mutation testing** (Stryker en JS/TS y .NET; mutmut/cosmic-ray en Python): la herramienta introduce
mutaciones en el código y los tests DEBEN "matarlas". Si un mutante sobrevive, el test es débil → se
refuerza hasta matarlo. Objetivo: **mutation score ≥ 80%** en la lógica crítica. Ninguna feature se
cierra con mutantes vivos en esa lógica.

---
_Enmiendas:_
- (ninguna)
