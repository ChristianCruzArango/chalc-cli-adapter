// lib/xls-crypto.mjs — el cifrado RC4 de Office que usan los .xls «solo lectura recomendada».
// Responsabilidad ÚNICA: derivar la clave, verificar la contraseña y producir el keystream
// ([MS-OFFCRYPTO] 2.3.6). Qué bytes del libro van cifrados lo decide lib/xls.mjs.

import { createHash } from 'node:crypto';

export const RC4_BLOCK = 1024; // el keystream se reinicia cada bloque de 1024 bytes del stream

// ─────────────────────────────────────────────────────────────────── cifrado RC4

const md5 = (...parts) => createHash('md5').update(Buffer.concat(parts)).digest();

/**
 * RC4 como generador de keystream. A mano y no con node:crypto porque OpenSSL 3 saca RC4 del
 * proveedor por defecto: `createCipheriv('rc4')` revienta en buena parte de las instalaciones.
 */
export function rc4(key) {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  let i = 0;
  let j = 0;
  return () => {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
    return s[(s[i] + s[j]) & 255];
  };
}

/** RC4 de una sola tacada sobre un buffer (para el verificador, que son 32 bytes). */
export function rc4Apply(key, data) {
  const next = rc4(key);
  const out = Buffer.alloc(data.length);
  for (let n = 0; n < data.length; n++) out[n] = data[n] ^ next();
  return out;
}

/** Derivación de clave RC4 de Office ([MS-OFFCRYPTO] 2.3.6.2). */
export function deriveKey(password, salt, block) {
  const truncated = md5(Buffer.from(password.slice(0, 16), 'utf16le')).subarray(0, 5);
  // el bloque intermedio es (hash truncado + salt) repetido 16 veces
  const intermediate = Buffer.concat(Array.from({ length: 16 }, () => Buffer.concat([truncated, salt])));
  const final = md5(intermediate).subarray(0, 5);
  const blockLE = Buffer.alloc(4);
  blockLE.writeUInt32LE(block >>> 0, 0);
  return md5(final, blockLE).subarray(0, 16);
}

/** El verificador: descifra 32 bytes y comprueba que el MD5 de la primera mitad da la segunda. */
export function verifyPassword(password, salt, encVerifier, encVerifierHash) {
  const clear = rc4Apply(deriveKey(password, salt, 0), Buffer.concat([encVerifier, encVerifierHash]));
  return md5(clear.subarray(0, 16)).equals(clear.subarray(16, 32));
}
