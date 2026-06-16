# contracts/ — Contratos / interfaces (modo grande)

Un archivo por contrato. Cada endpoint, servicio o mensaje define aquí su **entrada/salida** antes de implementarse.
Sirven como base para los tests (Test-First): el test verifica el contrato.

## Convención de archivo
`<recurso>.<acción>.contract.md` — ej. `user.create.contract.md`

## Plantilla de un contrato
```
# Contrato: <recurso>.<acción>   (cubre R?)

Entrada:
  <campo>: <tipo>   // requerido?

Salida (éxito):
  <campo>: <tipo>

Errores:
  <código> — <cuándo>
```
