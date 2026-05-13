// routes/groups/index.js
import { createBadRequestError, createNotFoundError } from "../../utils/errors.js";

export default async function groupRoutes(fastify, opts) {
  // Get all groups with pagination
  fastify.get("/", {
    schema: {
      query: {
        type: "object",
        properties: {
          page: { type: "number", default: 1 },
          limit: { type: "number", default: 10 },
          search: { type: "string" },
        },
      },
    },
    handler: async (request, reply) => {
      const { page, limit, search } = request.query;
      const skip = (page - 1) * limit;

      const where = search ? {
        OR: [
          { name: { contains: search } },
          { branch: { contains: search } },
        ],
      } : {};

      const [groups, total] = await Promise.all([
        fastify.prisma.group.findMany({
          where,
          skip,
          take: limit,
          include: {
            officer: { select: { id: true, fullname: true } },
            _count: { select: { members: true } },
          },
          orderBy: { createdAt: "desc" },
        }),
        fastify.prisma.group.count({ where }),
      ]);

      return {
        success: true,
        groups,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    },
  });

  // Create Group
  fastify.post("/", {
    schema: {
      body: {
        type: "object",
        required: ["name", "branch", "collectionDay", "officerId", "createdBy"],
        properties: {
          name: { type: "string", minLength: 3 },
          branch: { type: "string" },
          collectionDay: { type: "number", minimum: 1, maximum: 7 },
          officerId: { type: "string" },
          createdBy: { type: "string" },
        },
        errorMessage: {
          required: {
            name: "Group name is required",
            branch: "Branch is required",
            collectionDay: "Collection day is required",
            officerId: "Collection officer is required"
          }
        }
      },
    },
    handler: async (request, reply) => {
      const data = request.body;
      const group = await fastify.prisma.group.create({
        data,
      });
      return { success: true, group };
    },
  });

  // Get single group with members and guarantors
  fastify.get("/:id", async (request, reply) => {
    const { id } = request.params;
    const group = await fastify.prisma.group.findUnique({
      where: { id },
      include: {
        officer: { select: { id: true, fullname: true } },
        members: {
          include: {
            client: true,
            guarantors: true,
          },
        },
      },
    });

    if (!group) throw createNotFoundError("Group not found");
    return { success: true, group };
  });

  // Update Group
  fastify.put("/:id", {
    schema: {
      params: { type: "object", properties: { id: { type: "string" } } },
      body: {
        type: "object",
        properties: {
          name: { type: "string" },
          branch: { type: "string" },
          collectionDay: { type: "number" },
          officerId: { type: "string" },
          status: { type: "boolean" },
          updatedBy: { type: "string" },
        },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params;
      const data = request.body;

      const group = await fastify.prisma.group.update({
        where: { id },
        data,
      });

      return { success: true, group };
    },
  });

  // Add Member to Group
  fastify.post("/:id/members", {
    schema: {
      params: { type: "object", properties: { id: { type: "string" } } },
      body: {
        type: "object",
        required: ["clientId"],
        properties: {
          clientId: { type: "string" },
          isLeader: { type: "boolean", default: false },
        },
      },
    },
    handler: async (request, reply) => {
      const { id: groupId } = request.params;
      const { clientId, isLeader } = request.body;

      const existing = await fastify.prisma.groupMember.findUnique({
        where: { groupId_clientId: { groupId, clientId } },
      });

      if (existing) throw createBadRequestError("Client is already a member of this group");

      if (isLeader) {
        await fastify.prisma.groupMember.updateMany({
          where: { groupId, isLeader: true },
          data: { isLeader: false },
        });
      }

      const member = await fastify.prisma.groupMember.create({
        data: {
          groupId,
          clientId,
          isLeader,
        },
        include: { client: true, guarantors: true },
      });

      return { success: true, member };
    },
  });

  // Update Member (Leader status, Guarantors)
  fastify.put("/members/:memberId", {
    schema: {
      params: { type: "object", properties: { memberId: { type: "string" } } },
      body: {
        type: "object",
        properties: {
          isLeader: { type: "boolean" },
          guarantors: { 
            type: "array", 
            items: {
              type: "object",
              required: ["fullname", "nic", "phone", "address"],
              properties: {
                id: { type: "string" }, // Optional for existing ones
                fullname: { type: "string" },
                nic: { type: "string" },
                phone: { type: "string" },
                address: { type: "string" },
              }
            }
          },
        },
      },
    },
    handler: async (request, reply) => {
      const { memberId } = request.params;
      const { isLeader, guarantors } = request.body;

      const member = await fastify.prisma.groupMember.findUnique({
        where: { id: memberId },
      });

      if (!member) throw createNotFoundError("Member not found");

      if (isLeader === true) {
        await fastify.prisma.groupMember.updateMany({
          where: { groupId: member.groupId, isLeader: true },
          data: { isLeader: false },
        });
      }

      // Handle guarantors update
      if (guarantors) {
        // Simple approach: Delete existing and re-create (or more complex sync)
        // Given it's only 2, sync is manageable.
        await fastify.prisma.guarantor.deleteMany({ where: { memberId } });
        await fastify.prisma.guarantor.createMany({
          data: guarantors.map(g => ({
            memberId,
            fullname: g.fullname,
            nic: g.nic,
            phone: g.phone,
            address: g.address,
          })),
        });
      }

      const updatedMember = await fastify.prisma.groupMember.update({
        where: { id: memberId },
        data: {
          isLeader: isLeader !== undefined ? isLeader : member.isLeader,
        },
        include: { client: true, guarantors: true },
      });

      return { success: true, member: updatedMember };
    },
  });

  // Remove Member
  fastify.delete("/members/:memberId", async (request, reply) => {
    const { memberId } = request.params;
    await fastify.prisma.groupMember.delete({ where: { id: memberId } });
    return { success: true, message: "Member removed" };
  });
}
