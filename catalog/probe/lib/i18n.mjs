// i18n.mjs — los textos de las sondas en es y en (spec 041). Responsabilidad ÚNICA: lo que lee una persona al
// correr las sondas. Razón de cambio: la redacción. Paridad exacta de claves.
//
// Este archivo lo emite chalc dentro de `.chalc/probe/lib/`. No edites aquí: se regenera al equipar el repo.

const shown = (value) => (typeof value === 'string' ? value : JSON.stringify(value) ?? 'undefined');

export const MESSAGES = {
  es: {
    usage: 'Uso: node .chalc/probe.mjs run --spec <carpeta> [--allow-remote]',
    clean: (count) => `Sondas: las ${count} cumplen.`,
    failed: (count, total) => `Sondas: ${count} de ${total} fallan.`,
    mismatch: (name, m) => `✖ ${name} — ${m.what}: se esperaba ${shown(m.expected)}, llegó ${shown(m.actual)}`,
    savedIn: (dir) => `Resultado en ${dir}/results.json.`,
    noProbes: (spec) => `No se pudo ejecutar: ${spec} no tiene probes.json.`,
    malformed: (spec, problem) => `No se pudo ejecutar: el probes.json de ${spec} no vale (${problem}).`,
    notLocal: (url) => `No se pudo ejecutar: ${url} no es una dirección de esta máquina (localhost, 127.0.0.1, [::1]). Para sondearla igualmente, añade --allow-remote.`
  },
  en: {
    usage: 'Usage: node .chalc/probe.mjs run --spec <folder> [--allow-remote]',
    clean: (count) => `Probes: all ${count} pass.`,
    failed: (count, total) => `Probes: ${count} of ${total} fail.`,
    mismatch: (name, m) => `✖ ${name} — ${m.what}: expected ${shown(m.expected)}, got ${shown(m.actual)}`,
    savedIn: (dir) => `Result in ${dir}/results.json.`,
    noProbes: (spec) => `Could not run: ${spec} has no probes.json.`,
    malformed: (spec, problem) => `Could not run: the probes.json of ${spec} is not valid (${problem}).`,
    notLocal: (url) => `Could not run: ${url} is not an address on this machine (localhost, 127.0.0.1, [::1]). To probe it anyway, add --allow-remote.`
  }
};

/** Los textos de `lang`; un idioma desconocido cae al inglés. */
export const textOf = (lang) => MESSAGES[lang] || MESSAGES.en;
