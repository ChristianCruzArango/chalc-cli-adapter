// cli/tools/registry.mjs — ensambla el mapa de herramientas de una sesión, ligado a la raíz del proyecto.
// Único punto donde se juntan fs + shell, para que el motor reciba un { nombre: tool } uniforme.
// `approve` y `allow` se inyectan desde la shell (CLI); las tools no saben de terminal ni de proveedores.

import { createFsTools } from './fs.mjs';
import { createShellTool } from './shell.mjs';

export function createTools({ root, approve = async () => true, allow = [], timeoutMs, layoutRoots = [] } = {}) {
  if (!root) throw new Error('createTools requiere root (raíz del proyecto).');
  return {
    ...createFsTools({ root, approve, layoutRoots }),
    ...createShellTool({ root, allow, approve, timeoutMs })
  };
}
