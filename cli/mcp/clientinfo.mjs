// cli/mcp/clientinfo.mjs — cómo se presenta chalc ante un servidor MCP en el `initialize`. Un solo
// sitio y la versión real del paquete: los dos clientes (stdio y HTTP) anunciaban un `0.1.0` fijo.

import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

export const CLIENT_INFO = { name: 'chalc-cli', version };

// Plazos de los clientes MCP: una petición normal, el arranque de un servidor (handshake incluido) y
// la llamada a una tool, que puede ejecutar generadores o CLIs lentos (ng generate, migraciones…).
export const MCP_REQUEST_TIMEOUT_MS = 15000;
export const MCP_CONNECT_TIMEOUT_MS = 12000;
export const MCP_TOOL_TIMEOUT_MS = 60000;
