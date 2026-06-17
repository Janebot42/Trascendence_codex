# Diseño: account linking y unlinking de OAuth 42 para transcendence

## Resumen
Este diseño amplía el backend actual para gestionar de forma explícita el enlace y desenlace entre una cuenta local y una identidad OAuth 42. El objetivo es mantener separado el flujo de login OAuth del flujo de gestión de métodos de acceso, evitando enlaces implícitos inseguros y preservando un modelo de autenticación entendible.

La propuesta conserva el backend modular actual y reutiliza el módulo `oauth`, pero diferencia con claridad dos propósitos: iniciar sesión y enlazar una identidad externa a una cuenta ya autenticada.

## Objetivo
Añadir un flujo seguro de account linking y unlinking que permita:

- enlazar una cuenta OAuth 42 a una cuenta local ya autenticada
- exigir reautenticación fuerte antes del enlace o desenlace
- impedir conflictos entre cuentas enlazadas
- permitir desenlace solo cuando la cuenta conserve al menos un método de acceso viable

## Criterios de éxito
El diseño se considerará correcto si:

- un usuario autenticado puede enlazar OAuth 42 desde perfil sin romper el flujo de login actual
- no existe linking automático por email
- el callback de linking está aislado del callback de login
- unlink nunca deja la cuenta sin método de acceso utilizable
- el sistema permite convivir con cuentas solo OAuth, solo password y mixtas

## Alcance

### Incluye
- inicio de linking desde cuenta autenticada
- reautenticación fuerte obligatoria antes de link y unlink
- callback OAuth diferenciado para linking
- persistencia del enlace en `oauth_accounts`
- validación de conflictos si la cuenta OAuth ya pertenece a otro usuario
- unlink de OAuth 42 con verificación de método de acceso viable
- reglas explícitas para cuentas solo OAuth y cuentas mixtas

### No incluye por ahora
- linking automático por email
- UI final de producto
- soporte para múltiples proveedores distintos de 42
- gestión avanzada de “métodos de acceso” como entidad separada
- verificación de email local como factor de linking

## Enfoque arquitectónico
Se mantiene el módulo `oauth` como dueño del proveedor externo, pero se separan conceptualmente dos subflujos:

- **OAuth login**: demuestra identidad y termina en sesión local o en `requires_2fa`
- **OAuth linking**: solo modifica los métodos de acceso de una cuenta local ya autenticada

No se introduce un módulo nuevo. Se amplía `oauth` con nuevas rutas, nuevos métodos de servicio y más contexto en `oauth_states`.

## Decisiones principales

### 1. Linking solo desde sesión local autenticada
El enlace no se permite desde el flujo de login público. Solo se inicia desde perfil/ajustes de una cuenta ya autenticada.

### 2. Reautenticación fuerte obligatoria
Antes de link o unlink, el usuario debe haber pasado reautenticación reciente. Si tiene 2FA activo, eso implica contraseña + TOTP o recovery code.

### 3. Sin linking automático por email
La coincidencia de email no basta para unir una identidad OAuth con una cuenta local existente.

### 4. Unlink condicionado a método de acceso viable
No se puede borrar el enlace OAuth si eso deja la cuenta sin password local y sin otro proveedor OAuth enlazado.

### 5. Política mixta para cuentas
Se permite:
- cuenta solo OAuth
- cuenta solo password
- cuenta password + OAuth

Pero el sistema debe evitar transiciones que dejen una cuenta inaccesible.

## Cambios de modelo de datos

### `oauth_states`
Debe ampliarse con al menos:
- `purpose`: `login` | `link`
- `initiating_user_id` nullable

#### Semántica
- `purpose='login'`: flujo actual de acceso
- `purpose='link'`: flujo iniciado desde perfil de un usuario ya autenticado
- `initiating_user_id`: identifica quién inició el linking

Esto evita reutilizar el callback como si todo state significara lo mismo.

### `oauth_accounts`
La tabla actual sirve, pero pasa a soportar dos orígenes legítimos:
- creación durante OAuth login de cuenta nueva
- creación durante linking explícito desde cuenta local existente

No hacen falta cambios estructurales obligatorios aquí, salvo que más adelante quieras auditoría de cuándo y cómo se enlazó.

## Nuevas rutas propuestas

### `POST /auth/oauth/42/link/start`
Requisitos:
- sesión autenticada
- reautenticación fuerte reciente

Hace:
1. verifica sesión
2. verifica reauth reciente
3. crea `oauth_state` con `purpose='link'`
4. guarda `initiating_user_id`
5. deja cookie temporal `oauth42`
6. devuelve URL de autorización o redirige

### `GET /auth/oauth/42/link/callback`
Hace:
1. valida cookie temporal + `state`
2. consume state atómicamente
3. verifica `purpose='link'`
4. verifica `initiating_user_id`
5. intercambia `code` por token
6. obtiene perfil de 42
7. valida conflicto o idempotencia
8. crea el enlace si procede
9. responde éxito de linking, sin crear nueva sesión de login

### `DELETE /auth/oauth/42/link`
Requisitos:
- sesión autenticada
- reautenticación fuerte reciente

Hace:
1. localiza el enlace OAuth 42 del usuario actual
2. comprueba si puede desenlazarse sin dejar la cuenta inaccesible
3. elimina el enlace si la regla se cumple
4. devuelve confirmación

## Reglas funcionales detalladas

### Linking

#### Caso A: la cuenta OAuth 42 no está enlazada
- se crea el enlace a la cuenta autenticada actual
- se devuelve éxito

#### Caso B: la cuenta OAuth 42 ya está enlazada al mismo usuario
- respuesta idempotente / ya enlazada
- no se crea duplicado

#### Caso C: la cuenta OAuth 42 está enlazada a otro usuario
- conflicto
- no se modifica nada

### Unlink

#### Caso A: el usuario tiene password local válido
- unlink permitido

#### Caso B: no tiene password local, pero más adelante tuviera otro proveedor OAuth enlazado
- unlink permitido

#### Caso C: solo tiene este OAuth como acceso viable
- unlink prohibido

## Método de acceso viable
Conceptualmente el sistema necesita una comprobación centralizada del estilo:

- `hasPasswordCredential(userId)`
- `countOAuthAccounts(userId)`

La regla mínima actual sería:
- tras borrar el enlace actual, debe seguir existiendo al menos un método de acceso:
  - password local
  - o algún otro OAuth enlazado

Aunque por ahora solo exista el proveedor 42, conviene encapsular esta lógica para no repartir condiciones ad hoc.

## Integración con el sistema existente

### Reauth
El linking y unlinking deben reutilizar el mismo concepto de `reauthenticatedAt` que ya existe para acciones sensibles.

### OAuth login actual
No debe romperse. El login actual sigue teniendo este comportamiento:
- si el proveedor ya está enlazado, se resuelve usuario local
- si no está enlazado y no hay conflicto, puede crear cuenta nueva
- si encuentra una cuenta local existente por email, sigue fallando con `OAUTH_ACCOUNT_LINK_REQUIRED`

Eso mantiene la seguridad introducida en el endurecimiento previo.

### 2FA
El linking y unlinking no deben alterar la lógica del login 2FA, salvo en el requisito de reautenticación fuerte previa para operaciones sensibles.

## Manejo de errores
Debe distinguirse claramente entre:

- `UNAUTHORIZED`: sesión ausente, cookie/state inválidos, proveedor no válido
- `REAUTHENTICATION_REQUIRED`: falta reauth reciente
- `OAUTH_ACCOUNT_LINK_REQUIRED`: conflicto con cuenta local existente no enlazada
- `OAUTH_ALREADY_LINKED_TO_OTHER_USER`: la identidad 42 ya pertenece a otro usuario
- `OAUTH_UNLINK_FORBIDDEN`: desenlace dejaría la cuenta sin acceso viable
- `OAUTH_NOT_LINKED`: no existe enlace para borrar

## Testing

### Unit tests
- validación de `purpose` en `oauth_states`
- cálculo de viabilidad de acceso tras unlink
- detección de conflicto cuando la cuenta OAuth pertenece a otro usuario
- idempotencia al relink del mismo usuario

### Integration tests
- iniciar linking requiere sesión y reauth fuerte
- callback de linking falla si cookie/state no coinciden
- callback de linking crea enlace cuando no existe
- callback de linking no crea sesión nueva
- callback de linking falla si la cuenta OAuth ya pertenece a otro usuario
- unlink falla sin reauth fuerte
- unlink falla si dejaría la cuenta sin acceso viable
- unlink funciona si existe password local

## Riesgos controlados

### Riesgo: confundir login y linking
Mitigación: `oauth_states.purpose` + rutas separadas.

### Riesgo: account takeover por email
Mitigación: mantener prohibido el linking automático por email.

### Riesgo: dejar la cuenta inutilizable
Mitigación: regla explícita de método de acceso viable antes de unlink.

### Riesgo: operaciones sensibles sin prueba fresca de identidad
Mitigación: reautenticación fuerte reciente obligatoria.

## Recomendación final
La mejor evolución para este backend es ampliar `oauth` con un flujo separado de linking/unlinking, apoyado en `oauth_states` con propósito explícito y en las mismas garantías de reautenticación fuerte que ya protegen otras acciones sensibles. Eso mantiene la arquitectura sobria, reutiliza piezas existentes y evita el error bastante infantil de mezclar “entrar al sistema” con “administrar métodos de acceso”.
