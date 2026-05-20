# 📊 Project State — Microfinance API

---

## 🗓 Current Phase

**Phase**: Active Development — Core features implemented, system stabilization in progress.

---

## ✅ Feature Completion Status

| Feature                    | Status          | Notes                                                     |
| -------------------------- | --------------- | --------------------------------------------------------- |
| Auth (Login/Register)      | ✅ Done          | JWT access + refresh tokens, register, login, /me         |
| User Management            | ✅ Done          | CRUD, status toggle, password reset                       |
| Client Management          | ✅ Done          | CRUD, soft delete, profile images, NIC validation         |
| Group Management           | ✅ Done          | CRUD, member management, leader assignment                |
| Loan Management            | ✅ Done          | Create, approve, reject, instalment generation            |
| Loan Guarantors            | ✅ Done          | Create/update/delete guarantors with documents            |
| Collection System          | ✅ Done          | Submit, approve, reject, payment allocation               |
| Daily Collection Registry  | ✅ Done          | Daily view with expected/collected/arrears per loan       |
| Non-Collection Weeks       | ✅ Done          | Create/update/delete with instalment auto-shifting        |
| Settings                   | ✅ Done          | System-wide settings (loan weeks, late flags)             |
| Branches                   | ✅ Done          | CRUD with audit logging                                   |
| Audit Logging              | ✅ Done          | All CUD operations logged with user + details             |
| Dashboard Stats            | ✅ Done          | Group/client counts, outstanding, collection rate, chart  |
| File Attachments           | ✅ Done          | S3/MinIO upload + delete, linked to clients/guarantors    |
| Mortgage Loans             | ✅ Done          | Client-bound collateral loans, automatic LTV calculation, S3 attachments, full listing dashboard and details viewer |
| Health Check               | ✅ Done          | DB latency, system info, uptime                           |
| Swagger Documentation      | ✅ Done          | Auto-generated at /documentation                          |
| Rate Limiting              | 🟡 Partial      | Package installed but NOT registered in app.js            |
| Email Notifications        | 🟡 Partial      | `fastify-nodemailer` installed but no usage found         |
| Firebase Push Notifications| 🟡 Partial      | `firebase-admin` installed but no usage found             |
| Cron Jobs                  | 🟡 Partial      | `node-cron` installed but no usage found                  |
| Caching                    | 🟡 Partial      | `lru-cache` installed but no usage found                  |
| Excel Export               | 🟡 Partial      | `xlsx` installed but no usage found                       |
| HTTP Client                | 🟡 Partial      | `fastify-axios` installed but no usage found              |

---

## 🔴 Gap & Bug List

### 🔒 Security Gaps

- [x] ~~**GAP: Settings routes have NO authentication** — `GET /api/settings` and `PUT /api/settings` are completely unprotected.~~ **FIXED**: Added `fastify.addHook("preHandler", fastify.authenticate)` to settings routes.
- [x] ~~**GAP: Non-collection-weeks routes have NO authentication** — All 4 endpoints are unprotected.~~ **FIXED**: Added `fastify.addHook("preHandler", fastify.authenticate)` to non-collection-weeks routes.
- [x] ~~**GAP: User routes have NO authentication** — All user management routes are unprotected.~~ **FIXED**: Added `fastify.addHook("preHandler", fastify.authenticate)` to user routes.
- [x] ~~**GAP: Attachment routes have NO authentication** — Upload and delete are unprotected.~~ **FIXED**: Added `fastify.addHook("preHandler", fastify.authenticate)` to attachment routes.
- [ ] **GAP: Registration endpoint has NO role restriction** — `POST /api/auth/register` is public and allows creating users with ANY role including ADMIN. Should require admin auth or restrict to a default role.
- [ ] **GAP: JWT secret has hardcoded fallback** — `plugins/jwt.js` line 7 uses `process.env.JWT_SECRET || "super-secret-key-change-me"`. If env var is missing, the fallback is a known string. The env schema requires `JWT_SECRET` but the plugin bypasses the config.
- [ ] **GAP: No RBAC on loan approve/reject** — `PUT /api/loans/:id/approve` and `PUT /api/loans/:id/reject` have no role check. Any authenticated user can approve/reject loans.
- [ ] **GAP: No RBAC on generic loan status update** — `PATCH /api/loans/:id/status` has no role check. Any authenticated user can change loan status to any value.
- [ ] **GAP: Collection approve/reject uses inline role check** — Should use `fastify.authorize()` decorator instead of manual `allowedRoles.includes()` for consistency.
- [ ] **GAP: Collection role check includes "APPROVED" as a role** — Line 284 in `collections/index.js` has `["ADMIN", "BRANCH_MANAGER", "APPROVER", "APPROVED"]` — "APPROVED" is not a valid role, likely a typo.
- [ ] **GAP: `@fastify/rate-limit` installed but never registered** — Rate limiting is not active.

### 🐛 Bugs

- [ ] **BUG: `process.env` used directly in plugins instead of `fastify.config`** — `plugins/jwt.js` (line 7), `utils/s3Client.js` (lines 7-13), `utils/tokens.js` (lines 10, 14, 22, 26) all bypass the @fastify/env config system.
- [ ] **BUG: Refresh token upsert logic is wrong** — In `auth/index.js` login handler, `upsert` uses the NEW refresh token as the `where` clause, which will never match (it's just been generated). This creates a new record every login instead of replacing the old one.
- [ ] **BUG: `RATE_LIMIT_TIME_WINDOW` schema type mismatch** — `env.schema.js` defines it as `string` type but the .env.example has it as a number (`60000`). The env plugin will coerce it, but the intent appears to be numeric.
- [ ] **BUG: Attachment file size always 0** — `attachments/index.js` line 27: `fileSize: 0` with comment "Stream doesn't provide size easily". File size metadata is never recorded.
- [ ] **BUG: No validation on `createdBy` field** — `loans/index.js` accepts `createdBy` from the request body instead of using `request.user.id`. Client can spoof the creator.
- [ ] **BUG: Group create accepts `createdBy` from body** — Same issue — `groups/index.js` accepts `createdBy` from request body instead of using `request.user.id`.

### 🟡 Missing Features / Validation

- [ ] **MISSING: Response schemas** — No route defines a response schema. Only request schemas (body, params, query) are defined.
- [ ] **MISSING: No input validation on `PATCH /api/loans/:id/status`** — The `status` field accepts any string. Should validate against `LoanStatus` enum.
- [ ] **MISSING: No logout endpoint** — No way to invalidate refresh tokens on logout.
- [ ] **MISSING: No `lastLogin` update** — `User.lastLogin` field exists in schema but is never updated on login.
- [ ] **MISSING: Pagination on collections history** — `GET /api/collections` returns ALL collections without pagination.
- [ ] **MISSING: Pagination on non-collection-weeks** — `GET /api/non-collection-weeks` returns ALL records without pagination.
- [ ] **MISSING: Pagination on branches** — `GET /api/branches` returns ALL records without pagination.
- [ ] **MISSING: No search/filter on attachment routes** — No way to list attachments with filters.
- [ ] **MISSING: No `updatedBy` tracking in groups** — `updatedBy` is accepted from request body instead of being auto-set from `request.user.id`.

### 🔧 Technical Debt

- [ ] **DEBT: Dual JWT libraries** — Both `@fastify/jwt` and `jsonwebtoken` are installed. Token generation uses `jsonwebtoken` while verification uses `@fastify/jwt`. Could be consolidated.
- [ ] **DEBT: Unused packages** — `@fastify/cookie`, `@fastify/rate-limit`, `@fastify/static`, `fastify-axios`, `fastify-nodemailer`, `firebase-admin`, `node-cron`, `lru-cache`, `xlsx`, `crypto-js` are installed but have no usage in the codebase.
- [ ] **DEBT: requestLogger uses `console.log`** — Should use `fastify.log` for consistency with Pino transport.
- [ ] **DEBT: No test suite** — No unit tests, integration tests, or test framework configured.
- [ ] **DEBT: No Docker configuration** — No Dockerfile or docker-compose.yml for containerized deployment.
- [ ] **DEBT: Swagger host is hardcoded** — `plugins/swagger.js` hardcodes `host: 'localhost:3000'` instead of reading from config.

---

## 🏛 Architectural Decisions

| Decision                  | Choice             | Rationale                                            |
| ------------------------- | ------------------ | ---------------------------------------------------- |
| Framework                 | Fastify 5          | High performance, built-in validation, plugin system |
| ORM                       | Prisma 6           | Type-safe queries, auto-generated client, migrations |
| Database                  | MySQL              | Production-ready relational DB for financial data    |
| Auth                      | JWT (access+refresh)| Stateless auth with token rotation                  |
| File Storage              | S3/MinIO           | Self-hosted object storage compatible with AWS S3 API|
| Schema Validation         | AJV (built-in)     | Fastify's default, with ajv-errors for custom messages|
| Error Handling            | AppError pattern   | Consistent error factory functions with field-level errors |
| Logging                   | Pino               | Fastify's built-in logger, file-based transports     |
| Module System             | ES Modules         | Modern JavaScript, `"type": "module"` in package.json|
| ID Generation             | cuid               | Prisma default, collision-resistant unique IDs        |
| Soft Delete               | `isDeleted` flag   | Preserves data integrity for financial records        |

---

## 📌 Known Tech Debt Summary

1. No test coverage
2. No Docker support
3. Multiple unused dependencies
4. Dual JWT library usage
5. Direct `process.env` access bypassing config
6. Missing response schemas on all routes
7. No rate limiting despite package being installed
8. Hardcoded values in swagger plugin
9. No CI/CD pipeline
10. No database migration history (using `db push` only)
