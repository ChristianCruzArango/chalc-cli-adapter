// secret-files.mjs — qué es un archivo de credenciales (spec 017, R6). Responsabilidad ÚNICA: decidir,
// por la ruta, si un archivo ES una lista de secretos. Razón de cambio: qué nombres de archivo guardan
// credenciales.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Vive aquí y no en `lib/redact.mjs` porque tiene dos consumidores que DEBEN estar de acuerdo: la
// redacción de chalc (lo que el modelo puede ver de un `.env`) y la guarda del asistente (lo que no
// puede leer). La guarda se emite al repo equipado y no puede importar de `lib/`; al revés sí se puede,
// así que `lib/redact.mjs` lo re-exporta. Dos listas se desincronizan, y la que se queda atrás no falla:
// deja pasar un `.pypirc`.

// También `.envrc` (direnv), las variables de Terraform (`*.tfvars`, `*.tfvars.json`), el `kubeconfig` (y su
// sitio por defecto, `.kube/config`) y las credenciales de Docker (`.docker/config.json`).
const SECRET_FILE = /(^|[\\/])(\.env(\.[\w.-]+)?|\.envrc|\.npmrc|\.pypirc|\.netrc|\.git-credentials|credentials(\.json)?|secrets?\.(json|ya?ml|toml)|id_(rsa|dsa|ecdsa|ed25519)|kubeconfig|\.kube[\\/]config|\.docker[\\/]config\.json|[^\\/]+\.tfvars(\.json)?|[^\\/]+\.(pem|key|p12|pfx|keystore|jks))$/i;

// Las plantillas de un `.env`: se commitean para decir QUÉ variables hacen falta, sin valores. Leerlas
// no expone nada, y bloquearlas impediría al asistente saber cómo se configura el proyecto.
const ENV_TEMPLATE = /(^|[\\/])\.env\.(example|sample|template)$/i;

/** ¿La ruta nombra un archivo cuyo contenido es una lista de secretos? */
export const isSecretFile = (path) => SECRET_FILE.test(String(path || ''));

/** ¿La ruta es una plantilla de `.env` sin valores (`.env.example`, `.env.sample`, `.env.template`)? */
export const isEnvTemplate = (path) => ENV_TEMPLATE.test(String(path || ''));
