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
            members: {
              include: {
                client: { select: { fullname: true, clientNo: true, phone: true } }
              }
            },
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

  // Get single group with members
  fastify.get("/:id", async (request, reply) => {
    const { id } = request.params;
    const group = await fastify.prisma.group.findUnique({
      where: { id },
      include: {
        officer: { select: { id: true, fullname: true } },
        members: {
          include: {
            client: true,
          },
        },
        loans: {
          orderBy: { createdAt: "desc" },
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
        include: { client: true },
      });

      return { success: true, member };
    },
  });

  // Update Member (Leader status)
  fastify.put("/members/:memberId", {
    schema: {
      params: { type: "object", properties: { memberId: { type: "string" } } },
      body: {
        type: "object",
        properties: {
          isLeader: { type: "boolean" },
        },
      },
    },
    handler: async (request, reply) => {
      const { memberId } = request.params;
      const { isLeader } = request.body;

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

      const updatedMember = await fastify.prisma.groupMember.update({
        where: { id: memberId },
        data: {
          isLeader: isLeader !== undefined ? isLeader : member.isLeader,
        },
        include: { client: true },
      });

      return { success: true, member: updatedMember };
    },
  });

  // Get Collection Sheet (Members + their current dues)
  fastify.get("/:id/collection-sheet", async (request, reply) => {
    const { id: groupId } = request.params;
    const { week } = request.query;

    const group = await fastify.prisma.group.findUnique({
      where: { id: groupId },
      include: {
        members: {
          include: {
            client: {
              include: {
                instalments: {
                  where: {
                    loan: { 
                      groupId,
                      status: "APPROVED" 
                    },
                    weekNumber: week ? Number(week) : undefined,
                  },
                  orderBy: { weekNumber: "asc" }
                }
              }
            }
          }
        }
      }
    });

    if (!group) throw createNotFoundError("Group not found");

    const members = group.members.map(m => {
      // Find the instalment for the requested week
      const targetInstalment = m.client.instalments.find(i => i.weekNumber === Number(week));
      
      return {
        clientId: m.clientId,
        fullname: m.client.fullname,
        isLeader: m.isLeader,
        dueAmount: targetInstalment ? Number(targetInstalment.dueAmount) : 0,
        remainingDue: targetInstalment ? Number(targetInstalment.remainingDue) : 0,
        status: targetInstalment ? targetInstalment.status : "N/A"
      };
    });

    return { success: true, group: { name: group.name, branch: group.branch }, members };
  });

  // Remove Member
  fastify.delete("/members/:memberId", async (request, reply) => {
    const { memberId } = request.params;
    await fastify.prisma.groupMember.delete({ where: { id: memberId } });
    return { success: true, message: "Member removed" };
  });

  // Delete Group
  fastify.delete("/:id", async (request, reply) => {
    const { id } = request.params;

    // Check for ANY associated loans
    const existingLoan = await fastify.prisma.loan.findFirst({
      where: {
        groupId: id
      }
    });

    if (existingLoan) {
      throw createBadRequestError("Cannot delete a group that has associated loan applications");
    }

    await fastify.prisma.group.delete({ where: { id } });
    return { success: true, message: "Group deleted successfully" };
  });
}
