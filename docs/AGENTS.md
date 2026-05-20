# 🏦 Microfinance API — AI Workspace Context

> **This file is the master entry point for all AI coding agents.**
> Read this file FIRST before making any changes to this codebase.

---

## 📌 Project Overview

| Field          | Value                                            |
| -------------- | ------------------------------------------------ |
| **Name**       | microfinance-api                                 |
| **Purpose**    | Backend REST API for a microfinance loan management system (clients, groups, loans, collections, branches) |
| **Version**    | 1.0.0                                            |
| **Runtime**    | Node.js (ES Modules)                             |
| **Framework**  | Fastify 5.8.5                                    |
| **ORM**        | Prisma 6.19.1 (MySQL)                            |
| **Auth**       | @fastify/jwt 10.0.0 + jsonwebtoken 9.0.3         |
| **Language**   | JavaScript (ESM, `"type": "module"`)             |
| **Entry**      | `server.js` → `app.js` (buildApp)                |

---

## 📂 Documentation Map

| File                                     | Covers                                     |
| ---------------------------------------- | ------------------------------------------ |
| `docs/ARCHITECTURE.md`                   | Folder structure, request lifecycle, patterns |
| `docs/AUTH.md`                           | JWT strategy, auth flow, route protection  |
| `docs/PROJECT_STATE.md`                  | Feature status, gap list, tech debt        |
| `docs/rules/general.md`                  | TypeScript/JS strictness, env, logging     |
| `docs/rules/backend.md`                  | Fastify patterns, schemas, error handling  |
| `docs/rules/database.md`                 | Prisma ORM patterns, queries, migrations   |
| `docs/rules/plugins.md`                  | Plugin registry, order, authoring guide    |

---

## 🛠 Tech Stack (Exact Versions from package.json)

### Fastify Ecosystem
| Package                  | Version   | Purpose                        |
| ------------------------ | --------- | ------------------------------ |
| `fastify`                | ^5.8.5    | Core framework                 |
| `@fastify/cookie`        | ^11.0.2   | Cookie support                 |
| `@fastify/cors`          | ^11.2.0   | CORS configuration             |
| `@fastify/env`           | ^6.0.0    | Environment variable validation|
| `@fastify/jwt`           | ^10.0.0   | JWT authentication             |
| `@fastify/multipart`     | ^10.0.0   | File upload (multipart)        |
| `@fastify/rate-limit`    | ^10.3.0   | Rate limiting                  |
| `@fastify/static`        | ^9.1.3    | Static file serving            |
| `@fastify/swagger`       | ^9.7.0    | OpenAPI spec generation        |
| `@fastify/swagger-ui`    | ^5.2.6    | Swagger UI                     |
| `fastify-plugin`         | ^5.1.0    | Plugin wrapper utility         |

### Third-Party (Non-Fastify)
| Package                  | Version   | Purpose                        | Reason for non-Fastify       |
| ------------------------ | --------- | ------------------------------ | ---------------------------- |
| `@prisma/client`         | ^6.19.1   | Database ORM                   | No Fastify equivalent ORM   |
| `@aws-sdk/client-s3`     | ^3.1047.0 | S3/MinIO file storage          | AWS SDK, no Fastify equiv    |
| `@aws-sdk/lib-storage`   | ^3.1047.0 | S3 multipart upload            | AWS SDK, no Fastify equiv    |
| `ajv-errors`             | ^3.0.0    | Custom AJV error messages      | AJV plugin, Fastify uses AJV |
| `bcryptjs`               | ^3.0.3    | Password hashing               | No Fastify equiv             |
| `crypto-js`              | ^4.2.0    | Encryption utilities           | No Fastify equiv             |
| `date-fns`               | ^4.1.0    | Date manipulation              | No Fastify equiv             |
| `fastify-axios`          | ^1.4.2    | HTTP client decorator          | Community Fastify plugin     |
| `fastify-nodemailer`     | ^5.0.0    | Email sending                  | Community Fastify plugin     |
| `firebase-admin`         | ^13.9.0   | Firebase push notifications    | No Fastify equiv             |
| `jsonwebtoken`           | ^9.0.3    | Manual JWT sign/verify tokens  | Used alongside @fastify/jwt  |
| `lru-cache`              | ^11.3.6   | In-memory caching              | No Fastify equiv             |
| `node-cron`              | ^4.2.1    | Scheduled tasks                | No Fastify equiv             |
| `pino-pretty`            | ^13.1.3   | Log formatting                 | Pino ecosystem (Fastify uses Pino) |
| `xlsx`                   | ^0.18.5   | Excel file generation          | No Fastify equiv             |

### Dev Dependencies
| Package      | Version   | Purpose              |
| ------------ | --------- | -------------------- |
| `nodemon`    | ^3.1.14   | Auto-restart on save |
| `prisma`     | ^6.19.1   | Prisma CLI           |

---

## 📁 Folder Structure

```
microfinance-api/
├── app.js                         # App builder (plugin registration, routes, error handlers)
├── server.js                      # Server entry point (listen, graceful shutdown)
├── package.json
├── .env / .env.example
├── .gitignore
├── AGENTS.md                      # ← YOU ARE HERE (AI context master file)
├── config/
│   └── env.schema.js              # @fastify/env schema (required env vars)
├── middleware/
│   └── errorHandler.js            # Global error handler + 404 handler
├── plugins/
│   ├── cors.js                    # CORS configuration plugin
│   ├── jwt.js                     # JWT auth + authenticate/authorize decorators
│   ├── prisma.js                  # Prisma client plugin (decorator)
│   ├── requestLogger.js           # Custom request logger (onRequest/onResponse hooks)
│   └── swagger.js                 # Swagger/OpenAPI + Swagger UI plugin
├── prisma/
│   ├── schema.prisma              # Database schema (20 models, 6 enums)
│   └── seed.js                    # Seed script (admin user, default branch, settings)
├── routes/
│   ├── attachments/index.js       # File upload/delete (S3/MinIO)
│   ├── audit/index.js             # Audit log viewer
│   ├── auth/index.js              # Register, Login, Refresh, Me
│   ├── branches/index.js          # Branch CRUD
│   ├── clients/index.js           # Client CRUD + documents
│   ├── collections/index.js       # Collection lifecycle + daily registry
│   ├── dashboard/index.js         # Dashboard statistics
│   ├── groups/index.js            # Group CRUD + members + collection sheet
│   ├── loans/index.js             # Loan lifecycle + instalments + guarantors
│   ├── non-collection-weeks/index.js  # Non-collection week management
│   ├── settings/index.js          # System settings CRUD
│   └── users/index.js             # User management
├── utils/
│   ├── errors.js                  # Error factory functions (AppError)
│   ├── s3Client.js                # S3/MinIO upload/delete helpers
│   ├── systemInfo.js              # System info for health endpoint
│   └── tokens.js                  # JWT token generation/verification
├── logs/                          # Runtime log files (gitignored)
├── docs/                          # Architecture & rules documentation
│   ├── ARCHITECTURE.md
│   ├── AUTH.md
│   ├── PROJECT_STATE.md
│   └── rules/
│       ├── general.md
│       ├── backend.md
│       ├── database.md
│       └── plugins.md
└── scratch/                       # Temporary scripts
```

---

## 🔟 Critical Rules — Top 10 Dos and Don'ts

### ✅ DO
1. **Use `fastify.authenticate` preHandler** on every route unless explicitly public
2. **Use Fastify ecosystem packages first** — only use third-party if no @fastify/* equivalent exists
3. **Define JSON Schema** for every route's body, params, and query
4. **Use `createAppError` / `createBadRequestError`** from `utils/errors.js` for all errors
5. **Write audit logs** for all create/update/delete operations via `fastify.prisma.auditLog.create()`

### 🚫 DON'T
6. **Never use `console.log`** in production handlers — use `fastify.log` or `request.log`
7. **Never access `process.env` directly in route handlers** — use `fastify.config.*` (from @fastify/env)
8. **Never query DB for current user data** if it's available in `request.user` (JWT payload: `id`, `email`, `role`)
9. **Never change the folder structure** — document what exists, add new files to existing folders
10. **Never skip schema validation** — every route MUST have request/response schemas

---

## ⚠️ Source of Truth

> **Architecture files are source of truth** — do not change folder structure, do not add new patterns without updating these docs.
>
> Before introducing a new pattern, utility, or package:
> 1. Check if the pattern already exists in `docs/ARCHITECTURE.md`
> 2. Check if a Fastify equivalent exists in `docs/rules/backend.md`
> 3. Update the relevant doc file AFTER introducing any change

---

## ✅ Task Completion Protocol

After completing ANY task in this project:

1. **Update `docs/PROJECT_STATE.md`** → mark relevant item done
2. **If new pattern introduced** → update `docs/ARCHITECTURE.md` or relevant rules file
3. **If new package installed** → update `docs/rules/backend.md` package list AND this file's tech stack table
4. **If new route added** → update `docs/AUTH.md` route list
5. **If bug fixed** → strike through in `docs/PROJECT_STATE.md` gap list

---

## 🧭 How to Read This Workspace (Guide for AI Agents)

1. **Start here** — Read this `AGENTS.md` file to understand the project overview, tech stack, and rules
2. **Before coding a feature** — Read `docs/ARCHITECTURE.md` for patterns and `docs/AUTH.md` for auth requirements
3. **Before a database change** — Read `docs/rules/database.md` and `prisma/schema.prisma`
4. **Before adding a package** — Read `docs/rules/backend.md` to check if Fastify equivalent exists
5. **After completing work** — Follow the Task Completion Protocol above
6. **If unsure about a pattern** — Check `docs/rules/` folder for the relevant domain rules
