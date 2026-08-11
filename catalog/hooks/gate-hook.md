# Hooks del portón (opcionales)

Dos hooks, y el segundo importa más de lo que parece:

1. **Anotar lo que escribes** — para que el portón revise **tu tarea** y no el árbol entero.
2. **Avisar al terminar un turno** — correr el portón en cuanto acaba un turno, sin que te acuerdes tú.

**chalc no los instala.** Un hook se ejecuta solo, y `.claude/settings.json` va commiteado: activarlo
desde aquí se lo impondría a todo el que clone este repo, que no pidió nada. Así que los bloques
quedan aquí y los pegas tú.

## Dónde se pegan

En uno de los dos archivos:

- `.claude/settings.local.json` — solo para ti, no se commitea. **Empieza por aquí.**
- `.claude/settings.json` — para todo el equipo. Acuérdalo con ellos antes: les va a ejecutar un
  comando en cada turno.

Si ya tienes hooks ahí, añade las entradas dentro de los arrays que ya existan en vez de reemplazar
el bloque entero.

## 1. Anotar lo que escribes (recomendado)

El portón revisa **los archivos que la tarea modificó**, no el proyecto. Para saber cuáles son, lo
más fiable es que quien escribe lo apunte: este hook anota cada archivo que Claude Code escribe en
`.chalc/task.files`, y el portón lo vacía solo al cerrar cada tarea.

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit|NotebookEdit",
        "hooks": [
          { "type": "command", "command": "node .chalc/gate/record.mjs" }
        ]
      }
    ]
  }
}
```

**Sin este hook el portón sigue funcionando**, pero cae al respaldo: mide el diff desde la última
tarea cerrada. Ese respaldo revisa de más, y en un flujo donde se commitea al final de la feature
—no tarea a tarea— revisa bastante de más: la línea base es un commit, así que sin commits en medio
el diff no distingue una tarea de la anterior.

El anotador es de una sola cosa: recibe la ruta y la apunta. No decide nada, no lee tu código, no
escribe fuera de `.chalc/`, y si falla sale con 0 — un hook que rompe el turno es peor que no tener
hook.

## 2. Aviso automático al terminar un turno

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

## Por qué `--fast`

`--fast` corre las etapas rápidas —tests, una cosa por archivo, fronteras, trazabilidad y contrato— y
**omite la mutación**, que tarda minutos. Un hook que la lanzara en cada turno haría la sesión
inusable, y acabarías quitando el hook o, peor, cerrando tareas sin él.

Por eso una corrida con `--fast` **no cierra una tarea**: sirve para enterarte pronto de que algo se
rompió, no para dar por buena la tarea. El cierre es el portón completo:

```
node .chalc/gate.mjs
```

## Si no los activas

El del aviso no hace falta: el cierre de tarea del hand-off ya te pide el portón, y el agente revisor
se niega a revisar si `.chalc/gate.md` falta o quedó más viejo que el último cambio. Ese hook solo
adelanta el aviso.

El de anotar tampoco es obligatorio, pero es el que cambia lo que ves en el informe: con él, el
alcance son exactamente tus archivos; sin él, todo lo que haya cambiado desde la última tarea
cerrada. La evidencia dice siempre de cuál de los dos salió, en la sección «Alcance de la tarea», así
que no hay forma de confundirse.
