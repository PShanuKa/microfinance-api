# 🗄 Database Rules — Microfinance API

---

## ORM

| Field     | Value                |
| --------- | -------------------- |
| ORM       | Prisma               |
| Version   | 6.19.1 (client + CLI)|
| Database  | MySQL                |
| Schema    | `prisma/schema.prisma` |
| Seed      | `prisma/seed.js`     |

---

## Database Models (Current)

| Model                | Table Name             | Purpose                                    |
| -------------------- | ---------------------- | ------------------------------------------ |
| `User`               | `users`                | System users (admins, officers, etc.)      |
| `RefreshToken`       | `refresh_tokens`       | JWT refresh token storage                  |
| `Client`             | `clients`              | Microfinance clients/borrowers             |
| `Group`              | `groups`               | Client groups for collective loans         |
| `GroupMember`         | `group_members`        | Many-to-many: clients ↔ groups             |
| `Guarantor`          | `guarantors`           | Loan guarantors (per client, per loan)     |
| `Loan`               | `loans`                | Loan applications and lifecycle            |
| `Instalment`         | `instalments`          | Weekly payment schedule per client per loan|
| `Collection`         | `collections`          | Weekly collection submissions              |
| `CollectionItem`     | `collection_items`     | Per-instalment payment breakdown           |
| `CollectionAttachment`| `collection_attachments`| Attachments linked to collections         |
| `AuditLog`           | `audit_logs`           | Action audit trail                         |
| `Settings`           | `settings`             | System-wide configuration (singleton)      |
| `NonCollectionWeek`  | `non_collection_weeks` | Weeks with no collection (holidays, etc.)  |
| `Attachment`         | `attachments`          | File metadata (S3/MinIO references)        |
| `ClientDocument`     | `client_documents`     | Documents linked to clients                |
| `GuarantorDocument`  | `guarantor_documents`  | Documents linked to guarantors             |
| `Branch`             | `branches`             | Physical branch offices                    |
| `DBVersion`          | `db_versions`          | Database version tracking                  |

### Enums

| Enum              | Values                                                    |
| ----------------- | --------------------------------------------------------- |
| `Role`            | ADMIN, BRANCH_MANAGER, LOAN_OFFICER, COLLECTION_OFFICER, APPROVER, AUDITOR |
| `ClientStatus`    | ACTIVE, INACTIVE, BLACKLISTED                             |
| `LoanStatus`      | DRAFT, PENDING, APPROVED, ACTIVE, REJECTED, COMPLETED     |
| `PaymentStatus`   | UNPAID, PARTIAL, PAID, OVERDUE                            |
| `CollectionStatus`| SUBMITTED, APPROVED, REJECTED                             |

---

## Query Patterns

### Basic CRUD

```javascript
// Find unique
const user = await fastify.prisma.user.findUnique({ where: { id } });

// Find first (with condition)
const client = await fastify.prisma.client.findFirst({
  where: { nic },
});

// Find many with pagination
const [items, total] = await Promise.all([
  fastify.prisma.model.findMany({
    where: { ...filters },
    skip: (page - 1) * limit,
    take: limit,
    include: { relation: { select: { field: true } } },
    orderBy: { createdAt: "desc" },
  }),
  fastify.prisma.model.count({ where: { ...filters } }),
]);

// Create
const record = await fastify.prisma.model.create({
  data: { ...fields },
  include: { relation: true },
});

// Update
const updated = await fastify.prisma.model.update({
  where: { id },
  data: { ...fields },
});

// Delete
await fastify.prisma.model.delete({ where: { id } });

// Soft delete (clients pattern)
await fastify.prisma.client.update({
  where: { id },
  data: { isDeleted: true, updatedBy: request.user.id },
});

// Upsert
await fastify.prisma.settings.upsert({
  where: { id: "default" },
  update: data,
  create: { id: "default", ...data },
});
```

### Filter Patterns

```javascript
// Dynamic AND filters (the project's standard pattern)
const where = {
  AND: [
    search ? {
      OR: [
        { fullname: { contains: search } },
        { email: { contains: search } },
      ],
    } : {},
    status && status !== "All" ? { status } : {},
    branchId && branchId !== "All" ? { branchId } : {},
  ],
};
```

### Include / Select

```javascript
// Include related data
include: {
  group: {
    include: {
      members: {
        include: {
          client: { select: { fullname: true, phone: true } }
        }
      }
    }
  }
}

// Count relations
include: {
  _count: { select: { members: true } }
}

// Aggregate
await fastify.prisma.instalment.aggregate({
  where: { ... },
  _sum: { remainingDue: true, paidAmount: true },
});
```

---

## Raw SQL Policy

> **No raw SQL unless Prisma ORM cannot do it — and it must be documented.**

### Currently Approved Raw SQL Usage

| Location                     | Query                           | Reason                                      |
| ---------------------------- | ------------------------------- | ------------------------------------------- |
| `non-collection-weeks/index.js` | `UPDATE instalments SET dueDate = DATE_ADD(...)` | Bulk date shift — no Prisma equiv for `DATE_ADD` on all matching rows in one query |

If you need raw SQL:
1. Use `tx.$executeRaw` with tagged template literals (parameterized — SQL injection safe)
2. Document the reason in this table
3. Add a comment in the code explaining why Prisma can't do it

---

## Transaction Pattern

```javascript
// Wrap multi-step operations in a transaction
const result = await fastify.prisma.$transaction(async (tx) => {
  // Use `tx` instead of `fastify.prisma` inside the transaction
  const loan = await tx.loan.create({ data: { ... } });
  await tx.instalment.createMany({ data: instalments });
  await tx.auditLog.create({ data: { ... } });

  return { success: true, loan };
}, {
  maxWait: 5000,    // Optional: max wait for transaction slot
  timeout: 30000,   // Optional: max transaction duration
});
```

**Rules**:
- Always use `tx` (the transaction client) inside `$transaction`, never `fastify.prisma`
- Include audit logging inside the same transaction
- Set `timeout` for long-running transactions (e.g., collection approval)

---

## Migration Workflow

The project currently uses **`prisma db push`** (not migrations):

```bash
# Generate Prisma client after schema changes
npm run prisma:gen      # → prisma generate

# Push schema to database (development)
npm run prisma:push     # → prisma db push

# Create a named migration (when ready for production)
npm run prisma:migrate  # → prisma migrate dev

# Open Prisma Studio (visual DB editor)
npm run prisma:studio   # → prisma studio

# Run seed script
npm run prisma:seed     # → node prisma/seed.js
```

**Rules**:
1. After any schema change, always run `prisma:gen` to regenerate the client
2. Use `prisma:push` for development iteration
3. When schema is stable, create proper migrations with `prisma:migrate` before deploying to production
4. Never modify the database directly — always go through Prisma schema

---

## ID Generation

- **Strategy**: `cuid` (Prisma's `@default(cuid())`)
- **Format**: Collision-resistant, sortable unique IDs
- **Business IDs**: Sequential prefixed IDs generated in code:
  - Clients: `C-001`, `C-002`, etc.
  - Groups: `G-001`, `G-002`, etc.
  - Loans: `L-000001`, `L-000002`, etc.

---

## General Don'ts

1. **Don't use `findMany` without `take`** for endpoints that could return large datasets — always paginate
2. **Don't use `deleteMany` without a `where` clause** — always scope deletions
3. **Don't modify Prisma schema without updating `docs/rules/database.md`**
4. **Don't add indexes without documenting them** in this file
5. **Don't use raw SQL for operations Prisma can handle**
