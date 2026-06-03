// routes/report-settings/index.js
export default async function reportSettingsRoutes(fastify, opts) {
  fastify.addHook("preHandler", fastify.authenticate);

  // Get report settings
  fastify.get("/", async (request, reply) => {
    let settings = await fastify.prisma.reportSettings.findUnique({
      where: { id: "default" },
    });

    if (!settings) {
      settings = await fastify.prisma.reportSettings.create({
        data: { id: "default" },
      });
    }

    return { success: true, settings };
  });

  // Update report settings
  fastify.put("/", {
    schema: {
      body: {
        type: "object",
        properties: {
          reportFrequency: { type: "string", enum: ["WEEKLY", "MONTHLY"] },
          reportEmails: {
            type: "array",
            items: { type: "string", format: "email" },
          },
          emailEnabled: { type: "boolean" },
        },
      },
    },
    handler: async (request, reply) => {
      const { reportFrequency, reportEmails, emailEnabled } = request.body;

      const data = {};
      if (reportFrequency !== undefined) data.reportFrequency = reportFrequency;
      if (reportEmails !== undefined) data.reportEmails = reportEmails;
      if (emailEnabled !== undefined) data.emailEnabled = emailEnabled;

      const settings = await fastify.prisma.reportSettings.upsert({
        where: { id: "default" },
        update: data,
        create: { id: "default", ...data },
      });

      // Audit log
      await fastify.prisma.auditLog.create({
        data: {
          action: "REPORT_SETTINGS_UPDATED",
          entity: "ReportSettings",
          entityId: "default",
          userId: request.user.id,
          details: data,
        },
      });

      return { success: true, settings };
    },
  });
}
