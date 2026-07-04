// cli/ui/render.mjs — presentación de la CLI en terminal. Sin dependencias: ANSI nativo. Respeta NO_COLOR y
// salida no-TTY (pipe) → texto plano. Funciones puras que devuelven strings, así se testean sin pintar nada.

const COLOR = !!process.stdout.isTTY && !process.env.NO_COLOR;
const sgr = (code) => (s) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : String(s));

export const c = {
  bold: sgr(1), dim: sgr(2), red: sgr(31), green: sgr(32),
  yellow: sgr(33), blue: sgr(34), cyan: sgr(36), gray: sgr(90)
};

export function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return String(s).replace(/\x1b\[[0-9;]*m/g, '');
}
const vlen = (s) => stripAnsi(s).length;              // ancho VISIBLE (ignora los códigos de color)
const pad = (s, w) => s + ' '.repeat(Math.max(0, w - vlen(s)));
const k = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n));

function truncate(value, n = 160) {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// Caja con borde redondeado. El contenido puede venir coloreado: el padding usa el ancho visible.
export function box(lines, { color = c.gray } = {}) {
  const inner = Math.max(20, ...lines.map(vlen));
  const bar = (l, r) => color(l + '─'.repeat(inner + 2) + r);
  return [
    bar('╭', '╮'),
    ...lines.map((l) => color('│') + ' ' + pad(l, inner) + ' ' + color('│')),
    bar('╰', '╯')
  ].join('\n');
}

// Nombre bonito del stack para el encabezado: marca oficial cuando se conoce, capitalizado si no.
const STACK_LABELS = { angular: 'Angular', react: 'React', vue: 'Vue', svelte: 'Svelte', flutter: 'Flutter', dotnet: '.NET', node: 'Node.js', spring: 'Spring', django: 'Django', laravel: 'Laravel' };
export const stackLabel = (s) => STACK_LABELS[String(s).toLowerCase()] || (String(s).charAt(0).toUpperCase() + String(s).slice(1));

// Encabezado de sesión: modelo/proveedor/ruta + una línea compacta con lo detectado (skills como CONTEO,
// no el volcado). El detalle va a los slash commands (/skills, /mcp).
export function banner({ model, provider, projectPath, project }) {
  const out = [`${c.cyan(c.bold('chalc-cli'))}  ${c.dim(`${model} · ${provider}`)}`, c.dim(projectPath)];
  const parts = [];
  if (project.equipped) {
    if (project.stacks?.length) parts.push(project.stacks.map(stackLabel).join(', '));
    const nsk = project.detected.skills.length;
    if (nsk) parts.push(`${nsk} skills`);
    if (project.detected.mcpServers.length) parts.push(`MCP: ${project.detected.mcpServers.join(', ')}`);
  }
  if (project.git?.isRepo) parts.push(`git ${project.git.branch}${project.git.clean ? '' : '*'}`);
  if (parts.length) out.push(c.gray(parts.join(' · ')));
  return out.join('\n');
}

// Título ASCII-art. Cada glifo es 5 filas de ancho fijo → se ensamblan sin desalinear.
const GLYPHS = {
  C: [' █████ ', '██     ', '██     ', '██     ', ' █████ '],
  H: ['██   ██', '██   ██', '███████', '██   ██', '██   ██'],
  A: [' █████ ', '██   ██', '███████', '██   ██', '██   ██'],
  L: ['██     ', '██     ', '██     ', '██     ', '███████']
};
export function bigTitle(word = 'CHALC', { color = c.cyan } = {}) {
  const chars = word.toUpperCase().split('');
  return [0, 1, 2, 3, 4]
    .map((r) => color(chars.map((ch) => (GLYPHS[ch] ? GLYPHS[ch][r] : ch)).join(' ')))
    .join('\n');
}

// La "ventana de contexto": uso de la ventana del modelo (tokens de entrada / num_ctx) + pasos + CCR del último turno.
export function contextBox({ model, provider, inputTokens = 0, outputTokens = 0, numCtx, steps = 0, ccr }) {
  const win = numCtx ? `${k(inputTokens)}/${k(numCtx)}` : k(inputTokens);
  const meta = [
    `${c.dim('contexto')} ${win} ${c.dim('tokens')}`,
    `${c.dim('salida')} ${k(outputTokens)}`,
    `${c.dim('pasos')} ${steps}`,
    ...(ccr?.entries ? [`${c.dim('CCR')} ${ccr.entries}`] : [])
  ].join(c.dim('  ·  '));
  return box([`${c.bold(model)} ${c.dim('· ' + provider)}`, meta], { color: c.cyan });
}

// Si un texto es un placeholder CCR ([CCR ref=… preview="…"]), extrae el preview legible; si no, tal cual.
function ccrPreview(s) {
  const m = String(s).match(/^\[CCR ref=\S+ [^\]]*preview=("(?:[^"\\]|\\.)*")\]$/);
  if (!m) return String(s);
  try { return JSON.parse(m[1]) + ' …'; } catch { return String(s); }
}

// Resume una observación en UNA línea humana según la tool — nunca JSON crudo con escapes (ilegible).
export function summarizeObservation(action, obs = {}) {
  // AUTO-CORRECCIONES del loop: los textos largos ("unknown tool… use the FULL exact name…") son
  // instrucciones PARA EL MODELO (en inglés); al usuario se le muestra solo una línea tenue en su idioma.
  if (obs.error && /unknown tool/.test(obs.error)) {
    return { correction: true, text: `la IA pidió una herramienta que no existe aquí (${action?.tool}) — se corrige sola` };
  }
  if (obs.error && obs.hint) {
    return { correction: true, text: `argumentos incorrectos en ${action?.tool} — la IA consulta el formato y reintenta` };
  }
  if (obs.repeated) return { correction: true, text: 'acción repetida — se reutilizó el resultado del paso anterior' };
  // Si el error trae el comando/ruta que lo causó, mostrarlo: "metacaracteres no permitidos" sin ver QUÉ
  // comando se rechazó no le dice nada a quien mira el tablero.
  if (obs.error) {
    const cause = obs.command || obs.path;
    return { error: true, text: cause ? `${truncate(String(cause), 60)} → ${obs.error}` : obs.error };
  }
  const tool = action?.tool || '';
  if (tool === 'write') return { text: `${obs.path} ${obs.appended ? 'ampliado' : 'escrito'} (${obs.bytes ?? '?'} bytes)` };
  if (tool === 'edit') return { text: `${obs.path} editado` };
  if (tool === 'read') return { text: `${obs.path} leído (${String(obs.content ?? '').split('\n').length} líneas)` };
  if (tool === 'list') return { text: `${obs.entries?.length ?? 0} entradas en ${obs.path}` };
  if (tool === 'grep') return { text: `${obs.matches?.length ?? 0} coincidencia(s)` };
  if (tool === 'bash') {
    if (obs.timedOut) return { error: true, text: `timeout — el comando no terminó (¿pedía input interactivo?)` };
    const first = String(obs.stdout || obs.stderr || '').split('\n').find((l) => l.trim()) || '';
    return { text: `exit ${obs.code}${first ? ` · ${truncate(first, 80)}` : ''}` };
  }
  if (tool === 'recall' || typeof obs.content === 'string') return { text: truncate(ccrPreview(obs.content ?? ''), 120) };
  if (typeof obs.text === 'string') return { text: truncate(ccrPreview(obs.text), 120) };   // MCP y afines
  if (obs.schema) return { text: `esquema de ${obs.tool}` };
  if (obs.ok) return { text: 'ok' };
  return { text: truncate(obs, 100) };
}

// Una línea por paso del agente: herramienta + resumen humano (error en rojo, resto atenuado).
// Las auto-correcciones van SIN nombre de tool y en gris tenue: son ruido interno del agente, no acciones.
export function stepLine(r) {
  const s = summarizeObservation(r.action, r.observation);
  if (s.correction) return `  ${c.dim('⟳ ' + s.text)}`;
  return `  ${c.dim('→')} ${c.blue(r.action.tool)}  ${s.error ? c.red(s.text) : c.dim(s.text)}`;
}

// Tools MCP con nombre de lectura (list_*, get_*…): no cuentan como mutación.
export const MCP_READONLY = /^(get|list|read|search|find|show|describe|status|inspect|doc)[_-]?/i;

// Reporte DETERMINISTA de lo que el turno modificó de verdad, a partir de las observaciones (no del summary
// del modelo, que puede alucinar éxito). files: escritos/editados con éxito; commands: bash con exit 0;
// mcpMutations: llamadas MCP no-lectura sin error.
export function mutationReport(steps = []) {
  const files = [];
  let commands = 0;
  let mcpMutations = 0;
  for (const r of steps || []) {
    const tool = r.action?.tool || '';
    const obs = r.observation || {};
    if (obs.error || obs.repeated) continue;
    if ((tool === 'write' || tool === 'edit') && obs.ok && obs.path) files.push(obs.path);
    else if (tool === 'bash' && obs.code === 0) commands++;
    else if (tool.startsWith('mcp__') && !MCP_READONLY.test(tool.split('__').pop() || '')) mcpMutations++;
  }
  return { files, commands, mcpMutations, mutated: files.length > 0 || commands > 0 || mcpMutations > 0 };
}

export function resultLine(result) {
  return result.done ? c.green(`✔ ${result.summary || ''}`) : c.red(`✗ ${result.error || ''}`);
}

// Texto de la pregunta de aprobación (en amarillo para que resalte).
export function approveText(label) {
  return c.yellow(`  ¿Aprobar ${label}? [y/N] `);
}
