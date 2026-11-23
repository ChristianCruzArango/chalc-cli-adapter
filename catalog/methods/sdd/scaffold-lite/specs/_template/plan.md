# Plan: <feature>

> Fase **Plan** — el CÓMO. Deriva de `spec.md`. Pide aprobación antes de generar tareas.
> Todavía **no** se escribe código.

## Enfoque técnico
<estrategia general para cumplir los requisitos>

## Arquitectura / Componentes
- `ruta/al/archivo` — <responsabilidad>  _(una cosa por archivo)_

## Modelo de datos
| Entidad | Campos | Notas |
|---|---|---|
| ... | ... | ... |

## Contratos / Interfaces
- <endpoint, firma de servicio, tipo de entrada/salida>  _(cada interface/DTO en su propio archivo)_

## Decisiones
- <decisión> — <por qué> (cubre R?)

## Riesgos / Dudas
- ...

## Alcance (lo que esta spec puede tocar)
Rutas o globs que la implementación puede modificar: lo que quede fuera impide la entrega, y dos specs cuyo
alcance se solapa no se trabajan a la vez. `Depende de:` nombra las specs que deben integrarse antes.

Superficie: <ui | api | cli | ninguna>

Toca:
- <ruta/o/glob/**>

Depende de: <ninguna>

## Trazabilidad
Cada requisito de la spec queda cubierto por al menos un componente:
- R1 → ...
- R2 → ...
