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
          status: { type: "string" }, // "All", "Active", "Inactive"
          collectionDay: { type: "string" }, // "All", "1", "2"...
        },
      },
    },
    handler: async (request, reply) => {
      const { page, limit, search, status, collectionDay } = request.query;
      const skip = (page - 1) * limit;

      const where = {
        AND: [
          search ? {
            OR: [
              { name: { contains: search } },
              { groupNo: { contains: search } },
              {
                branch: {
                  name: { contains: search }
                }
              },
              {
                officer: {
                  fullname: { contains: search }
                }
              },
              {
                members: {
                  some: {
                    isLeader: true,
                    client: {
                      fullname: { contains: search }
                    }
                  }
                }
              }
            ],
          } : {},
          status && status !== "All" ? { status: status === "Active" } : {},
          collectionDay && collectionDay !== "All" ? { collectionDay: parseInt(collectionDay) } : {},
        ]
      };

      const [groups, total] = await Promise.all([
        fastify.prisma.group.findMany({
          where,
          skip,
          take: limit,
          include: {
            officer: { select: { id: true, fullname: true } },
            branch: { select: { id: true, name: true } },
            members: {
              where: { isLeader: true },
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
        properties: {
          name: { type: "string" },
          branchId: { type: "string" },
          location: { type: "string" },
          collectionDay: { type: "number" },
          officerId: { type: "string" },
          createdBy: { type: "string" },
        },
      },
    },
    handler: async (request, reply) => {
      const { name, branchId, collectionDay, officerId, location, createdBy } = request.body;

      // Manual validation for field-level errors (since we use setError on frontend)
      const fields = {};
      if (!name || name.length < 3) fields.name = "Group name must be at least 3 characters";
      if (!branchId) fields.branchId = "Branch is required";
      if (!collectionDay) fields.collectionDay = "Collection day is required";
      if (!officerId) fields.officerId = "Collection officer is required";

      if (Object.keys(fields).length > 0) {
        throw createBadRequestError("Validation error", fields);
      }

      // Check if officer exists
      const officer = await fastify.prisma.user.findUnique({
        where: { id: officerId }
      });

      if (!officer) {
        throw createBadRequestError("Validation error", { officerId: "Selected officer does not exist" });
      }

      // Auto-generate Group ID (G-001, G-002, etc.)
      const lastGroup = await fastify.prisma.group.findFirst({
        orderBy: { createdAt: "desc" },
      });

      let nextNo = 1;
      if (lastGroup && lastGroup.groupNo && lastGroup.groupNo.startsWith("G-")) {
        nextNo = parseInt(lastGroup.groupNo.split("-")[1]) + 1;
      }
      const groupNo = `G-${nextNo.toString().padStart(3, "0")}`;

      const group = await fastify.prisma.group.create({
        data: {
          name,
          branchId: branchId || null,
          collectionDay,
          officerId,
          location,
          createdBy,
          groupNo,
        },
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
        branch: { select: { id: true, name: true } },
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
          branchId: { type: "string" },
          location: { type: "string" },
          collectionDay: { type: "number" },
          officerId: { type: "string" },
          status: { type: "boolean" },
          updatedBy: { type: "string" },
        },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params;
      const { name, branchId, collectionDay, officerId, location, status, updatedBy } = request.body;

      // Check if group has associated loans
      const existingLoan = await fastify.prisma.loan.findFirst({
        where: { groupId: id }
      });

      if (existingLoan) {
        throw createBadRequestError("Cannot update group information because it is associated with loan applications");
      }

      // Manual validation for field-level errors
      const fields = {};
      if (name !== undefined && name.length < 3) fields.name = "Group name must be at least 3 characters";
      if (branchId === "") fields.branchId = "Branch cannot be empty";
      
      if (Object.keys(fields).length > 0) {
        throw createBadRequestError("Validation error", fields);
      }

      if (officerId) {
        const officer = await fastify.prisma.user.findUnique({
          where: { id: officerId }
        });
        if (!officer) {
          throw createBadRequestError("Validation error", { officerId: "Selected officer does not exist" });
        }
      }

      const group = await fastify.prisma.group.update({
        where: { id },
        data: {
          name,
          branchId: branchId || null,
          collectionDay,
          officerId,
          location,
          status,
          updatedBy,
        },
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

      // Check if group has associated loans
      const existingLoan = await fastify.prisma.loan.findFirst({
        where: { groupId }
      });

      if (existingLoan) {
        throw createBadRequestError("Cannot add new members to this group because it is associated with loan applications");
      }

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

      // Check if group has associated loans
      const existingLoan = await fastify.prisma.loan.findFirst({
        where: { groupId: member.groupId }
      });

      if (existingLoan) {
        throw createBadRequestError("Cannot update member information because this group is associated with loan applications");
      }

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
        branch: { select: { id: true, name: true } },
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

    return { success: true, group: { name: group.name, branch: group.branch ? group.branch.name : "" }, members };
  });

  // Remove Member
  fastify.delete("/members/:memberId", async (request, reply) => {
    const { memberId } = request.params;

    const member = await fastify.prisma.groupMember.findUnique({
      where: { id: memberId },
    });

    if (!member) throw createNotFoundError("Member not found");

    // Check if group has associated loans
    const existingLoan = await fastify.prisma.loan.findFirst({
      where: { groupId: member.groupId }
    });

    if (existingLoan) {
      throw createBadRequestError("Cannot remove member because this group is associated with loan applications");
    }

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
