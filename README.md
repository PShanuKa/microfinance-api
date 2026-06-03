# Microfinance API

The Microfinance API is a robust backend service built with Fastify and Prisma ORM to manage microfinance operations, including clients, groups, loans, instalments, and collections.

## Features

- **User Authentication**: Secure JWT-based authentication with roles (Admin, Branch Manager, Collector, Approver).
- **Client & Group Management**: Manage individual clients and group them for group loans.
- **Loan Processing**: Track active, draft, and completed loans with customizable interest rates and instalments.
- **Mortgage Loans**: Dedicated support for mortgage and property-backed loans.
- **Collection Registry**: Automatically track weekly and monthly collections.
- **Automated Reporting**: Cron jobs and REST endpoints to generate Excel and PDF reports sent directly via email.
- **Security-First**: Configured with CORS, Rate Limiting, Helmet headers, and schema validation via AJV.

## Technology Stack

- **Framework**: [Fastify](https://www.fastify.io/) v5
- **Database & ORM**: [Prisma](https://www.prisma.io/) + MySQL
- **Validation**: AJV
- **Authentication**: JWT & Refresh Tokens
- **Reports**: ExcelJS, Html-Pdf-Node
- **Job Scheduling**: node-cron

## Prerequisites

- Node.js (v18+)
- MySQL Database
- S3 / MinIO (For attachments and file uploads)
- SMTP Server (For email reports)

## Getting Started

1. **Clone the repository**
2. **Install dependencies**
   ```bash
   npm install
   ```
3. **Configure Environment Variables**
   Copy the example environment file and update it with your own credentials:
   ```bash
   cp .env.example .env
   ```
4. **Database Setup**
   Ensure your MySQL server is running, then execute Prisma migrations to create the schema:
   ```bash
   # Make sure DATABASE_URL is set in your environment if doing this manually
   npx prisma generate
   npx prisma db push
   ```
5. **Run the Server**
   ```bash
   # Development Mode (with hot-reload)
   npm run dev

   # Production Mode
   npm start
   ```

## Production Readiness

Before deploying to production, ensure:
1. `NODE_ENV` is set to `production`.
2. `CORS_ORIGIN` is configured to exactly match your frontend application's URL.
3. `JWT_SECRET` and `JWT_REFRESH_SECRET` are strong, unique secrets.
4. Logging is handled externally (e.g., PM2) to prevent local file size limits from overflowing (`app.js` is set to log to `logs/combined.log`).

## API Documentation

When running in `development` mode, the API documentation (Swagger UI) is available at:
`http://localhost:4000/documentation`

*(Note: Swagger UI is intentionally disabled in production for security reasons.)*

## Key Scripts

- `npm run dev`: Starts the Nodemon dev server.
- `npm start`: Starts the production server.
- `npm run prisma:studio`: Opens the Prisma GUI to explore the database.
- `npm run prisma:seed`: Runs the database seeder to populate initial data.