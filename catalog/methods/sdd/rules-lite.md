## ⚙️ Método: Spec-Driven Development (SDD)

Este proyecto trabaja **por especificación**. La spec es la **fuente de verdad**, no el código.
El orden es **innegociable**: **especificación → pruebas → código**. Nunca escribas código antes
de tener tests que **fallen** (Red).

### Flujo obligatorio (5 fases, en orden)
1. **Constitución** — lee `specs/constitution.md` antes de nada. Son principios no negociables (incluye Test-First).
2. **Specify** → `specs/NNN-feature/spec.md` — el **QUÉ** y el **PORQUÉ**. Historias de usuario + criterios de aceptación en **notación EARS** (`WHEN … THE SYSTEM SHALL …`). Sin detalles de implementación. Antes que nada, `hu.md`: la HU **tal cual** la entregó el usuario, con su línea `Fuente:` (desde una URL o un archivo se trae con `chalc spec --azure <url>`, también `--jira`, `--url` o `--doc`; nunca pidas pegar un token en el chat). Cada requisito cita el fragmento del que sale (`HU-n`).
3. **Plan** → `plan.md` — el **CÓMO**: arquitectura, modelo de datos, contratos/interfaces, decisiones. Declara `Toca:` (las rutas o globs que la spec puede modificar; lo que quede fuera impide la entrega) y, si aplica, `Depende de:` (las specs que deben integrarse antes). Declara también `Superficie:` (`ui`, `api`, `cli` o `ninguna`): con `ui`, la carpeta lleva además `design.md` —la composición de cada pantalla, que escribe el rol `disenador` y se aprueba con la spec—. Con `api` o `cli`, la carpeta lleva `probes.json`: las sondas (peticiones o comandos, con lo que se espera) que el servicio levantado tiene que cumplir antes de entregar.
4. **Tasks** → `tasks.md` — tareas atómicas y ordenadas, cada una **trazada a un requisito** (`R1`, `R2`…). `[P]` marca las paralelizables.
5. **Implement (TDD estricto)** — por cada tarea:
   1. Escribe los **tests** desde los criterios de aceptación.
   2. Confírmalos en **FALLO** (Red).
   3. Escribe el **mínimo código** para pasarlos (Green).
   4. Refactoriza sin romper tests.
   5. **Cierre de tarea — lo decide el advisor, no tu memoria:** corre `node .chalc/next.mjs`, haz lo que diga `NEXT_ACTION` y ejecuta su `COMMAND` si no está vacío; vuelve a preguntarle y repite hasta que responda `done`. Lee el estado real del repo (fecha de la evidencia, veredicto del portón, bitácora del revisor, `tasks.md`), así que no te saltes una acción ni decidas tú el orden. `ask_human`, `approve_spec` y `approve_feature` son lo único que corta el bucle: para y repórtalo. Quien mide es el portón (`node .chalc/gate.mjs`): exige un score de mutación ≥ 80% y lista los supervivientes, así que cuando el advisor mande `fix_gate`, lo que falta son tests que maten mutantes — no reintentos.

### Reglas duras
- **Puerta de la spec — ni tests ni código antes:** corre `node .chalc/next.mjs` al terminar de redactar. Mientras responda `fix_specs`, corrige lo que lista (redacta el rol `especificador`); con `call_role analista`, la revisa ESE rol contra la HU, no quien la escribió; con `approve_spec`, **PARA**: solo el usuario aprueba la spec, en SU terminal, con `node .chalc/gate.mjs --approve-spec`. No ejecutes tú ese comando, no escribas el sello a mano y no des la spec por aprobada. Editar la HU, la spec, el plan o las tareas después invalida la aprobación.
- **Cierre — solo el usuario:** cuando el advisor responda `approve_feature`, todo está hecho, medido y revisado. **PARA**: entrega el resumen de lo hecho y espera. El cierre lo aprueba solo el usuario, en SU terminal, con `node .chalc/gate.mjs --approve-feature`; no ejecutes tú ese comando.
- **Rojo sellado — los tests van antes, con evidencia:** en cada tarea escribe SOLO sus tests, compruébalos en fallo y regístralos con `node .chalc/gate.mjs --red` (el advisor te lo pide con `red_task`). Sin ese registro el portón rechaza el código de producción. Los tests sellados no se aflojan: para cambiar uno, hazlo fallar otra vez y vuelve a registrarlo. Cita en los tests cada requisito de la tarea. Si una tarea de verdad no lleva tests: `--red --skip "<motivo>"`.
- **Test-First:** ningún código de implementación antes de un test que falla y esté aprobado.
- **Trazabilidad:** toda tarea y todo test apunta a un requisito de la spec.
- **Spec viva:** si el código o el alcance cambia, actualiza la spec primero.
- **Una cosa por archivo:** interfaces, DTOs y types en su propio archivo, nunca dentro de servicios/componentes.
- **Código seguro:** ANTES de escribir código que toque entrada externa, autenticación, sesiones, permisos, secretos, almacenamiento, red, criptografía o logs, abre la skill `secure-coding` (la sección de tu stack, que te remite a la referencia concreta) y aplícala. Es la excepción a «skills bajo demanda». El portón bloquea las señales de seguridad que se ven en una línea y el rol `seguridad` revisa OWASP en cada tarea; si deja hallazgos, corrige empezando por un test que demuestre la vulnerabilidad.

### Cómo trabajar (mantén el foco)
- **Tablero en vivo (`chalc-live`).** Si el usuario usa el comando `chalc-live` (`/chalc-live`; en Codex, `$chalc-live`), o pregunta en qué paso vas, cómo va el trabajo o pide el tablero, corre `node .chalc/live.mjs` y responde con la URL que imprime: es una página local que muestra la tarea en curso, lo que corrió el portón, cada rol y lo que falta, y se actualiza sola mientras trabajas. No describas el estado tú: entrega la URL.
- **Memoria del proyecto:** al escribir una spec, llena `Conceptos:` con los de `node .chalc/memory.mjs concepts` (uno nuevo solo si ninguno encaja): con ellos el advisor te entrega en cada tarea las reglas que el proyecto ya aprendió. Para algo puntual, busca con `node .chalc/memory.mjs search <palabras>` antes de explorar el repo.
- **Una tarea a la vez:** antes de cada tarea di qué `R#` implementa; al terminarla, sigue con lo que diga el advisor. No hay aprobación por tarea: entre la spec y el cierre trabajas solo.
- **Skills bajo demanda:** abre solo la skill que la tarea activa necesita (`.claude/skills` o `.chalc/skills`); no las pre-cargues todas.
- **Lectura acotada:** lee la constitución, esta spec/plan/tasks y los archivos que toca la tarea; no explores todo el repo.
- **Herramientas del proyecto:** usa el framework de pruebas y la config que el proyecto **ya** tiene; no inventes config. Si falta tooling, el registro es privado o algo no compila, repórtalo como blocker y pregunta — no improvises ni cambies de herramienta por tu cuenta.

Plantillas en `specs/_template/`. Para una feature nueva: copia `_template/` a `specs/NNN-nombre/`.
La carpeta oficial siempre es `specs/` en plural. `chalc spec` crea la siguiente carpeta desde las plantillas y, con una fuente, copia la HU en `hu.md`; no redacta la spec.
