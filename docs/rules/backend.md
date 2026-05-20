# ⚙️ Backend Rules — Microfinance API

---

## 📦 Package Rule

> **Use Fastify ecosystem (`@fastify/*`) packages FIRST.**
> Only use non-Fastify packages if the Fastify ecosystem has no equivalent.
> Document every non-Fastify package with a reason in this file.

### Currently Installed Non-Fastify Packages (with justification)

| Package                  | Reason                                              |
| ------------------------ | --------------------------------------------------- |
| `@prisma/client`         | No Fastify-native ORM exists                        |
| `@aws-sdk/client-s3`     | AWS SDK — no Fastify wrapper for S3                 |
| `@aws-sdk/lib-storage`   | AWS SDK multipart upload — no Fastify equiv          |
| `ajv-errors`             | AJV plugin for custom errors — used by Fastify's AJV|
| `bcryptjs`               | Password hashing — no Fastify equiv                 |
| `crypto-js`              | Encryption — no Fastify equiv (⚠️ currently unused) |
| `date-fns`               | Date math — no Fastify equiv                        |
| `fastify-axios`          | HTTP client — community Fastify plugin (⚠️ unused)  |
| `fastify-nodemailer`     | Email — community Fastify plugin (⚠️ unused)        |
| `firebase-admin`         | Push notifications — no Fastify equiv (⚠️ unused)   |
| `jsonwebtoken`           | JWT signing — used alongside @fastify/jwt            |
| `lru-cache`              | In-memory cache — no Fastify equiv (⚠️ unused)      |
| `node-cron`              | Scheduled tasks — no Fastify equiv (⚠️ unused)      |
| `pino-pretty`            | Log formatting — Pino ecosystem                     |
| `xlsx`                   | Excel file generation — no Fastify equiv (⚠️ unused)|

> ⚠️ Packages marked as "unused" are installed but have no imports/usage in the codebase. Consider removing them or implementing the intended features.

---

## 🛣 Route Handler Pattern

Every route file follows this pattern:

```javascript
// routes/<feature>/index.js
import { createBadRequestError, createNotFoundError } from "../../utils/errors.js";

export default async function featureRoutes(fastify, opts) {
  // 1. Module-level auth (if all routes need auth)
  fastify.addHook("preHandler", fastify.authenticate);

  // 2. Define routes with inline schema
  fastify.get("/", {
    schema: {
      query: {
        type: "object",
        properties: {
          page: { type: "number", default: 1 },
          limit: { type: "number", default: 10 },
          search: { type: "string" },
        },
      },
    },
    // 3. Optional: per-route role authorization
    preHandler: fastify.authorize(["ADMIN", "BRANCH_MANAGER"]),

    // 4. Handler with Prisma queries
    handler: async (request, reply) => {
      const { page, limit, search } = request.query;
      const skip = (page - 1) * limit;

      const [items, total] = await Promise.all([
        fastify.prisma.model.findMany({ where: {}, skip, take: limit }),
        fastify.prisma.model.count({ where: {} }),
      ]);

      // 5. Standard response format
      return {
        success: true,
        items,
        pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
      };
    },
  });
}
```

---

## 📋 Schema-First Rule

**Every route MUST have request schemas defined.**

```javascript
fastify.post("/", {
  schema: {
    // Body schema (for POST/PUT/PATCH)
    body: {
      type: "object",
      required: ["name", "email"],
      properties: {
        name: { type: "string", minLength: 3 },
        email: { type: "string", format: "email" },
      },
      // Custom error messages (ajv-errors)
      errorMessage: {
        required: {
          name: "Name is required",
          email: "Email is required",
        },
        properties: {
          name: "Name must be at least 3 characters",
          email: "Invalid email format",
        },
      },
    },
    // Params schema (for /:id routes)
    params: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" } },
    },
    // Query schema (for GET with filters)
    query: {
      type: "object",
      properties: {
        page: { type: "number", default: 1 },
        limit: { type: "number", default: 10 },
      },
    },
  },
  handler: async (request, reply) => { ... }
});
```

---

## ❌ Error Throwing Pattern

This project uses **custom AppError** (not Fastify's `httpErrors`):

```javascript
// Import from utils/errors.js
import { 
  createAppError, 
  createBadRequestError, 
  createUnauthorizedError, 
  createForbiddenError, 
  createNotFoundError 
} from "../../utils/errors.js";

// Usage in handlers
throw createBadRequestError("Email already in use");
throw createBadRequestError("Validation error", { field: "message" }); // With field-level errors
throw createNotFoundError("Client not found");
throw createUnauthorizedError("Invalid credentials");
throw createForbiddenError("Not allowed");
throw createAppError("Custom error message", 422);
```

**DO NOT** use:
- `reply.code(400).send({ ... })` for errors — throw instead, let the global handler catch
- `new Error("...")` without wrapping in AppError
- `fastify.httpErrors.*` (not used in this project)

---

## 🔌 Plugin Authoring Pattern

Custom plugins use `fastify-plugin` wrapper:

```javascript
import fp from "fastify-plugin";

async function myPlugin(fastify, options) {
  // Register sub-plugins
  await fastify.register(somePackage, { ...config });

  // Decorate fastify instance
  fastify.decorate("myDecorator", someValue);

  // Add hooks
  fastify.addHook("onClose", async (instance) => {
    // Cleanup
  });
}

export default fp(myPlugin, {
  name: "my-plugin",          // Optional: plugin name
  dependencies: ["other-plugin"], // Optional: dependencies
});
```

> **Use `fp()` wrapper** to break Fastify's encapsulation so decorators and hooks are available to sibling plugins and routes.

---

## 🪝 Hooks Usage

| Hook          | Current Usage                          | When to Use                    |
| ------------- | -------------------------------------- | ------------------------------ |
| `onRequest`   | requestLogger (start timer)            | Timing, early request logging  |
| `preHandler`  | authenticate, authorize                | Auth checks before handler     |
| `onResponse`  | requestLogger (log method/status/time) | Response logging, metrics      |
| `onClose`     | Prisma disconnect, cleanup             | Resource cleanup on shutdown   |

---

## 📤 Response Format Standard

### Success Responses

```javascript
// Single resource
{ success: true, user: { ... } }

// List with pagination
{
  success: true,
  users: [...],
  pagination: {
    total: 100,
    page: 1,
    limit: 10,
    totalPages: 10,
  },
}

// Action result
{ success: true, message: "User deleted successfully" }
```

### Error Responses

```javascript
// Validation error (from AJV)
{
  success: false,
  error: "Validation error",
  fields: { email: "Invalid email format" },
  statusCode: 400,
}

// Business logic error
{
  success: false,
  error: "Email already in use",
  statusCode: 400,
}

// Auth error
{
  success: false,
  error: "Unauthorized",
  statusCode: 401,
}

// Not found
{
  success: false,
  error: "Client not found",
  statusCode: 404,
}
```
