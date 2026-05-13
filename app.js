// app.js
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
import collectionRoutes from "./routes/collections/index.js";


export async function buildApp(opts = {}) {
  // Ensure logs directory exists
  if (!fs.existsSync("./logs")) {
    fs.mkdirSync("./logs", { recursive: true });
  }

  const fastify = Fastify({
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

  await fastify.register(requestLoggerPlugin);
  await fastify.register(corsPlugin);
  await fastify.register(swaggerPlugin);
  await fastify.register(prismaPlugin);

  // Register global error handler
  globalErrorHandler(fastify);

  // Routes
  await fastify.register(authRoutes, { prefix: "/api/auth" });
  await fastify.register(userRoutes, { prefix: "/api/users" });
  await fastify.register(clientRoutes, { prefix: "/api/clients" });
  await fastify.register(groupRoutes, { prefix: "/api/groups" });
  await fastify.register(loanRoutes, { prefix: "/api/loans" });
  await fastify.register(collectionRoutes, { prefix: "/api/collections" });

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