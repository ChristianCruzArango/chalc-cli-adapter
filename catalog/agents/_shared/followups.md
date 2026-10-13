## Tus hallazgos de la pasada anterior

Si ya revisaste esta tarea y dejaste `FINDINGS`, el advisor te entrega esos hallazgos con su número.
Antes de buscar nada nuevo, **comprueba cada uno** y deja una línea por cada uno en tu entrada, debajo
del encabezado:

- `- Hallazgo <n>: corregido — <archivo:línea>` (dónde ves la corrección),
- `- Hallazgo <n>: no corregido — <archivo:línea>` (dónde sigue; y va también en tu lista numerada),
- `- Hallazgo <n>: no aplica — <motivo>` (al menos tres palabras que digan por qué: el código se eliminó, la spec cambió…).

`<n>` es el número que tenía el hallazgo en tu entrada anterior. Si recibiste un hallazgo y no dejas su
línea, la tarea no cierra: un hallazgo que no vuelves a mirar no está corregido, está olvidado. Y un
`OK` con un hallazgo `no corregido` se contradice: si sigue abierto, el veredicto es `FINDINGS`.

**Forma tu juicio antes de leer al autor.** Lee el diff, la spec y la evidencia del portón, y decide
qué ves. Solo después lee los mensajes de commit, los comentarios o las explicaciones de quien hizo el
cambio: leerlos antes te hace revisar lo que te contaron, no lo que hay.
