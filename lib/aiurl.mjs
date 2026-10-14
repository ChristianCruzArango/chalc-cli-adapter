// lib/aiurl.mjs — ¿se puede mandar la API key a esta base URL? (S9).
// Responsabilidad única: impedir que la key de un proveedor de nube viaje en claro (`http:`) a un host
// que no sea la propia máquina. Ollama/LM Studio en local (`http://localhost`) siguen funcionando.

const LOOPBACK = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\]|::1)$/i;

export function isInsecureBaseURL(baseURL) {
  try {
    const { protocol, hostname } = new URL(baseURL);
    return protocol === 'http:' && !LOOPBACK.test(hostname);
  } catch {
    return false;   // URL inválida: que falle fetch con su propio mensaje
  }
}
