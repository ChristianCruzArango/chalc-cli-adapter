# Aviso automático al terminar un turno (opcional)

Claude Code puede correr el portón en cuanto termina un turno y avisarte si algo se rompió, sin que
tengas que acordarte tú.

**chalc no lo instala.** Un hook se ejecuta solo, y `.claude/settings.json` va commiteado: activarlo
desde aquí se lo impondría a todo el que clone este repo, que no pidió nada. Así que el bloque queda
aquí y lo pegas tú si lo quieres.

## Cómo activarlo

Pega este bloque en uno de los dos archivos:

- `.claude/settings.local.json` — solo para ti, no se commitea. **Empieza por aquí.**
- `.claude/settings.json` — para todo el equipo. Acuérdalo con ellos antes: les va a ejecutar un
  comando en cada turno.

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "node .chalc/gate.mjs --fast" }
        ]
      }
    ]
  }
}
```

Si ya tienes hooks en ese archivo, añade la entrada dentro del array `Stop` que ya exista en vez de
reemplazar el bloque entero.

## Por qué `--fast`

`--fast` corre las etapas rápidas —tests, una cosa por archivo, fronteras, trazabilidad y contrato— y
**omite la mutación**, que tarda minutos. Un hook que la lanzara en cada turno haría la sesión
inusable, y acabarías quitando el hook o, peor, cerrando tareas sin él.

Por eso una corrida con `--fast` **no cierra una tarea**: sirve para enterarte pronto de que algo se
rompió, no para dar por buena la tarea. El cierre es el portón completo:

```
node .chalc/gate.mjs
```

## Si no lo activas

No pasa nada: el cierre de tarea del hand-off ya te lo pide, y el agente revisor se niega a revisar si
`.chalc/gate.md` falta o quedó más viejo que el último cambio. El hook solo adelanta el aviso.
