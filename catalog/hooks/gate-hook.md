# Hooks del portón (opcionales)

Cuatro hooks, y el segundo importa más de lo que parece:

1. **Anotar lo que escribes** — para que el portón revise **tu tarea** y no el árbol entero.
2. **Avisar al terminar un turno** — correr el portón en cuanto acaba un turno, sin que te acuerdes tú.
3. **Guardas** — que el asistente pregunte antes de commitear o hacer push, y no pueda leer
   credenciales ni borrar fuera del proyecto.
4. **Actividad** — que el tablero en vivo (`node .chalc/live.mjs`) muestre qué hace cada agente.

**chalc no los instala.** Un hook se ejecuta solo, y `.claude/settings.json` va commiteado: activarlo
desde aquí se lo impondría a todo el que clone este repo, que no pidió nada. Así que los bloques
quedan aquí y los pegas tú. La única excepción es la guarda, y solo si la pides (`chalc --guard`,
sección 3): va a tu archivo local, nunca al compartido.

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

El registro **informa, no estrecha**: con git, el portón revisa siempre el diff completo desde la
última tarea cerrada, y el registro solo señala qué cambios no se anotaron. Este hook escucha
`Write|Edit|MultiEdit|NotebookEdit`; lo escrito por Bash (`sed -i`, `cat >`, generadores) no se anota,
pero entra igual en la revisión por el diff.

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

## Cuando cambia un comando del portón

El portón ejecuta `test.command`, `build.command` y `mutation.command` de `.chalc/gate.json` con el shell, y
este hook lo corre en cada turno. Si alguno cambió desde la última tarea cerrada —un PR, una rama ajena—, el
portón **se bloquea sin ejecutar nada** hasta que lo revises y lo aceptes:

```
node .chalc/gate.mjs --seal
```

`--seal` solo re-sella la configuración vigilada en `.chalc/task.json`; no corre el portón ni mueve la tarea.

## 3. Guardas: lo que el asistente no hace sin ti

Las reglas «no commitees sin mi orden» o «no leas el `.env`» viven como texto en `CLAUDE.md`, y un
asistente que las olvida no encuentra nada que se lo impida. Este hook las convierte en una barrera:
antes de cada acción, la guarda la mira y decide.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|Read|Grep|Glob|NotebookRead",
        "hooks": [
          { "type": "command", "command": "node .chalc/gate/guard.mjs" }
        ]
      }
    ]
  }
}
```

| Acción | Qué pasa |
| --- | --- |
| `git commit`, `git push` | **Te pregunta.** La orden es tuya, en el momento exacto. |
| `git push --force`, `-f`, `--force-with-lease`, `+rama` | **Se bloquea.** Reescribe historia que otros ya tienen. |
| Lo mismo dentro de una shell: `bash -c "git push"`, `sh -c`, `zsh -c`, `dash -c` (hasta tres niveles) | **Igual que escrito directo.** La guarda lee el comando de la cadena. |
| Leer `.env`, `.envrc`, llaves SSH, `.npmrc`, `.pypirc`, `.netrc`, `*.pem`, `*.tfvars`, `kubeconfig`, `.docker/config.json`… cuando se NOMBRAN: `Read`, la ruta o el `glob` de `Grep`/`Glob`, o una palabra de un comando de shell | **Se bloquea.** Su contenido entraría al contexto del modelo. Las plantillas sin valores (`.env.example`, `.env.sample`, `.env.template`) sí se leen. |
| `Grep` con `output_mode: content` sobre una carpeta (sin ruta, `.`, `src/`…) sin acotar con `glob` o `type` | **Te pregunta.** Podría volcar líneas de un `.env` que no nombra. |
| `rm`, `rmdir` o `find … -delete` fuera del proyecto, sobre el proyecto entero, o con un destino que no se puede saber (`$VAR`, `$(…)`, `~`, `{a,b}`) | **Se bloquea.** Dentro del proyecto se borra con normalidad. |

El motivo de cada pregunta o bloqueo sale en el idioma del repo (`.chalc/gate.json`) y dice qué
comando o archivo lo provocó. Si una acción bloqueada es la que querías, hazla tú.

Cuando la acción pasa, la guarda **no responde nada**: responder `allow` aprobaría la acción
saltándose los permisos que ya tienes configurados. Y si el evento no se entiende o algo falla, sale
sin decir nada: un hook que rompe el turno es peor que no tener hook.

**Límite, dicho claro:** sube el listón, no es inviolable. Lee los comandos sin ejecutarlos —no
expande variables ni alias, ni resuelve enlaces simbólicos— y un comando ofuscado a propósito puede
esquivarla. Es una red para los olvidos del asistente, no una frontera de seguridad.

Lo que **no** cubre: un comando que lee un secreto sin nombrarlo (`grep -r PASSWORD .`, `cat $(ls -a)`),
un `Grep` que solo lista archivos o cuenta coincidencias, y cualquier archivo de credenciales con un nombre
fuera de la lista de arriba. Tampoco lo que llega a git por otro camino: `eval "git push"`,
`xargs git push` o un script en archivo (`bash deploy.sh`). Y la regla de borrados no mira dentro de
`bash -c`.

### Activarla con `--guard`

En vez de pegar el bloque, `chalc --guard` lo deja en `.claude/settings.local.json` —solo tuyo, nunca
`.claude/settings.json`—. `chalc init` te lo pregunta (con **sí** por defecto); sin terminal, solo con
`--guard`. Junto al hook escribe dos permisos `ask`:

```json
{
  "permissions": {
    "ask": ["Bash(git commit *)", "Bash(git push *)"]
  }
}
```

Son dos capas fuera del modelo: Claude Code aplica los permisos `ask` aunque un hook diga `allow`, también
dentro de una cadena (`npm test && git push`); el hook ve lo que un permiso por prefijo no ve
(`git -C . push`, `/usr/bin/git push`, `bash -c "git push"`). Cuando le ordenas commitear o subir, aceptas
el aviso y se hace; si no se lo ordenaste, lo rechazas.

- Lo que ya tengas en el archivo se conserva; repetirlo no duplica nada. Si no es un JSON válido, chalc
  no lo toca y te avisa.
- Añade `.claude/settings.local.json` al `.gitignore`.
- `chalc --no-guard` quita solo lo que chalc añadió; si no queda nada más, el archivo desaparece.
- `--dry-run` lo lista sin escribir. Solo Claude Code: con otro asistente avisa y no escribe nada.

## 4. Actividad para el tablero en vivo

`node .chalc/live.mjs` levanta una página local con el estado del proyecto. Con este hook, además, muestra
en vivo qué hace cada uno: el agente principal y cada rol (`seguridad`, `revisor`, `endurecedor`) —qué
herramienta usa, sobre qué archivo o con qué comando, y cuándo entra y sale cada rol—.

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "*", "hooks": [{ "type": "command", "command": "node .chalc/live/record.mjs" }] }
    ],
    "SubagentStart": [{ "hooks": [{ "type": "command", "command": "node .chalc/live/record.mjs" }] }],
    "SubagentStop": [{ "hooks": [{ "type": "command", "command": "node .chalc/live/record.mjs" }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "node .chalc/live/record.mjs" }] }]
  }
}
```

Lo que se registra en `.chalc/activity.jsonl` es **quién, qué y dónde**, nunca el contenido: ni lo que se
escribe en un archivo, ni lo que responde una herramienta, ni el prompt de un rol. Lo que pudiera ser un
secreto se redacta, y el archivo guarda solo las últimas 500 acciones. Si algo falla, el hook sale sin decir
nada. Si ya tienes un `PreToolUse` (la guarda), añade esta entrada al mismo array.

Con el mismo hook el tablero cuenta los **tokens y el tiempo de cada tarea**: en cada evento lee solo lo
nuevo del transcript de la sesión (y, al salir un rol, el suyo), cuenta cada mensaje una vez y lo carga a la
tarea en curso, en `.chalc/usage.json`. Solo cifras, nunca texto del transcript.

## Si no los activas

El del aviso no hace falta: el cierre de tarea del hand-off ya te pide el portón, y el agente revisor
se niega a revisar si `.chalc/gate.md` falta o quedó más viejo que el último cambio. Ese hook solo
adelanta el aviso.

Sin las guardas, las reglas de `CLAUDE.md` siguen siendo instrucciones: el asistente las lee, pero
nada le impide saltárselas. Activarlas no cambia nada de lo demás.

El de anotar tampoco es obligatorio, pero es el que cambia lo que ves en el informe: con él, el
alcance son exactamente tus archivos; sin él, todo lo que haya cambiado desde la última tarea
cerrada. La evidencia dice siempre de cuál de los dos salió, en la sección «Alcance de la tarea», así
que no hay forma de confundirse.
