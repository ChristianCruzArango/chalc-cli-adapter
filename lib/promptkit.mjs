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
