// routes/users/index.js
import bcrypt from "bcryptjs";
import { createBadRequestError, createNotFoundError } from "../../utils/errors.js";

export default async function userRoutes(fastify, opts) {
  // Get all users with pagination
  fastify.get("/", {
    schema: {
      query: {
        type: "object",
        properties: {
          page: { type: "number", default: 1 },
          limit: { type: "number", default: 10 },
          search: { type: "string" },
          role: { type: "string" },
        },
      },
    },
    handler: async (request, reply) => {
      const { page, limit, search, role } = request.query;
      const skip = (page - 1) * limit;

      const where = {
        AND: [
          search ? {
            OR: [
              { fullname: { contains: search } },
              { email: { contains: search } },
            ],
          } : {},
          role ? { role } : {},
        ],
      };

      const [users, total] = await Promise.all([
        fastify.prisma.user.findMany({
          where,
          skip,
          take: limit,
          select: {
            id: true,
            fullname: true,
            email: true,
            role: true,
            status: true,
            branch: true,
            lastLogin: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
        }),
        fastify.prisma.user.count({ where }),
      ]);

      return {
        success: true,
        users,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    },
  });

  // Create User (already handled by /api/auth/register, but could be here too)
  // For consistency, let's keep registration in auth or call it "create" here.

  // Update User
  fastify.put("/:id", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
      },
      body: {
        type: "object",
        required: ["fullname", "email", "role"],
        properties: {
          fullname: { type: "string", minLength: 3 },
          email: { type: "string", format: "email" },
          role: { type: "string" },
          branch: { type: "array", items: { type: "string" } },
          status: { type: "boolean" },
        },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params;
      const { fullname, email, role, branch, status } = request.body;

      const user = await fastify.prisma.user.findUnique({ where: { id } });
      if (!user) throw createNotFoundError("User not found");

      const updatedUser = await fastify.prisma.user.update({
        where: { id },
        data: { fullname, email, role, branch, status },
      });

      return { success: true, user: updatedUser };
    },
  });

  // Reset Password
  fastify.post("/:id/reset-password", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
      },
      body: {
        type: "object",
        required: ["password"],
        properties: {
          password: { type: "string", minLength: 6 },
        },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params;
      const { password } = request.body;

      const hashedPassword = await bcrypt.hash(password, 10);
      await fastify.prisma.user.update({
        where: { id },
        data: { password: hashedPassword },
      });

      return { success: true, message: "Password reset successful" };
    },
  });

  // Update Status (Deactivate/Activate)
  fastify.put("/:id/status", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
      },
      body: {
        type: "object",
        required: ["status"],
        properties: { status: { type: "boolean" } },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params;
      const { status } = request.body;

      await fastify.prisma.user.update({
        where: { id },
        data: { status },
      });

      return { success: true, message: `User ${status ? 'activated' : 'deactivated'} successfully` };
    },
  });
}
