---
name: secure-coding
description: Secure coding rules to apply WHILE writing code, for every stack — OWASP Top 10 for web and backend, plus OWASP MASVS for mobile (Flutter, Android, iOS). Use before writing or changing code that handles external input, authentication, sessions, authorization, secrets, storage, network calls, cryptography, logging, files, WebViews or deep links. Also the reading map the `seguridad` review role uses to pick the right reference.
metadata:
  source: chalc-authored
  updated: "2026"
---

# Secure coding (OWASP Top 10 + MASVS)

Apply this **before writing** the code, not after the review. A vulnerability is cheapest to fix in the
task that introduces it.

This skill is short on purpose. For the detail of a category, open the one reference listed for it;
do not read every security skill end to end.

## How the cycle checks you

- The quality gate (`node .chalc/gate.mjs`) blocks what it can prove from a line: hardcoded secrets,
  disabled TLS, `http://` to non-local hosts, SQL built from strings, `eval`/shell with data,
  unescaped HTML, MD5/SHA1.
- A gate finding that is a real false positive is justified in place, with a reason of at least three
  words, and it shows up in the evidence:
  `// chalc-allow: <rule> — <reason>`
- The `seguridad` role then reviews the task against every category below and leaves a checklist in
  `.chalc/review.md`. A finding comes back to you as `fix_review`: write a test that demonstrates the
  vulnerability first, then fix it.

## Every stack: OWASP Top 10 (2021)

| Category | Do this while writing | Reference |
|---|---|---|
| A01 Broken access control | Deny by default. Check on the server/logic side that the caller owns the resource behind every id that comes from outside (no IDOR). Never rely on hiding a button or a route. | `security-review/references/authorization.md` |
| A02 Cryptographic failures | No secrets in code: read them from the environment or a secret store. TLS everywhere. Passwords with bcrypt/argon2id; integrity with SHA-256 or better. Use the platform's crypto, never your own. | `security-review/references/cryptography.md` |
| A03 Injection | Bound parameters for every query. Escape output for its context (HTML, attribute, URL). Commands as argument lists, never a shell string with data. | `security-review/references/injection.md` |
| A04 Insecure design | Validate every external input with a schema: type, range, length, format. Limits on amounts, retries and sizes. Think about who must NOT be able to do this operation. | `security-review/references/business-logic.md` |
| A05 Security misconfiguration | Debug off in release, no stack traces to the user, restrictive CORS, secure headers, least-privilege permissions. | `security-review/references/misconfiguration.md` |
| A06 Vulnerable components | Pin dependency versions, add only what the requirement needs, and check advisories (`npm audit`, `pip-audit`, `dotnet list package --vulnerable`, `flutter pub outdated`). | `security-review/references/supply-chain.md` |
| A07 Identification and authentication | Tokens that expire, are invalidated on sign-out and are stored securely. Rate-limit sign-in. Verify the JWT signature, algorithm and expiry. | `security-review/references/authentication.md` |
| A08 Software and data integrity | Validate the shape of every deserialized payload before using it. Never deserialize untrusted data into arbitrary types. | `security-review/references/deserialization.md` |
| A09 Logging and monitoring | Log security events (failed sign-ins, denied access) without secrets, tokens, passwords or personal data. Errors keep their context but are not shown raw to the user. | `security-review/references/logging.md` |
| A10 SSRF | A URL that comes from the user is fetched only against an allowlist of destinations. | `security-review/references/ssrf.md` |

## Web and backend

- **Sessions and cookies:** `HttpOnly`, `Secure`, `SameSite`; CSRF protection when the session is a
  cookie (`security-review/references/csrf.md`).
- **Files:** size and type limits, generated names, no path built from user input
  (`security-review/references/file-security.md`).
- **APIs:** authentication and authorization on every endpoint, pagination limits, no mass assignment
  of request bodies to entities (`security-review/references/api-security.md`).
- **Language guides:** `security-review/languages/javascript.md` (JS/TS),
  `security-review/languages/python.md` (Python), `security-review/infrastructure/docker.md`
  (Dockerfile). Concrete rules per topic live in `code-security/rules/`, for example
  `code-security/rules/sql-injection.md` or `code-security/rules/xss.md`.

## Mobile: OWASP MASVS (Flutter, Android, iOS)

A mobile app runs on a device the attacker controls: everything shipped in the binary can be read,
and every value stored on the device can be extracted. The backend rules above still apply to the
API the app talks to.

- **MASVS-STORAGE**
  - Tokens, keys and personal data go in `flutter_secure_storage` (Keychain / Keystore), never in
    `SharedPreferences`, plain files or a local database without encryption.
  - Set `android:allowBackup="false"` (and exclude sensitive files in the data extraction rules) so a
    backup does not copy them off the device.
- **MASVS-CRYPTO**
  - No API keys or secrets in the app: anything in the binary is public. Keys that must exist on the
    device are generated there and kept in the Keystore / Keychain.
  - Use vetted libraries (`cryptography`, platform APIs); no MD5/SHA1, no fixed IVs.
- **MASVS-AUTH**
  - The backend decides; the app only asks. A local biometric check (`local_auth`) unlocks a key or a
    stored token, it is not by itself proof of identity.
  - Sign-out deletes the tokens from secure storage.
- **MASVS-NETWORK**
  - HTTPS only. On Android keep `android:usesCleartextTraffic="false"`; on iOS never set
    `NSAllowsArbitraryLoads` to true.
  - `badCertificateCallback` never returns `true`. For high-value apps (payments, banking) pin the
    server certificate with a `SecurityContext` that trusts only your certificate.
- **MASVS-PLATFORM**
  - Validate every parameter that arrives through a deep link before using it, and guard protected
    routes in the router (for example a `go_router` `redirect`), not only by hiding the button.
  - WebView: enable JavaScript only when needed, restrict navigation to your domains in the
    navigation delegate, and never expose a JavaScript channel that returns secrets.
  - Request only the permissions the feature uses, with an honest usage string in `Info.plist`.
  - Never ship a release with `android:debuggable="true"`; do not export activities that do not need it.
- **MASVS-CODE**
  - No `print` or `debugPrint` of tokens, balances, documents or personal data: they reach the device
    log in release. Validate data from the API and from local storage as untrusted input.
  - Keep Flutter, plugins and native dependencies updated.
- **MASVS-RESILIENCE**
  - Build releases with `flutter build <target> --obfuscate --split-debug-info=<dir>` and keep the
    symbols private.
  - Root / jailbreak detection is defense in depth, never the only control.
- **MASVS-PRIVACY**
  - Collect only the data the feature needs, no personal data in analytics or crash reports, and
    hide sensitive screens (balances, codes) from screenshots and the app switcher when the app
    handles money or identity.

Detail for storage, crypto and logs on any platform: `security-review/references/data-protection.md`,
`security-review/references/cryptography.md`, `security-review/references/logging.md`.
