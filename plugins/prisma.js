import { PrismaClient } from "@prisma/client";
import fp from "fastify-plugin";

async function prismaPlugin(fastify, options) {
  const prisma = new PrismaClient({
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
