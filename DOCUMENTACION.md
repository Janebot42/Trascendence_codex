# Documentación técnica de Transcendence

## 1. Objetivo

Transcendence es una aplicación web de Pong que integra juego 3D, partidas remotas, comunicación en tiempo real, gestión social, estadísticas y autenticación avanzada.

La solución utiliza un monolito modular. Hay un único proceso de aplicación, pero cada dominio mantiene separadas sus rutas, servicios, tipos y repositorios. Este diseño reduce la complejidad operativa sin mezclar responsabilidades.

## 2. Selección de módulos: 14 puntos

La implementación se ha orientado a la siguiente combinación del enunciado:

| Área | Módulo | Puntos | Evidencia en el proyecto |
|---|---|---:|---|
| Gaming y UX | Juego web completo | 2 | Reglas, marcador, victoria a 5 puntos, controles y flujo completo de partida |
| Gaming y UX | Jugadores remotos en tiempo real | 2 | Matchmaking 1v1 y estado autoritativo por WebSocket |
| Gaming y UX | Gráficos 3D avanzados | 2 | Escena, cámara, iluminación y objetos con Three.js |
| Web | Funcionalidad en tiempo real | 2 | WebSocket para juego, presencia, chat e invitaciones |
| Web | Interacción social | 2 | Chat, perfiles, amigos, bloqueos y presencia |
| Web | ORM | 1 | Prisma ORM y migraciones sobre SQLite |
| Gestión de usuarios | OAuth 2.0 | 1 | Login, vinculación y desvinculación segura con 42 |
| Gestión de usuarios | 2FA | 1 | TOTP cifrado y códigos de recuperación |
| Gestión de usuarios | Estadísticas | 1 | Historial, victorias, derrotas y leaderboard |
| | **Total** | **14** | |

La valoración definitiva corresponde al evaluador y a la versión exacta del enunciado utilizada en la entrega. La tabla identifica la intención y la evidencia técnica disponible.

## 3. Arquitectura

```text
Navegador
  |-- HTTPS / HTTP API --------> Fastify routes
  |                                |-- servicios de dominio
  |                                `-- repositorios Prisma
  |
  `-- WebSocket /ws -----------> LiveHub
                                   |-- matchmaking
                                   |-- bucle autoritativo de Pong
                                   |-- presencia y chat
                                   `-- persistencia del resultado

Fastify + LiveHub -------------> Prisma ORM -------------> SQLite
        |
        `----------------------> archivos estáticos y Three.js
```

En Docker, Caddy recibe HTTPS en el puerto `8443` y reenvía las peticiones al contenedor de Node en el puerto `3000`. Node no se publica directamente al host.

## 4. Dominios del backend

### `users`

Gestiona identidad y perfil público, avatar, biografía, roles, estado, amistades y bloqueos. También calcula la presencia con la información proporcionada por `LiveHub`.

### `auth`

Coordina registro, login, segundo factor, reautenticación y cambio de contraseña. Las contraseñas se procesan con `scrypt` y nunca se almacenan en texto claro.

### `sessions`

Crea y revoca sesiones de servidor. El navegador recibe un token opaco en una cookie HTTP-only; la persistencia contiene únicamente el hash del token.

### `two_factor`

Implementa el alta, confirmación y desactivación de TOTP. El secreto TOTP se cifra con `TOTP_ENCRYPTION_KEY_BASE64`. Los códigos de recuperación se almacenan mediante hash y solo pueden utilizarse una vez.

### `oauth`

Implementa OAuth 2.0 con 42 para login y para vinculación explícita de cuentas. Ambos flujos utilizan estados distintos, caducidad y una cookie temporal del navegador. No se enlazan cuentas automáticamente por coincidencia de correo.

### `authorization`

Contiene los controles comunes de sesión y rol. Las rutas privadas usan `requireAuth`; las administrativas añaden `requireRole`.

### `live`

Mantiene las conexiones WebSocket, usuarios en línea, cola de matchmaking y partidas activas. El servidor calcula movimiento, colisiones, goles y resultado; el cliente solo envía la intención de movimiento y representa los estados recibidos.

Si no aparece un rival humano en 2,5 segundos, se crea o reutiliza el usuario `pongbot`. Los cinco niveles alteran velocidad, error, zona muerta y tiempo de reacción del bot.

Una desconexión pausa la partida. El jugador dispone de 15 segundos para volver; después pierde por abandono.

### `matches`

Persiste partidas terminadas y ofrece historial por usuario, estadísticas agregadas y clasificación.

### `chat`

Persiste mensajes del lobby y conversaciones directas. El WebSocket distribuye mensajes e indicadores de escritura en tiempo real.

## 5. Cliente web

El cliente está en `public/` y no requiere un framework de interfaz:

- `index.html`: estructura de autenticación, juego, chat, estadísticas y modales.
- `app.css`: diseño adaptable para escritorio y móvil.
- `app.js`: estado de interfaz, llamadas HTTP, WebSocket y escena Three.js.

Three.js se sirve desde la dependencia instalada. El navegador no necesita descargar la librería desde un CDN.

La escena 3D representa el estado calculado por el servidor. Los controles de teclado y táctiles envían mensajes `game:input`; no deciden la posición final de la pelota ni el resultado.

## 6. Flujo de una partida

1. El cliente autenticado abre `/ws` usando su cookie de sesión.
2. `LiveHub` valida la sesión y comunica presencia y estado actual.
3. El usuario envía `queue:join` con una dificultad de bot entre 1 y 5.
4. El servidor empareja dos usuarios o activa el rival automático.
5. El servidor ejecuta el juego aproximadamente cada 33 ms.
6. Los clientes envían entradas y reciben instantáneas `game:state`.
7. Al llegar a 5 puntos, el servidor guarda la partida y emite `game:finished`.
8. El cliente refresca estadísticas, historial y leaderboard.

Mensajes principales enviados por el cliente:

- `queue:join`, `queue:leave`.
- `game:input`.
- `chat:send`, `chat:typing`, `chat:invite`.

Eventos principales enviados por el servidor:

- `session:ready`, `presence:update`, `queue:update`.
- `game:start`, `game:state`, `game:pause`, `game:resume`, `game:finished`.
- `chat:message`, `chat:typing`, `chat:invite`.

## 7. Autenticación y seguridad

### Login local

1. Se valida usuario y contraseña.
2. Si 2FA está desactivado, se crea la sesión.
3. Si 2FA está activo, se entrega un challenge con cinco minutos de validez.
4. La sesión solo se crea al validar TOTP o un código de recuperación.

### Acciones sensibles

Cambiar la contraseña, configurar 2FA o modificar la vinculación con 42 requiere una reautenticación reciente. Esa autorización reforzada dura diez minutos. Tras cambiar contraseña o desactivar 2FA se revocan las demás sesiones del usuario.

### OAuth 42

El estado OAuth dura diez minutos y debe coincidir con la cookie temporal iniciada en el mismo navegador. Los estados son de un solo uso y diferencian login de vinculación. Una cuenta de 42 no puede pertenecer a dos usuarios locales.

### Medidas implementadas

- Cookies de sesión HTTP-only, `SameSite=Lax` y `Secure` en producción.
- Tokens opacos y hashes de sesión en base de datos.
- Contraseñas con `scrypt`.
- Secretos TOTP cifrados.
- Códigos de recuperación hasheados y de un solo uso.
- Validación de entrada con Zod.
- Reautenticación para operaciones críticas.
- Separación entre identidad, credenciales y sesiones.

## 8. Persistencia

Prisma define el esquema en `prisma/schema.prisma`. SQLite funciona con modo WAL y un `busy_timeout` de cinco segundos para mejorar la concurrencia.

Modelos actuales:

- `User`, `PasswordCredential`, `Session` y `LoginChallenge`.
- `TwoFactorTotp` y `RecoveryCode`.
- `OAuthAccount` y `OAuthState`.
- `Match` y `MatchPlayer`.
- `ChatMessage`.
- `Friendship` y `UserBlock`.

El estado activo del juego no se guarda en SQLite. Permanece en memoria porque cambia varias veces por segundo; únicamente se persiste el resultado final.

## 9. API HTTP

Todas las rutas sociales, de chat, partidas y seguridad requieren sesión salvo que se indique lo contrario.

### Públicas

- `GET /`, `GET /health`, `GET /privacy`, `GET /terms`.
- `POST /auth/register`, `POST /auth/login`, `POST /auth/login/2fa`.
- `GET /auth/oauth/42`, `GET /auth/oauth/42/callback`.

### Cuenta y seguridad

- `POST /auth/logout`, `POST /auth/reauthenticate`, `POST /auth/password/change`.
- `POST /2fa/setup`, `POST /2fa/confirm`.
- `POST /2fa/recovery-codes/regenerate`, `DELETE /2fa`.
- `POST /auth/oauth/42/link/start`, `GET /auth/oauth/42/link/callback`.
- `DELETE /auth/oauth/42/link`.

### Usuarios y relaciones

- `GET /me`, `PATCH /me/profile`, `GET /users`.
- `GET /users/:userId/profile`, `GET /me/friends`.
- `POST /users/:userId/friends`, `POST /users/:userId/friends/accept`.
- `DELETE /users/:userId/friends`.
- `POST /users/:userId/block`, `DELETE /users/:userId/block`.
- `GET /admin/users`, restringida a administradores.

### Partidas y chat

- `POST /matches`, `GET /users/:userId/matches`.
- `GET /users/:userId/stats`, `GET /leaderboard`.
- `POST /chat/messages`, `GET /chat/messages`.
- `POST /chat/direct/:userId/messages`, `GET /chat/direct/:userId/messages`.
- `GET /ws`, actualización bidireccional mediante WebSocket.

## 10. Límites actuales

- No hay torneo ni modo para más de dos jugadores simultáneos.
- Las partidas activas no sobreviven al reinicio del proceso.
- No hay verificación de correo ni recuperación de contraseña por correo.
- El rate limiting existente es local al proceso y no sustituye una protección distribuida.
- Los avatares se almacenan como data URL en SQLite; el cliente limita la subida a 256 KB.
- El certificado de Caddy es local y no equivale a un certificado público de producción.

Para instalar, ejecutar y probar la aplicación consulta [README.md](README.md). Para modificar el código consulta [DEV.md](DEV.md).
