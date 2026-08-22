// lib/promptkit.mjs — utilidades compartidas para armar prompts y parsear respuestas de la IA.
// Responsabilidad única: interpolar plantillas y limpiar el cercado ``` que el modelo a veces agrega.
// Centralizado para que una corrección al estándar de prompts se aplique en un solo lugar.

// Inyecta ${VAR} validando que todas estén resueltas (regla #9 del estándar de prompts HALLC).
export function inject(template, vars) {
  return String(template).replace(/\$\{(\w+)\}/g, (_, key) => {
    if (!(key in vars)) throw new Error(`Falta variable de prompt: ${key}`);
    return vars[key];
  });
}

// Quita un posible cercado ``` que el modelo a veces pone alrededor de todo el contenido.
export function unfence(text) {
  const t = String(text || '').trim();
  return t.startsWith('```') ? t.replace(/^```[\w-]*\s*\n?/, '').replace(/\n?```\s*$/, '').trim() : t;
}

// Un nombre de sección es una etiqueta, no un patrón: si llevara metacaracteres se metería en la
// RegExp y produciría un match imprevisto (o una expresión rota) muy difícil de ver desde fuera.
const SECTION_NAME = /^[A-Z0-9_]+$/;

/**
 * Lee una respuesta partida en marcas `===SECCIÓN===` y devuelve `{ SECCIÓN: texto }` con EXACTAMENTE
 * las secciones pedidas (las que no vinieron, cadena vacía).
 *
 * Sin JSON de por medio y sin exigir que estén todas: si el modelo se corta a mitad, lo ya recibido
 * se conserva — esa respuesta ya se pagó. Cada sección pasa por `unfence` porque el modelo a veces
 * envuelve una sola en ```.
 */
export function parseSections(raw, names) {
  const text = String(raw ?? '');
  const out = {};
  for (const name of names) {
    if (!SECTION_NAME.test(name)) throw new Error(`Nombre de sección inválido: ${name}`);
    // La marca va SOLA en su línea: entre `===` y el nombre caben espacios, nunca un salto de línea.
    // Sin esa condición, un cuerpo que contenga una palabra igual al nombre de otra sección
    // —`===VEREDICTO===` · `correcciones` · `===CORRECCIONES===`— hace que el cierre de una y la
    // apertura de la otra se lean como una única marca, y la sección sale empezando por basura.
    // El lookahead corta en la siguiente marca (sea cual sea) o al final del texto.
    // La condición de "línea propia" se comprueba con un lookbehind para no consumir el salto: si se
    // consumiera, dos marcas seguidas (una sección vacía) dejarían a la siguiente sin su `\n` delante
    // y el cierre no se reconocería.
    const re = new RegExp(
      `(?<=^|\\n)[ \\t]*===[ \\t]*${name}[ \\t]*===[ \\t]*([\\s\\S]*?)(?=\\n[ \\t]*===[ \\t]*[A-Z0-9_]+[ \\t]*===|$)`,
      'i'
    );
    const m = text.match(re);
    // Si la respuesta se cortó DENTRO de la marca siguiente (`===DESACUER`), ese resto no es
    // contenido de esta sección: se descarta. Exige al menos una letra tras `===` para no confundirlo
    // con el subrayado `===` de un título markdown, que es solo signos igual.
    out[name] = m ? unfence(m[1].replace(/\n?===[A-Z0-9_]+$/i, '')) : '';
  }
  return out;
}
