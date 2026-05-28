// app.js
// trigger nodemon restart again
import "dotenv/config";
import Fastify from "fastify";
import ajvErrors from "ajv-errors";
import corsPlugin from "./plugins/cors.js";
import { envSchema } from "./config/env.schema.js";
import envPlugin from "@fastify/env";
import os from "os";
import fs from "fs";
import prismaPlugin from "./plugins/prisma.js";
import swaggerPlugin from "./plugins/swagger.js";
import requestLoggerPlugin from "./plugins/requestLogger.js";
import jwtPlugin from "./plugins/jwt.js";
import {
  globalErrorHandler,
  notFoundHandler,
} from "./middleware/errorHandler.js";
import { getSystemInfo } from "./utils/systemInfo.js";
import authRoutes from "./routes/auth/index.js";
import userRoutes from "./routes/users/index.js";
import clientRoutes from "./routes/clients/index.js";
import groupRoutes from "./routes/groups/index.js";
import loanRoutes from "./routes/loans/index.js";
import mortgageLoanRoutes from "./routes/mortgage-loans/index.js";
import collectionRoutes from "./routes/collections/index.js";
import settingsRoutes from "./routes/settings/index.js";
import nonCollectionWeekRoutes from "./routes/non-collection-weeks/index.js";
import attachmentRoutes from "./routes/attachments/index.js";
import auditRoutes from "./routes/audit/index.js";
import branchRoutes from "./routes/branches/index.js";
import dashboardRoutes from "./routes/dashboard/index.js";
import mortgageDashboardRoutes from "./routes/mortgage-dashboard/index.js";
import reportRoutes from "./routes/reports/index.js";
import fastifyMultipart from "@fastify/multipart";
import schedulerPlugin from "./plugins/scheduler.js";


export async function buildApp(opts = {}) {
  // Ensure logs directory exists
  if (!fs.existsSync("./logs")) {
    fs.mkdirSync("./logs", { recursive: true });
  }

  const fastify = Fastify({
    bodyLimit: 50 * 1024 * 1024, // 50MB
    logger: {
      level: "info",
      transport: {
        targets: [
          {
            target: "pino/file",
            options: { destination: "./logs/combined.log" },
          },
          {
            target: "pino/file",
            level: "error",
            options: { destination: "./logs/error.log" },
          },
        ],
      },
    },
    ajv: {
      customOptions: {
        allErrors: true,
      },
      plugins: [ajvErrors],
    },
  });

  await fastify.register(envPlugin, {
    schema: envSchema,
    dotenv: true,
  });

  await fastify.register(jwtPlugin);
  await fastify.register(requestLoggerPlugin);
  await fastify.register(corsPlugin);
  await fastify.register(swaggerPlugin);
  await fastify.register(prismaPlugin);
  await fastify.register(schedulerPlugin);
  await fastify.register(fastifyMultipart, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB
    }
  });

  // Register global error handler
  globalErrorHandler(fastify);

  // Routes
  await fastify.register(authRoutes, { prefix: "/api/auth" });
  await fastify.register(userRoutes, { prefix: "/api/users" });
  await fastify.register(clientRoutes, { prefix: "/api/clients" });
  await fastify.register(groupRoutes, { prefix: "/api/groups" });
  await fastify.register(loanRoutes, { prefix: "/api/loans" });
  await fastify.register(mortgageLoanRoutes, { prefix: "/api/mortgage-loans" });
  await fastify.register(collectionRoutes, { prefix: "/api/collections" });
  await fastify.register(settingsRoutes, { prefix: "/api/settings" });
  await fastify.register(nonCollectionWeekRoutes, { prefix: "/api/non-collection-weeks" });
  await fastify.register(attachmentRoutes, { prefix: "/api/attachments" });
  await fastify.register(auditRoutes, { prefix: "/api/audit" });
  await fastify.register(branchRoutes, { prefix: "/api/branches" });
  await fastify.register(dashboardRoutes, { prefix: "/api/dashboard" });
  await fastify.register(mortgageDashboardRoutes, { prefix: "/api/mortgage-dashboard" });
  await fastify.register(reportRoutes, { prefix: "/api/reports" });

  // PUBLIC ROUTE — no auth required (health check)
  fastify.get("/api/health", async (request, reply) => {
    const systemInfo = getSystemInfo();

    // Database health check
    let dbStatus = "disconnected";
    let dbLatency = null;

    try {
      const start = Date.now();
      await fastify.prisma.$queryRaw`SELECT 1`;
      dbLatency = `${Date.now() - start}ms`;
      dbStatus = "connected";
    } catch (error) {
      fastify.log.error("Database health check failed:", error);
    }

    return {
      success: true,
      status: "ok",
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || "development",
      version: process.env.npm_package_version || "1.0.0",
      uptime: {
        process: `${Math.floor(process.uptime())} seconds`,
        system: `${Math.floor(os.uptime())} seconds`,
      },
      database: {
        status: dbStatus,
        latency: dbLatency,
      },
      ...systemInfo,
    };
  });

  // PUBLIC ROUTE — no auth required (API info)
  fastify.get("/", async () => {
    return { message: "Microfinance API Services" };
  });

  // 404 handler should be registered last
  notFoundHandler(fastify);

  // Cleanup hook
  fastify.addHook("onClose", async () => {
    fastify.log.info("🔴 Cleaning up resources...");
  });

  return fastify;
}