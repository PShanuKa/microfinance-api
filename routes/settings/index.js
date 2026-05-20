// routes/settings/index.js
export default async function settingsRoutes(fastify, opts) {
  fastify.addHook("preHandler", fastify.authenticate);

  // Get settings
  fastify.get("/", async (request, reply) => {
    let settings = await fastify.prisma.settings.findUnique({
      where: { id: "default" },
    });

    if (!settings) {
      // Create default settings if they don't exist
      settings = await fastify.prisma.settings.create({
        data: { id: "default" },
      });
    }

    return { success: true, settings };
  });

  // Update settings
  fastify.put("/", {
    schema: {
      body: {
        type: "object",
        properties: {
          lateWeeksFlag: { type: "number" },
          minLoanWeeks: { type: "number" },
          maxLoanWeeks: { type: "number" },
          defaultLoanWeeks: { type: "number" },
          maxActiveLoansGroup: { type: "number" },
        },
      },
    },
    handler: async (request, reply) => {
      const data = request.body;
      const settings = await fastify.prisma.settings.upsert({
        where: { id: "default" },
        update: data,
        create: { id: "default", ...data },
      });

      return { success: true, settings };
    },
  });
}
