# 🔐 Authentication & Authorization — Microfinance API

---

## JWT Library

| Component           | Package           | Version  | Purpose                        |
| ------------------- | ----------------- | -------- | ------------------------------ |
| JWT Verification    | `@fastify/jwt`    | ^10.0.0  | `request.jwtVerify()` in authenticate decorator |
| Token Generation    | `jsonwebtoken`    | ^9.0.3   | Manual `jwt.sign()` for access + refresh tokens |

> ⚠️ **Note**: Two JWT libraries are in use. `@fastify/jwt` handles verification via Fastify decorator; `jsonwebtoken` handles manual token signing in `utils/tokens.js`. This is a known pattern — see gap list for consolidation recommendation.

---

## Token Strategy

| Token         | TTL    | Secret Env Var       | Signing Library |
| ------------- | ------ | -------------------- | --------------- |
| Access Token  | 15 min | `JWT_SECRET`         | `jsonwebtoken`  |
| Refresh Token | 7 days | `JWT_REFRESH_SECRET` | `jsonwebtoken`  |

### Token Storage
- **Access Token**: Returned in JSON response body; client sends via `Authorization: Bearer <token>` header
- **Refresh Token**: Returned in JSON response body; stored in `refresh_tokens` DB table; client sends in request body to `/api/auth/refresh`
- **Cookies**: `@fastify/cookie` is installed but cookies are NOT currently used for token transport. Swagger config references `cookieAuth` but actual implementation uses Bearer header.

---

## JWT Payload Shape

```javascript
// Generated in utils/tokens.js → generateTokens()
{
  id: user.id,       // String (cuid)
  email: user.email,  // String
  role: user.role     // Enum: "ADMIN" | "BRANCH_MANAGER" | "LOAN_OFFICER" | "COLLECTION_OFFICER" | "APPROVER" | "AUDITOR"
}
```

### Accessing User Data in Routes

```javascript
// After fastify.authenticate runs, user data is available on request:
request.user.id     // User's cuid
request.user.email  // User's email
request.user.role   // User's role enum
```

> **RULE**: Never query the database for `user.id`, `user.email`, or `user.role` if the data is available in `request.user`. Only query DB when you need additional fields not in the JWT payload (e.g., `branchId`, `fullname`, `status`).

---

## Authentication Mechanism

### `fastify.authenticate` (Decorator)
Defined in `plugins/jwt.js`. This is a **preHandler** function that:
1. Calls `request.jwtVerify()` from `@fastify/jwt`
2. On success: populates `request.user` with the decoded JWT payload
3. On expired token: throws `{ statusCode: 401, message: "TOKEN_EXPIRED" }`
4. On invalid token: throws `createUnauthorizedError()`

### `fastify.authorize(roles)` (Decorator)
Defined in `plugins/jwt.js`. This is a **preHandler factory** that:
1. Checks if `request.user` exists (must run after `authenticate`)
2. Checks if `request.user.role` is in the `allowedRoles` array
3. Throws `createForbiddenError()` if role doesn't match

### Usage Patterns

```javascript
// Pattern 1: Protect ALL routes in a module
export default async function someRoutes(fastify, opts) {
  fastify.addHook("preHandler", fastify.authenticate);
  // All routes below are protected
}

// Pattern 2: Protect a specific route
fastify.get("/me", {
  preHandler: [fastify.authenticate]
}, handler);

// Pattern 3: Authenticate + Role check
fastify.post("/", {
  preHandler: [fastify.authenticate, fastify.authorize(["ADMIN", "BRANCH_MANAGER"])],
  handler: ...
});

// Pattern 4: Role check only (module-level auth already applied)
fastify.post("/", {
  preHandler: fastify.authorize(["ADMIN", "BRANCH_MANAGER", "LOAN_OFFICER"]),
  handler: ...
});
```

---

## Role / Permission System

### Roles (from Prisma enum)

| Role                 | Description                           |
| -------------------- | ------------------------------------- |
| `ADMIN`              | Full system access                    |
| `BRANCH_MANAGER`     | Branch-level management               |
| `LOAN_OFFICER`       | Loan and client management            |
| `COLLECTION_OFFICER` | Collection data entry                 |
| `APPROVER`           | Approves loans and collections        |
| `AUDITOR`            | Read-only audit access                |

### Per-Route Role Restrictions (Currently Implemented)

| Route                         | Allowed Roles                                  |
| ----------------------------- | ---------------------------------------------- |
| `POST /api/clients`           | ADMIN, BRANCH_MANAGER, LOAN_OFFICER            |
| `PUT /api/clients/:id`        | ADMIN, BRANCH_MANAGER, LOAN_OFFICER            |
| `DELETE /api/clients/:id`     | ADMIN, BRANCH_MANAGER, LOAN_OFFICER            |
| `PUT /api/loans/:id/schedule` | ADMIN, BRANCH_MANAGER, LOAN_OFFICER            |
| `POST /api/collections/:id/approve` | ADMIN, BRANCH_MANAGER, APPROVER (inline check) |
| `POST /api/collections/:id/reject`  | ADMIN, BRANCH_MANAGER, APPROVER (inline check) |
| `POST /api/branches`          | ADMIN                                          |
| `PUT /api/branches/:id`       | ADMIN                                          |
| `DELETE /api/branches/:id`    | ADMIN                                          |

---

## 🛡 Route Protection Audit

### ✅ Protected Routes (Auth Required)

| Prefix                        | Auth Method            | Notes                          |
| ----------------------------- | ---------------------- | ------------------------------ |
| `GET /api/auth/me`            | Per-route preHandler   | Individual route protection    |
| `/api/users/*`                | Module-level addHook   | All routes protected ✅ (fixed)|
| `/api/clients/*`              | Module-level addHook   | All routes protected           |
| `/api/groups/*`               | Module-level addHook   | All routes protected           |
| `/api/loans/*`                | Module-level addHook   | All routes protected           |
| `/api/collections/*`          | Module-level addHook   | All routes protected           |
| `/api/settings/*`             | Module-level addHook   | All routes protected ✅ (fixed)|
| `/api/non-collection-weeks/*` | Module-level addHook   | All routes protected ✅ (fixed)|
| `/api/attachments/*`          | Module-level addHook   | All routes protected ✅ (fixed)|
| `/api/audit/*`                | Module-level addHook   | All routes protected           |
| `/api/branches/*`             | Module-level addHook   | All routes protected           |
| `/api/dashboard/*`            | Module-level addHook   | All routes protected           |

### 🟡 PUBLIC Routes (Intentionally Unprotected)

| Route                         | Reason                                         |
| ----------------------------- | ---------------------------------------------- |
| `POST /api/auth/login`        | PUBLIC ROUTE — login endpoint                  |
| `POST /api/auth/register`     | PUBLIC ROUTE — registration endpoint           |
| `POST /api/auth/refresh`      | PUBLIC ROUTE — token refresh (uses refresh token) |
| `GET /api/health`             | PUBLIC ROUTE — health check endpoint           |
| `GET /`                       | PUBLIC ROUTE — API info endpoint               |
| `GET /documentation`          | PUBLIC ROUTE — Swagger UI                      |

### 🔴 Remaining Security Concerns (Not Route-Level)

| Issue                                  | Risk Level | Notes                             |
| -------------------------------------- | ---------- | --------------------------------- |
| `POST /api/auth/register`             | 🟡 MEDIUM  | Public — allows creating ANY role including ADMIN. Should require admin auth or restrict to default role. |
| `PUT /api/loans/:id/approve`          | 🟡 MEDIUM  | Auth ✅ but no RBAC — any authenticated user can approve loans |
| `PUT /api/loans/:id/reject`           | 🟡 MEDIUM  | Auth ✅ but no RBAC — any authenticated user can reject loans |
| `PATCH /api/loans/:id/status`         | 🟡 MEDIUM  | Auth ✅ but no RBAC — any authenticated user can change loan status |
| Collection approve/reject role check  | 🟡 LOW     | Uses inline check instead of `fastify.authorize()` — includes "APPROVED" typo |

---

## 🔄 Auth Flow Diagram

```
┌─────────┐       POST /api/auth/login          ┌──────────┐
│  Client  │ ──────────────────────────────────► │  Server  │
│          │  { email, password }                │          │
│          │                                     │          │
│          │  ◄──────────────────────────────── │          │
│          │  { accessToken, refreshToken, user } │          │
└────┬─────┘                                     └──────────┘
     │
     │  Stores tokens (localStorage/memory)
     │
     │  GET /api/clients
     │  Authorization: Bearer <accessToken>
     │  ──────────────────────────────────────►  ┌──────────┐
     │                                           │  Server  │
     │  ◄──────────────────────────────────────  │          │
     │  { success: true, clients: [...] }        │ JWT      │
     │                                           │ Verify   │
     │                                           └──────────┘
     │
     │  If 401 TOKEN_EXPIRED:
     │
     │  POST /api/auth/refresh
     │  { refreshToken }
     │  ──────────────────────────────────────►  ┌──────────┐
     │                                           │  Server  │
     │  ◄──────────────────────────────────────  │          │
     │  { accessToken, refreshToken }            │ Lookup   │
     │                                           │ refresh  │
     │  Store new tokens, retry original request │ in DB    │
     │                                           └──────────┘
```

---

## 📜 Rules

1. **Every route MUST be authenticated** unless explicitly marked with `// PUBLIC ROUTE — no auth required`
2. **Never query DB for user data** if it's available in JWT payload — always use `request.user` first
3. **Use `fastify.authenticate`** as preHandler, never write custom JWT verification logic
4. **Use `fastify.authorize(roles)`** for role-based access control
5. **Token generation** should only happen in `utils/tokens.js` — never sign JWTs inline
6. **Refresh tokens** must be stored in the `refresh_tokens` table and rotated on each refresh
