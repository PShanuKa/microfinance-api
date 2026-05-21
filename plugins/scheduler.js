// plugins/scheduler.js
import cron from "node-cron";
import { processMortgageInstalments } from "../utils/mortgageCron.js";
import { processDailyPenalties }      from "../utils/penaltyCron.js";

export default async function schedulerPlugin(fastify, opts) {

  // ─── Daily at midnight: generate new monthly instalments ────────────────────
  cron.schedule("0 0 * * *", async () => {
    fastify.log.info("⏰ [CRON] Running mortgage instalments generator...");
    try {
      const result = await processMortgageInstalments(fastify.prisma, fastify.log);
      fastify.log.info(`⏰ [CRON] Instalments done — created ${result.totalCreated}.`);
    } catch (err) {
      fastify.log.error(err, "[CRON] Instalments job failed");
    }
  });

  // ─── Daily at midnight: apply daily penalties to overdue instalments ─────────
  cron.schedule("0 0 * * *", async () => {
    fastify.log.info("⏰ [CRON] Running daily penalty calculator...");
    try {
      const result = await processDailyPenalties(fastify.prisma, fastify.log);
      fastify.log.info(
        `⏰ [CRON] Penalties done — ` +
        `applied to ${result.totalPenaltiesApplied} instalment(s), ` +
        `${result.totalMarkedOverdue} marked OVERDUE.`
      );
    } catch (err) {
      fastify.log.error(err, "[CRON] Penalty job failed");
    }
  });

  fastify.log.info("✔ Scheduler registered: instalments + penalties (daily at midnight).");

  // ─── Manual trigger: instalment generation ──────────────────────────────────
  fastify.post("/api/scheduler/run-mortgage-instalments", {
    preHandler: fastify.authenticate,
    handler: async (request, reply) => {
      fastify.log.info("⏰ [MANUAL] Mortgage instalments processor triggered.");
      const result = await processMortgageInstalments(fastify.prisma, fastify.log);
      return {
        success: true,
        message: `Instalment generation complete. Created ${result.totalCreated} new instalment(s).`,
        totalCreated: result.totalCreated,
      };
    },
  });

  // ─── Manual trigger: penalty calculation ────────────────────────────────────
  fastify.post("/api/scheduler/run-penalty-calculation", {
    preHandler: fastify.authenticate,
    handler: async (request, reply) => {
      fastify.log.info("⏰ [MANUAL] Daily penalty calculator triggered.");
      const result = await processDailyPenalties(fastify.prisma, fastify.log);
      return {
        success: true,
        message:
          `Penalty calculation complete. ` +
          `Applied to ${result.totalPenaltiesApplied} instalment(s), ` +
          `${result.totalMarkedOverdue} marked OVERDUE.`,
        totalPenaltiesApplied: result.totalPenaltiesApplied,
        totalMarkedOverdue:    result.totalMarkedOverdue,
      };
    },
  });
}
