# Guía de desarrollo

## 1. Entorno

Versiones de referencia:

- Node.js 24.
- npm incluido con Node.
- Docker Desktop con motor Linux, si se usa Docker.

Instalación local:

```powershell
Copy-Item .env.example .env
npm install
npm run prisma:generate
npm run prisma:migrate
```

Genera una clave de desarrollo para TOTP:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Guárdala en `.env` como `TOTP_ENCRYPTION_KEY_BASE64`. El archivo `.env`, las bases SQLite, `dist/` y `node_modules/` están ignorados por Git.

## 2. Comandos

| Comando | Función |
|---|---|
| `npm run build` | Compila backend y cliente TypeScript |
| `npm run build:backend` | Compila únicamente el backend en `dist/` |
| `npm run build:client` | Compila `client/app.ts` como `public/app.js` |
| `npm start` | Ejecuta la compilación existente |
| `npm run dev` | Mantiene el compilador TypeScript en modo observación |
| `npm run dev:client` | Mantiene el cliente TypeScript en modo observación |
| `npm test` | Ejecuta los tests de integración |
| `npm run prisma:generate` | Regenera Prisma Client |
| `npm run prisma:migrate` | Crea o aplica migraciones de desarrollo |
| `npm run prisma:studio` | Abre el inspector de la base de datos |

Los comandos de observación no arrancan el servidor. Durante el desarrollo del proyecto completo usa tres terminales:

```powershell
# Terminal 1
npm run dev

# Terminal 2
npm run dev:client

# Terminal 3, después de la primera compilación
npm start
```

Reinicia el servidor cuando cambie código del backend. Los cambios del cliente generan un nuevo `public/app.js` y requieren recargar el navegador.

## 3. Configuración

Variables reconocidas:

| Variable | Uso |
|---|---|
| `NODE_ENV` | `development`, `test` o `production` |
| `HOST`, `PORT` | Dirección y puerto de Fastify |
| `COOKIE_SECURE` | Obliga a enviar la cookie solo por HTTPS |
| `SESSION_COOKIE_NAME` | Nombre de la cookie de sesión |
| `SESSION_TTL_DAYS` | Duración de la sesión |
| `TOTP_ISSUER` | Nombre mostrado por la aplicación autenticadora |
| `TOTP_ENCRYPTION_KEY_BASE64` | Clave obligatoria para cifrar secretos TOTP |
| `DATABASE_URL` | URL de SQLite; sin ella se usan repositorios en memoria |
| `OAUTH_42_CLIENT_ID` | Identificador de la aplicación de 42 |
| `OAUTH_42_CLIENT_SECRET` | Secreto de la aplicación de 42 |
| `OAUTH_42_REDIRECT_URI` | Callback autorizado en 42 |
| `OAUTH_42_AUTHORIZE_URL` | Endpoint de autorización de 42 |
| `OAUTH_42_TOKEN_URL` | Endpoint de token de 42 |
| `OAUTH_42_ME_URL` | Endpoint de perfil de 42 |

La clave TOTP debe ser estable. Cambiarla hace ilegibles los secretos TOTP ya almacenados.

## 4. Organización del código

Cada dominio de `src/modules/` sigue, cuando lo necesita, esta separación:

- `*.routes.ts`: protocolo HTTP, validación y códigos de respuesta.
- `*.service.ts`: reglas y coordinación de negocio.
- `*.repository.ts`: contrato e implementación en memoria.
- `*.prismaRepository.ts`: persistencia real con Prisma.
- `*.types.ts`: tipos del dominio.

Dependencias principales:

```text
routes -> services -> repositories
                    -> other domain services when orchestration is required
```

`src/app.ts` es la raíz de composición: crea repositorios, servicios, plugins y rutas. `src/server.ts` solo construye la aplicación y abre el puerto.

Normas de diseño:

- Mantén la lógica de negocio fuera de las rutas.
- Valida toda entrada externa con Zod.
- No expongas hashes, secretos ni tokens en respuestas JSON.
- No crees una sesión antes de completar el segundo factor.
- No guardes el estado de cada frame en SQLite.
- Añade persistencia mediante Prisma, no mediante SQL incrustado en rutas.
- Conserva implementaciones en memoria para que los tests permanezcan aislados.

## 5. Base de datos y migraciones

Para cambiar el esquema:

1. Edita `prisma/schema.prisma`.
2. Crea y aplica una migración con un nombre descriptivo:

```powershell
npx prisma migrate dev --name nombre_del_cambio
```

3. Regenera el cliente y compila:

```powershell
npm run prisma:generate
npm run build
```

4. Revisa el SQL creado en `prisma/migrations/` y ejecuta los tests.

En Docker, `docker-entrypoint.sh` ejecuta `prisma migrate deploy` antes de iniciar Node. No edites una migración que ya se haya compartido o aplicado; crea otra.

Para inspeccionar datos:

```powershell
npm run prisma:studio
```

`npx prisma migrate reset` elimina la base local. Úsalo únicamente cuando esos datos puedan perderse.

## 6. WebSocket y juego

`LiveHub` es responsable del estado efímero. Al añadir mensajes:

- Usa el formato `{ "type": "...", "payload": { ... } }`.
- Autentica siempre mediante la sesión existente.
- Trata los datos del cliente como intención, no como estado fiable.
- Limita y valida cadenas, identificadores y valores numéricos.
- Limpia temporizadores, colas y mapas al terminar una partida o cerrar una conexión.
- Persiste el resultado una sola vez desde el servidor.

Constantes como tamaño del tablero, puntuación objetivo, frecuencia de actualización y dificultad del bot están en `src/modules/live/live.routes.ts`.

## 7. Cliente

La interfaz usa HTML, CSS y TypeScript sin framework frontend. Al cambiarla:

- Mantén `public/index.html` accesible con teclado y controles táctiles.
- Modifica `client/app.ts`; `public/app.js` es un resultado generado.
- Centraliza las peticiones HTTP en el helper tipado `api`.
- Define contratos para respuestas HTTP, mensajes WebSocket y estado del juego.
- Mantén en `client/three.d.ts` únicamente la superficie de Three.js utilizada por la aplicación.
- Escapa contenido de usuarios antes de insertarlo como HTML.
- Mantén la escena visual separada del estado autoritativo recibido.
- Comprueba escritorio y móvil.
- No introduzcas dependencias desde CDN; el despliegue debe ser autocontenido.

Los avatares admitidos son PNG, JPEG y GIF, con un máximo de 256 KB en el cliente. El backend también acepta una URL válida por compatibilidad.

## 8. Tests

Ejecuta siempre:

```powershell
npm run build
npm test
```

Los tests establecen `NODE_ENV=test`, por lo que `buildApp()` usa repositorios en memoria. No necesitan SQLite ni credenciales reales de 42; el flujo OAuth simula las respuestas externas.

Cobertura actual:

- Registro, login, logout y protección de rutas.
- TOTP, códigos de recuperación y reautenticación.
- Cambio de contraseña y revocación de sesiones.
- Inicio, callback, vinculación y desvinculación de OAuth 42.
- Partidas, historial y validación de resultados.
- Chat de lobby y validación de mensajes.
- Dos sesiones WebSocket simultáneas, chat en vivo, invitaciones, matchmaking y controles de partida.
- Entrega del cliente web y páginas legales.

Cuando añadas comportamiento persistente, prueba el servicio y la ruta. Cuando modifiques el protocolo WebSocket o la física, amplía `live-multiplayer.test.mjs` con el nuevo comportamiento.

## 9. Comprobación con Docker

Antes de entregar:

```powershell
docker compose build --no-cache
docker compose up
```

Comprueba:

- `https://localhost:8443/` carga sin recursos 404.
- Registro, login y logout funcionan.
- Dos navegadores pueden emparejarse.
- Sin segundo jugador aparece el bot.
- Chat, perfiles y estadísticas se actualizan.
- La base conserva los datos tras `docker compose down` y un nuevo arranque.
- Los logs no muestran reinicios continuos del contenedor.

Si aparece `dockerDesktopLinuxEngine` no encontrado, Docker Desktop no está abierto o no está usando contenedores Linux. Si la aplicación reinicia por una variable vacía, revisa `.env`, especialmente `TOTP_ENCRYPTION_KEY_BASE64`.

## 10. Criterio de finalización

Un cambio se considera terminado cuando:

- Compila sin errores.
- Los tests existentes pasan y el cambio tiene cobertura proporcional a su riesgo.
- Las migraciones necesarias están incluidas.
- No se han añadido secretos ni bases de datos al repositorio.
- La documentación refleja cualquier cambio de configuración, API o comportamiento visible.
- El flujo afectado se ha probado en el navegador cuando corresponde.
