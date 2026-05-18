// routes/branches/index.js
import { createBadRequestError, createNotFoundError } from "../../utils/errors.js";

export default async function branchRoutes(fastify, opts) {
  fastify.addHook("preHandler", fastify.authenticate);


  // GetAll
  fastify.get("/", async (request, reply) => {
    const branches = await fastify.prisma.branch.findMany({
      orderBy: { createdAt: "desc" },
    });
    return { success: true, branches };
  });

  // Get
  fastify.get("/:id", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params;
      const branch = await fastify.prisma.branch.findUnique({
        where: { id },
      });
      if (!branch) throw createNotFoundError("Branch not found");
      return { success: true, branch };
    },
  });

  // Create
  fastify.post("/", {
    preHandler: fastify.authorize(["ADMIN"]),
    schema: {
      body: {
        type: "object",
        required: ["name", "address"],
        properties: {
          name: { type: "string", minLength: 2 },
          address: { type: "string", minLength: 5 },
        },
      },
    },
    handler: async (request, reply) => {
      const { name, address } = request.body;

      const existingBranch = await fastify.prisma.branch.findFirst({
        where: { name },
      });
      if (existingBranch) {
        throw createBadRequestError("Branch name already exists");
      }

      const branch = await fastify.prisma.branch.create({
        data: { name, address },
      });

      await fastify.prisma.auditLog.create({
        data: {
          action: "CREATE",
          entity: "BRANCH",
          entityId: branch.id,
          userId: request.user?.id || "SYSTEM",
          details: { message: "Created Branch", name, address },
        },
      });

      return { success: true, branch };
    },
  });

  // Update
  fastify.put("/:id", {
    preHandler: fastify.authorize(["ADMIN"]),
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
      },
      body: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 2 },
          address: { type: "string", minLength: 5 },
        },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params;
      const { name, address } = request.body;

      const existingBranch = await fastify.prisma.branch.findUnique({
        where: { id },
      });
      if (!existingBranch) throw createNotFoundError("Branch not found");

      if (name && name !== existingBranch.name) {
        const duplicateBranch = await fastify.prisma.branch.findFirst({
          where: { name },
        });
        if (duplicateBranch) {
          throw createBadRequestError("Branch name already exists");
        }
      }

      const updatedBranch = await fastify.prisma.branch.update({
        where: { id },
        data: { name, address },
      });

      await fastify.prisma.auditLog.create({
        data: {
          action: "UPDATE",
          entity: "BRANCH",
          entityId: id,
          userId: request.user?.id || "SYSTEM",
          details: { message: "Updated Branch", name, address },
        },
      });

      return { success: true, branch: updatedBranch };
    },
  });

  // Delete
  fastify.delete("/:id", {
    preHandler: fastify.authorize(["ADMIN"]),
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params;

      const existingBranch = await fastify.prisma.branch.findUnique({
        where: { id },
      });
      if (!existingBranch) throw createNotFoundError("Branch not found");

      await fastify.prisma.branch.delete({
        where: { id },
      });

      await fastify.prisma.auditLog.create({
        data: {
          action: "DELETE",
          entity: "BRANCH",
          entityId: id,
          userId: request.user?.id || "SYSTEM",
          details: { message: "Deleted Branch", name: existingBranch.name },
        },
      });

      return { success: true, message: "Branch deleted successfully" };
    },
  });
}
