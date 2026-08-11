// lib/gatedetect.mjs — detección de la configuración del portón de calidad (spec 007, R2).
// Responsabilidad ÚNICA: componer la config del portón para un repo. Razón de cambio: la FORMA de
// esa config. No ejecuta nada, no escribe nada.
//
// Lo que chalc sabe de cada stack —comandos, herramientas, rutas de reporte— ya NO vive aquí: vive
// en `catalog/tools/*.json` (spec 011). Este módulo lo consulta y le añade lo que no es conocimiento
// de stack: los umbrales del linter, el umbral de mutación, las puertas del advisor y la carpeta de
// specs. Si vuelve a aparecer aquí un comando o una ruta de herramienta, la spec 011 se deshizo.
//
// Regla dura (R2 de la spec 007): lo que no se puede determinar CON CERTEZA queda vacío y marcado en
// `pending`. Un comando inventado es peor que un campo vacío: el vacío se ve y se corrige; el
// inventado falla en silencio o, peor, "aprueba".

import { detectContext } from './detect.mjs';
import { loadToolTable, resolveStack, resolveTools } from './tooltable.mjs';
import { loadRoles } from './roles.mjs';

// Umbrales por defecto del linter del portón. Se copian a .chalc/gate.json para que el usuario los
// ajuste sin tocar código (única superficie de configuración).
const LINT_DEFAULTS = {
  maxFileLines: 300, maxFunctionLines: 40, maxParams: 4, maxDepth: 3,
  duplication: { enabled: true, minLines: 6, maxFiles: 4000 }
};
const DEFAULT_THRESHOLD = 80;

// La FORMA del bloque de mutación cuando el stack no tiene herramienta que el portón sepa verificar.
// No es conocimiento de stack —no nombra ninguna herramienta—: es el esqueleto de campos que
// `.chalc/gate.json` lleva siempre, para que el usuario vea qué puede rellenar a mano.
const MUTATION_NONE = { tool: '', command: '', report: '', format: '', install: '', probe: '', scopeFlag: '' };

// Claves sin resolver de una config, sea recién detectada o fusionada con las ediciones del usuario.
// Es DERIVADO: se recalcula siempre, nunca se conserva. Si el usuario llenó a mano lo que la
// detección no supo, el campo deja de estar pendiente y el portón deja de bloquear por R4.
export function pendingKeys(config = {}) {
  const pending = [];
  if (!config.test?.command) pending.push('test.command');
  if (!config.mutation?.command) pending.push('mutation.command');
  return pending;
}

// Detecta la config del portón para `projectPath`. `role` (back/front/movil) e `language` los aporta
// el llamador: no son señales del repo. Devuelve la config completa más `pending`, la lista de claves
// que quedaron vacías por falta de certeza — el portón las trata como bloqueo, no como "todo bien".
export async function detectGateConfig(projectPath, { role = '', language = '' } = {}) {
  const ctx = await detectContext(projectPath);
  const stack = resolveStack(await loadToolTable(), ctx);
  const tools = stack ? await resolveTools(stack, projectPath, ctx) : { test: '', mutation: null };

  const config = {
    stack: stack?.id || '',
    test: { command: tools.test },
    // `required: true` viaja siempre para que el knob sea visible. Ponerlo en false solo surte efecto
    // donde el portón no tiene parser para el stack (R21): en un repo medible se ignora.
    // Sin herramienta va el esqueleto vacío; con herramienta va TAL CUAL la declara la tabla. No se
    // rellenan los campos que un stack no usa: `probe` solo tiene sentido donde hay algo que probar,
    // y un `.chalc/gate.json` lleno de claves vacías invita a rellenarlas sin saber para qué son.
    mutation: { ...(tools.mutation || MUTATION_NONE), threshold: DEFAULT_THRESHOLD, required: true },
    lint: { ...LINT_DEFAULTS },
    spec: { dir: 'specs' },
    // Las puertas del advisor viajan siempre, aunque sean los defaults, para que el knob se vea al
    // abrir el archivo (spec 008, R17). No entran en `pending`: tienen defecto, no falta nada.
    // Los roles del ciclo, con la cadencia que declara cada contrato (spec 009, R15). Viajan a
    // `gate.json` para que el usuario pueda apagar uno o subirlo a cada tarea sin tocar el catálogo,
    // y para que el advisor los lea sin necesitar una copia de los contratos.
    flow: {
      approvals: { task: true, feature: true },
      review: { required: true },
      roles: (await loadRoles()).map((r) => ({ id: r.id, order: r.order, cadence: r.cadence, required: true })),
      // Apagada: mirando un repo no se puede saber que forma parte de un workspace (spec 010, R11).
      sides: { me: '', owner: '', peers: [], mail: '', enabled: false }
    },
    role,
    language
  };
  return { ...config, pending: pendingKeys(config) };
}
