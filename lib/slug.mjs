// lib/slug.mjs — UN criterio para convertir un nombre en slug: carpetas de spec, ramas, ids del
// catálogo y nombres de proyecto. Antes había cinco copias, y dos de ellas no quitaban los acentos
// («gestión» acababa en la carpeta `gesti-n`).

// kebab-case ASCII: minúsculas, sin acentos, un guion entre palabras. '' si no queda nada.
export function slugify(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
