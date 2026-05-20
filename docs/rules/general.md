# 📏 General Rules — Microfinance API

---

## Language & Module System

- **Language**: JavaScript (not TypeScript — the project uses `.js` files with ES Modules)
- **Module system**: ESM — `"type": "module"` in `package.json`. Use `import`/`export`, never `require()`
- **No TypeScript** — Do not add `.ts` files, `tsconfig.json`, or TypeScript dependencies unless explicitly decided to migrate

---

## Type Safety

- **No `any` type** — If TypeScript is ever introduced, never use `any`
- **Use JSDoc** where helpful for complex function signatures
- **Validate all inputs** at the schema level (AJV) — never trust raw user input

---

## Logging

- **No `console.log` in production code** — Use `fastify.log.info()`, `fastify.log.error()`, or `request.log.info()` etc.
- **Exception**: The `requestLogger` plugin currently uses `console.log` — this is a known debt item
- **Log levels**: Use appropriate levels — `info` for normal flow, `warn` for recoverable issues, `error` for failures
- **Pino transports**: Logs are written to `logs/combined.log` and `logs/error.log` via Pino file transports

---

## Environment Variables

- **All env vars MUST go through the config module** — Define them in `config/env.schema.js` and access via `fastify.config.VARIABLE_NAME`
- **Never access `process.env` directly** in route handlers or plugins (except in the top-level `app.js` or server startup)
- **Required vars must be listed** in the `required` array of `env.schema.js`
- **Provide defaults** for non-critical vars in the schema
- **Document new env vars** in both `config/env.schema.js` and `.env.example`

---

## Code Style

- **Semicolons**: Yes — use semicolons
- **Quotes**: Double quotes (`"`) for strings (matching existing codebase)
- **Indentation**: 2 spaces
- **Trailing commas**: Yes — use trailing commas in multi-line objects/arrays
- **Arrow functions**: Preferred for handlers and callbacks
- **Async/await**: Always use async/await, never raw Promises or callbacks

---

## File Organization

- **One module per folder** in `routes/` — each route folder has a single `index.js`
- **Plugins** are single files in `plugins/` — wrapped with `fastify-plugin` for encapsulation
- **Utils** are pure functions in `utils/` — no Fastify dependency, importable anywhere
- **No barrel exports** — import directly from the source file

---

## Commit Messages

Use conventional commit format:

```
type(scope): description

Examples:
feat(loans): add instalment rescheduling endpoint
fix(auth): validate refresh token expiry before rotation
chore(deps): update @fastify/jwt to v10.0.1
docs(architecture): update request lifecycle diagram
```

**Types**: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `style`, `perf`

---

## General Don'ts

1. **Don't modify the folder structure** without updating `AGENTS.md` and `docs/ARCHITECTURE.md`
2. **Don't use `var`** — always `const`, use `let` only when reassignment is needed
3. **Don't use synchronous I/O** in request handlers (e.g., `fs.readFileSync`)
4. **Don't swallow errors** — always log or rethrow
5. **Don't commit `.env`** — it's gitignored; use `.env.example` for documentation
