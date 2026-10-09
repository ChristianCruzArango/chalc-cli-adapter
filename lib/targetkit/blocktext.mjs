// lib/targetkit/blocktext.mjs — lo que chalc escribe en el archivo del asistente de cada proyecto
// (CLAUDE.md, AGENTS.md, reglas de Cursor…), en el idioma del SPEC: el bloque vive en el repo del
// usuario, no en la consola de chalc. Sin idioma de spec, el de la CLI.

import { contentLang } from '../contentlang.mjs';

const BLOCK_TEXT = {
  es: {
    skillsAvailable: 'Skills disponibles',
    readWhenNeeded: '_Cuando la tarea lo amerite, lee el archivo indicado:_',
    skillsActive: 'Skills activas',
    mcpServers: 'Servidores MCP',
    agreedArchitecture: (name) => `Arquitectura acordada: **${name}**.\n`,
    architecture: '### 🏛️ Arquitectura\n',
    architectureBody: `Antes de crear o mover CUALQUIER archivo, lee \`docs/architecture.md\` — define las capas, qué va en cada carpeta, las reglas de dependencia y cómo agregar un feature. Cada carpeta tiene además su propio \`README.md\` con su rol. Mantén todo el código dentro de esos límites.`,
    principles: [
      '### ✅ Principios obligatorios (SIEMPRE)',
      'Implementación mínima, Clean Code, SOLID y **arquitectura modular** aplican a **todo** el código de este proyecto, sin excepción:',
      'alta cohesión y bajo acoplamiento, unidades pequeñas, nombres explícitos, una responsabilidad por',
      'archivo/carpeta/símbolo, código testeable desde el diseño y el cambio más pequeño que satisface el',
      'requisito aprobado o test fallando actual. Reutiliza código existente y APIs del framework antes de crear',
      'archivos, wrappers, abstracciones, dependencias, tooling o capas. Las skills `minimal-implementation`,',
      '`clean-code`, `solid-principles` y `modular-architecture` definen el detalle — **ábrelas y aplícalas por defecto**, no solo cuando se pidan.',
      '**Cada carpeta lleva un `README.md`** que explica brevemente qué contiene y para qué sirve (2–5 líneas).',
      'Al crear una carpeta, crea su README en el mismo cambio; si la carpeta cambia de rol, actualízalo.'
    ],
    rulePrinciples: 'Principios obligatorios del proyecto (Chalc)',
    ruleArchitecture: 'Arquitectura acordada del proyecto (Chalc)',
    ruleMethod: (label) => `Método ${label} (Chalc)`,
    skillRuleBody: (name, id) => `## ${name}\n\nCuando esta tarea aplique, sigue la skill completa en \`.chalc/skills/${id}/SKILL.md\`.`
  },
  en: {
    skillsAvailable: 'Available skills',
    readWhenNeeded: '_When the task calls for it, read the file shown:_',
    skillsActive: 'Active skills',
    mcpServers: 'MCP servers',
    agreedArchitecture: (name) => `Agreed architecture: **${name}**.\n`,
    architecture: '### 🏛️ Architecture\n',
    architectureBody: `Before creating or moving ANY file, read \`docs/architecture.md\` — it defines the layers, what goes in each folder, the dependency rules and how to add a feature. Each folder also has its own \`README.md\` with its role. Keep all code within those boundaries.`,
    principles: [
      '### ✅ Mandatory principles (ALWAYS)',
      'Minimal implementation, Clean Code, SOLID and **modular architecture** apply to **all** code in this project — no exceptions:',
      'high cohesion and low coupling, small units, explicit names, one responsibility per file/folder/symbol,',
      'code that is testable by design, and the smallest change that satisfies the current approved requirement',
      'or failing test. Reuse existing code and framework APIs before adding files, wrappers, abstractions,',
      'dependencies, tooling or layers. The `minimal-implementation`, `clean-code`, `solid-principles` and',
      '`modular-architecture` skills define the detail — **open and apply them by default**, not only when explicitly asked.',
      '**Every folder has a `README.md`** that briefly explains what lives there and what it is for (2–5 lines).',
      'When you create a folder, create its README in the same change; when a folder changes role, update it.'
    ],
    rulePrinciples: 'Mandatory project principles (Chalc)',
    ruleArchitecture: 'Agreed project architecture (Chalc)',
    ruleMethod: (label) => `Method ${label} (Chalc)`,
    skillRuleBody: (name, id) => `## ${name}\n\nWhen this task applies, follow the full skill in \`.chalc/skills/${id}/SKILL.md\`.`
  }
};

export const blockText = (specLang) => BLOCK_TEXT[contentLang(specLang)];
