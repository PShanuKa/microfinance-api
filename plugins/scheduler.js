// plugins/scheduler.js
import cron from "node-cron";
import { processMortgageInstalments } from "../utils/mortgageCron.js";

export default async function schedulerPlugin(fastify, opts) {
  // ─── Run once daily at midnight (00:00) ────────────────────────────────────
  cron.schedule("0 0 * * *", async () => {
    fastify.log.info("⏰ [CRON] Running daily mortgage instalments processor...");
    try {
      const result = await processMortgageInstalments(fastify.prisma, fastify.log);
      fastify.log.info(`⏰ [CRON] Done — created ${result.totalCreated} instalment(s).`);
    } catch (err) {
      fastify.log.error(err, "[CRON] Mortgage instalments processor failed");
    }
  });

  fastify.log.info("✔ Mortgage scheduler registered (daily at midnight).");

  // ─── Manual trigger endpoint (for testing / backfill) ──────────────────────
  // POST /api/scheduler/run-mortgage-instalments
  fastify.post("/api/scheduler/run-mortgage-instalments", {
    preHandler: fastify.authenticate,
    handler: async (request, reply) => {
      fastify.log.info("⏰ [MANUAL] Mortgage instalments processor triggered manually.");
      const result = await processMortgageInstalments(fastify.prisma, fastify.log);
      return {
        success: true,
        message: `Instalment generation complete. Created ${result.totalCreated} new instalment(s).`,
        totalCreated: result.totalCreated,
      };
    },
  });
}
