# 🔌 Plugin Rules — Microfinance API

---

## Registered Plugins (Exact Order)

> ⚠️ **Plugin registration order matters in Fastify.** Plugins registered earlier are available to later plugins and routes.

| #  | Plugin                  | File                        | Purpose                                    | Dependencies         |
| -- | ----------------------- | --------------------------- | ------------------------------------------ | -------------------- |
| 1  | `@fastify/env`          | (built-in, registered in app.js) | Validate env vars → `fastify.config.*` | None (must be first) |
| 2  | `jwtPlugin`             | `plugins/jwt.js`            | JWT verify + `authenticate`/`authorize` decorators | @fastify/env (for JWT_SECRET) |
| 3  | `requestLoggerPlugin`   | `plugins/requestLogger.js`  | Console logging of requests (METHOD /path STATUS TIME) | None               |
| 4  | `corsPlugin`            | `plugins/cors.js`           | CORS configuration via @fastify/cors       | None                 |
| 5  | `swaggerPlugin`         | `plugins/swagger.js`        | OpenAPI spec + Swagger UI at /documentation | None                 |
| 6  | `prismaPlugin`          | `plugins/prisma.js`         | Prisma client → `fastify.prisma`           | @fastify/env (for NODE_ENV) |
| 7  | `@fastify/multipart`    | (built-in, registered in app.js) | Multipart form data / file uploads     | None                 |
| 8  | `globalErrorHandler`    | `middleware/errorHandler.js` | `setErrorHandler` — catches all errors    | None                 |
| 9  | `notFoundHandler`       | `middleware/errorHandler.js` | `setNotFoundHandler` — 404 responses      | None (must be last)  |

### Not Registered (Installed but Unused)

| Package                | Installed Version | Status                          |
| ---------------------- | ----------------- | ------------------------------- |
| `@fastify/cookie`      | ^11.0.2           | ❌ Not registered in app.js      |
| `@fastify/rate-limit`  | ^10.3.0           | ❌ Not registered in app.js      |
| `@fastify/static`      | ^9.1.3            | ❌ Not registered in app.js      |
| `fastify-axios`        | ^1.4.2            | ❌ Not registered in app.js      |
| `fastify-nodemailer`   | ^5.0.0            | ❌ Not registered in app.js      |

---

## Plugin Details

### 1. @fastify/env
- **Registered in**: `app.js` (line 65-68)
- **Schema**: `config/env.schema.js`
- **Provides**: `fastify.config.*` — validated environment variables
- **Required vars**: `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`
- **⚠️ Must be registered FIRST** — all other plugins and routes may depend on `fastify.config`

### 2. jwtPlugin (custom)
- **File**: `plugins/jwt.js`
- **Wraps**: `@fastify/jwt`
- **Provides**:
  - `fastify.jwt` — JWT instance (sign, verify, decode)
  - `fastify.authenticate` — preHandler that calls `request.jwtVerify()`
  - `fastify.authorize(roles)` — preHandler factory for role-based access
- **⚠️ Currently reads `process.env.JWT_SECRET` directly** — should use `fastify.config.JWT_SECRET`
- **DO NOT MODIFY** — Core auth plugin. Changes here affect all protected routes.

### 3. requestLoggerPlugin (custom)
- **File**: `plugins/requestLogger.js`
- **Hooks**: `onRequest` (start timer) + `onResponse` (log request)
- **Output format**: `INFO: METHOD /path - STATUS - TIMEms`
- **Uses**: `console.log` with ANSI color codes
- **⚠️ Known debt**: Should use `fastify.log` instead of `console.log`

### 4. corsPlugin (custom)
- **File**: `plugins/cors.js`
- **Wraps**: `@fastify/cors`
- **Config**: All origins allowed, credentials enabled, standard methods
- **DO NOT MODIFY** for development. Tighten CORS origins before production.

### 5. swaggerPlugin (custom)
- **File**: `plugins/swagger.js`
- **Wraps**: `@fastify/swagger` + `@fastify/swagger-ui`
- **Endpoint**: `/documentation`
- **⚠️ Known issue**: `host` is hardcoded to `'localhost:3000'`

### 6. prismaPlugin (custom)
- **File**: `plugins/prisma.js`
- **Provides**: `fastify.prisma` — PrismaClient instance
- **Lifecycle**: Connects on registration, disconnects on `onClose` hook
- **Logging**: Full query logging in development, warn+error only in production
- **DO NOT MODIFY** — Core database plugin. Changes here affect all database operations.

### 7. @fastify/multipart
- **Registered in**: `app.js` (line 75)
- **Purpose**: Enables `request.file()` for file uploads
- **Used by**: `routes/attachments/index.js`

---

## Plugins That Must NOT Be Modified

These are core infrastructure plugins. Do not modify without updating documentation:

| Plugin          | Reason                                                |
| --------------- | ----------------------------------------------------- |
| `jwtPlugin`     | Auth mechanism — all protected routes depend on it    |
| `prismaPlugin`  | Database connection — all queries depend on it        |
| `errorHandler`  | Error format contract — frontend depends on shape     |

---

## How to Add a New Plugin

### Step-by-step:

1. **Check if a Fastify ecosystem package exists** for your need (see `docs/rules/backend.md`)

2. **Create the plugin file** in `plugins/`:
   ```javascript
   // plugins/myNewPlugin.js
   import fp from "fastify-plugin";

   async function myNewPlugin(fastify, options) {
     // Plugin logic here
     fastify.decorate("myFeature", someValue);
   }

   export default fp(myNewPlugin, {
     name: "my-new-plugin",
   });
   ```

3. **Register in `app.js`** — insert at the correct position based on dependencies:
   ```javascript
   import myNewPlugin from "./plugins/myNewPlugin.js";
   // ...
   await fastify.register(myNewPlugin);
   ```

4. **Update this file** (`docs/rules/plugins.md`) — add the plugin to the registration table

5. **Update `AGENTS.md`** — add to the folder structure and tech stack if a new package was installed

6. **Update `docs/rules/backend.md`** — if a new non-Fastify package was added, document the reason

### Registration Order Guidelines:
- **Infrastructure plugins** (env, jwt, prisma) → register first
- **Cross-cutting plugins** (cors, logger, swagger) → register in the middle
- **Feature plugins** (mailer, cron) → register before routes
- **Error handlers** → register after plugins, before routes
- **Routes** → register last
- **404 handler** → register very last

---

## Plugin Encapsulation

All custom plugins use `fastify-plugin` (`fp`) wrapper, which means:
- Decorators (`fastify.authenticate`, `fastify.prisma`) are available to ALL routes and plugins
- Hooks added in plugins affect ALL routes
- If you need a plugin scoped to a specific route prefix, do NOT wrap with `fp`
