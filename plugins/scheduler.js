// plugins/scheduler.js
import cron from "node-cron";
import { processMortgageInstalments } from "../utils/mortgageCron.js";
import { processDailyPenalties }      from "../utils/penaltyCron.js";
import { processScheduledReports }    from "../utils/reportCron.js";

export default async function schedulerPlugin(fastify, opts) {

  // ─── Daily at midnight (Asia/Colombo): generate new monthly instalments ─────
  cron.schedule("0 0 * * *", async () => {
    fastify.log.info("⏰ [CRON] Running mortgage instalments generator...");
    try {
      const result = await processMortgageInstalments(fastify.prisma, fastify.log);
      fastify.log.info(`⏰ [CRON] Instalments done — created ${result.totalCreated}.`);
    } catch (err) {
      fastify.log.error(err, "[CRON] Instalments job failed");
    }
  }, { timezone: "Asia/Colombo" });

  // ─── Daily at midnight (Asia/Colombo): apply daily penalties to overdue instalments ─
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
  }, { timezone: "Asia/Colombo" });

  fastify.log.info("✔ Scheduler registered: instalments + penalties (daily at midnight).");

  // ─── Weekly reports: Every Monday at 6:00 AM (Asia/Colombo) ─────────────────
  cron.schedule("0 6 * * 1", async () => {
    fastify.log.info("⏰ [CRON] Running weekly report generator...");
    try {
      const settings = await fastify.prisma.reportSettings.findUnique({ where: { id: "default" } });
      if (settings?.reportFrequency === "WEEKLY" && settings?.emailEnabled) {
        const result = await processScheduledReports(fastify.prisma, fastify.log);
        fastify.log.info(`⏰ [CRON] Weekly reports done — sent: ${result.sent}`);
      } else {
        fastify.log.info("⏰ [CRON] Weekly reports skipped — frequency not WEEKLY or disabled.");
      }
    } catch (err) {
      fastify.log.error(err, "[CRON] Weekly report job failed");
    }
  }, { timezone: "Asia/Colombo" });

  // ─── Monthly reports: 1st of every month at 6:00 AM (Asia/Colombo) ──────────
  cron.schedule("0 6 1 * *", async () => {
    fastify.log.info("⏰ [CRON] Running monthly report generator...");
    try {
      const settings = await fastify.prisma.reportSettings.findUnique({ where: { id: "default" } });
      if (settings?.reportFrequency === "MONTHLY" && settings?.emailEnabled) {
        const result = await processScheduledReports(fastify.prisma, fastify.log);
        fastify.log.info(`⏰ [CRON] Monthly reports done — sent: ${result.sent}`);
      } else {
        fastify.log.info("⏰ [CRON] Monthly reports skipped — frequency not MONTHLY or disabled.");
      }
    } catch (err) {
      fastify.log.error(err, "[CRON] Monthly report job failed");
    }
  }, { timezone: "Asia/Colombo" });

  fastify.log.info("✔ Scheduler registered: report emails (weekly Mon 6AM + monthly 1st 6AM).");

  // ─── Manual trigger: instalment generation ──────────────────────────────────
  /*
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
  */
}
