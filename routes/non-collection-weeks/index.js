// routes/non-collection-weeks/index.js
import { createBadRequestError, createNotFoundError } from "../../utils/errors.js";

export default async function nonCollectionWeekRoutes(fastify, opts) {
  // Get all
  fastify.get("/", async (request, reply) => {
    const weeks = await fastify.prisma.nonCollectionWeek.findMany({
      orderBy: { startDate: "desc" },
    });
    return { success: true, weeks };
  });

  // Create
  fastify.post("/", {
    schema: {
      body: {
        type: "object",
        required: ["startDate", "endDate"],
        properties: {
          startDate: { type: "string", format: "date-time" },
          endDate: { type: "string", format: "date-time" },
          reason: { type: "string" },
        },
      },
    },
    handler: async (request, reply) => {
      const { startDate, endDate, reason } = request.body;
      
      const week = await fastify.prisma.nonCollectionWeek.create({
        data: {
          startDate: new Date(startDate),
          endDate: new Date(endDate),
          reason,
        },
      });

      return { success: true, week };
    },
  });

  // Update
  fastify.put("/:id", {
    schema: {
      params: { type: "object", properties: { id: { type: "string" } } },
      body: {
        type: "object",
        properties: {
          startDate: { type: "string", format: "date-time" },
          endDate: { type: "string", format: "date-time" },
          reason: { type: "string" },
        },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params;
      const data = request.body;

      const updateData = {};
      if (data.startDate) updateData.startDate = new Date(data.startDate);
      if (data.endDate) updateData.endDate = new Date(data.endDate);
      if (data.reason !== undefined) updateData.reason = data.reason;

      const week = await fastify.prisma.nonCollectionWeek.update({
        where: { id },
        data: updateData,
      });

      return { success: true, week };
    },
  });

  // Delete
  fastify.delete("/:id", async (request, reply) => {
    const { id } = request.params;
    await fastify.prisma.nonCollectionWeek.delete({ where: { id } });
    return { success: true };
  });
}
