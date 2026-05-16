// routes/audit/index.js
import { createNotFoundError } from "../../utils/errors.js";

export default async function auditRoutes(fastify, opts) {
  fastify.addHook("preHandler", fastify.authenticate);

  // Get all audit logs with pagination and filters
  fastify.get("/", {
    schema: {
      query: {
        type: "object",
        properties: {
          page: { type: "number", default: 1 },
          limit: { type: "number", default: 20 },
          entity: { type: "string" },
          action: { type: "string" },
          userId: { type: "string" },
        },
      },
    },
    handler: async (request, reply) => {
      const { page, limit, entity, action, userId } = request.query;
      const skip = (page - 1) * limit;

      const where = {
        AND: [
          entity ? { entity } : {},
          action ? { action } : {},
          userId ? { userId } : {},
        ],
      };

      const [logs, total] = await Promise.all([
        fastify.prisma.auditLog.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
        }),
        fastify.prisma.auditLog.count({ where }),
      ]);

      // Enrich logs with user info
      // Since userId is a string and not a direct relation in prisma schema, we fetch users manually
      const userIds = [...new Set(logs.map(log => log.userId))];
      const users = await fastify.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, fullname: true, role: true }
      });

      const userMap = Object.fromEntries(users.map(u => [u.id, u]));

      const enrichedLogs = logs.map(log => ({
        ...log,
        user: userMap[log.userId] || { fullname: "Unknown User", role: "N/A" }
      }));

      return {
        success: true,
        logs: enrichedLogs,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    },
  });

  // Get single audit log details
  fastify.get("/:id", async (request, reply) => {
    const { id } = request.params;
    const log = await fastify.prisma.auditLog.findUnique({
      where: { id },
    });

    if (!log) throw createNotFoundError("Audit log not found");

    const user = await fastify.prisma.user.findUnique({
      where: { id: log.userId },
      select: { id: true, fullname: true, role: true }
    });

    return { 
      success: true, 
      log: {
        ...log,
        user: user || { fullname: "Unknown User", role: "N/A" }
      }
    };
  });
}
