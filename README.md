# Transcendence Pong

Aplicación web de Pong 3D con partidas multijugador en tiempo real, rival automático, chat, perfiles, estadísticas y autenticación segura.

El proyecto se entrega como una aplicación única: Fastify sirve la API y el cliente web, WebSocket mantiene las partidas y el chat en tiempo real, Prisma persiste los datos en SQLite y Caddy publica el servicio mediante HTTPS cuando se ejecuta con Docker.

## Funcionalidades

- Pong 1 contra 1 con servidor autoritativo y representación 3D mediante Three.js.
- Matchmaking entre usuarios conectados.
- Rival automático si no aparece otro jugador, con cinco niveles de dificultad.
- Chat de lobby, mensajes directos e invitaciones a partidas.
- Perfiles con nombre visible, biografía y avatar PNG, JPG o GIF.
- Amigos, solicitudes, presencia en línea y bloqueo de usuarios.
- Historial de partidas, victorias, derrotas, puntuación y clasificación.
- Registro y acceso con contraseña.
- Acceso y vinculación de cuenta mediante OAuth 2.0 de 42.
- Segundo factor TOTP y códigos de recuperación de un solo uso.
- Sesiones de servidor mediante cookies HTTP-only.
- Páginas de privacidad y condiciones de uso.

## Tecnologías

- Node.js 24 y TypeScript.
- Fastify 5 para HTTP y WebSocket.
- Three.js para la escena del juego.
- Prisma ORM 6 con SQLite.
- Zod para validación de entrada y configuración.
- `scrypt` para contraseñas y `otplib` para TOTP.
- Docker Compose y Caddy para despliegue HTTPS local.

## Inicio rápido con Docker

Requisitos:

- Docker Desktop abierto y configurado para contenedores Linux.
- Git.

1. Crea el archivo de configuración:

```powershell
Copy-Item .env.example .env
```

2. Genera una clave de cifrado y copia el resultado en `TOTP_ENCRYPTION_KEY_BASE64` dentro de `.env`:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

3. Construye y arranca los servicios:

```powershell
docker compose up --build
```

4. Abre [https://localhost:8443](https://localhost:8443).

Caddy utiliza un certificado local. El navegador puede pedir que confirmes la excepción de seguridad la primera vez. La base de datos se conserva en el volumen `app-data` aunque se reinicien los contenedores.

Para detener la aplicación:

```powershell
docker compose down
```

No uses `docker compose down -v` salvo que quieras borrar también los datos persistidos.

## Ejecución local sin Docker

Requisitos: Node.js 24 y npm.

```powershell
Copy-Item .env.example .env
npm install
npm run prisma:generate
npm run prisma:migrate
npm run build
npm start
```

La aplicación estará en [http://127.0.0.1:3000](http://127.0.0.1:3000). Para esta modalidad deja `COOKIE_SECURE=false` y usa en OAuth la URL de retorno HTTP local.

## Configuración de OAuth 42

OAuth es opcional para arrancar, pero necesita una aplicación registrada en 42 para funcionar. Configura en `.env`:

```env
OAUTH_42_CLIENT_ID=tu_client_id
OAUTH_42_CLIENT_SECRET=tu_client_secret
OAUTH_42_REDIRECT_URI=https://localhost:8443/auth/oauth/42/callback
```

La URI debe coincidir exactamente con la configurada en la aplicación de 42. Para ejecución sin Docker utiliza:

```env
OAUTH_42_REDIRECT_URI=http://127.0.0.1:3000/auth/oauth/42/callback
```

No subas `.env` ni credenciales al repositorio.

## Uso del juego

1. Registra una cuenta e inicia sesión.
2. Selecciona la dificultad del bot.
3. Pulsa `Find match`.
4. Si hay otro usuario buscando, ambos entrarán en la misma partida. Si no, el bot entrará tras unos segundos.
5. Mueve la pala con `W` y `S` o con los controles táctiles de la pantalla.
6. Gana el primer jugador que alcance 5 puntos.

El resultado se guarda automáticamente y actualiza el historial, las estadísticas y la clasificación.

## Verificación

```powershell
npm run build
npm test
```

Los tests de integración usan repositorios en memoria y no modifican la base de datos local.

## Estructura

```text
client/                 Fuente TypeScript del cliente y escena Three.js
public/                 HTML, CSS y JavaScript compilado para el navegador
src/modules/            Dominios del backend
src/ui/                 Rutas de archivos estáticos
src/shared/             Criptografía, errores y utilidades HTTP
src/db/                 Inicialización y mapeos de Prisma
prisma/                 Esquema y migraciones de SQLite
tests/integration/      Pruebas de integración
Dockerfile              Imagen de la aplicación
docker-compose.yml      Aplicación y proxy HTTPS
Caddyfile               Configuración HTTPS
```

La arquitectura completa, el modelo de datos y los flujos están en [DOCUMENTACION.md](DOCUMENTACION.md). Las normas para modificar y probar el código están en [DEV.md](DEV.md).
