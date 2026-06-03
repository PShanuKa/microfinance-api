import { PrismaClient } from "@prisma/client";
import fp from "fastify-plugin";

async function prismaPlugin(fastify, options) {
  let dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    const user = process.env.DB_USER || "root";
    const pass = process.env.DB_PASS || "";
    const host = process.env.DB_HOST || "localhost";
    const port = process.env.DB_PORT || "3306";
    const name = process.env.DB_NAME || "microfinance";
    dbUrl = `mysql://${user}:${pass}@${host}:${port}/${name}`;
  }

  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: dbUrl,
      },
    },
    log:
      fastify.config.NODE_ENV === "development"
        ? ["query", "info", "warn", "error"]
        : ["warn", "error"]
  });

  try {
    await prisma.$connect();
    fastify.log.info("✅ Database connected successfully");
  } catch (error) {
    fastify.log.error("❌ Database connection failed:", error);
    throw error;
  }

  fastify.decorate("prisma", prisma);

  fastify.addHook("onClose", async (instance) => {
    fastify.log.info("🔴 Disconnecting from database...");
    await instance.prisma.$disconnect();
    fastify.log.info("✅ Database disconnected");
  });
}

export default fp(prismaPlugin);
