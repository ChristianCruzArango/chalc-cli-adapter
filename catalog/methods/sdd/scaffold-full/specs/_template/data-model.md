# Modelo de datos: <feature>

> Solo modo **grande**. Detalla entidades, campos, tipos y relaciones. Deriva de la spec y el plan.
> Cada interface/DTO/type va luego en **su propio archivo** (una cosa por archivo).

## Entidades

### <Entidad>
| Campo | Tipo | Requerido | Notas |
|---|---|---|---|
| id | string (uuid) | sí | PK |
| ... | ... | ... | ... |

## Relaciones
- <Entidad A> 1—N <Entidad B> — <regla>

## Reglas de validación
- <campo> — <regla>  (cubre R?)

## Estados / Transiciones (si aplica)
- <estado A> → <estado B> cuando <evento>
