// routes/clients/index.js
import { createBadRequestError, createNotFoundError } from "../../utils/errors.js";

export default async function clientRoutes(fastify, opts) {
  fastify.addHook("preHandler", fastify.authenticate);
  // Get all clients with pagination
  fastify.get("/", {
    schema: {
      query: {
        type: "object",
        properties: {
          page: { type: "number", default: 1 },
          limit: { type: "number", default: 10 },
          search: { type: "string" },
          status: { type: "string" },
        },
      },
    },
    handler: async (request, reply) => {
      const { page, limit, search, status } = request.query;
      const skip = (page - 1) * limit;

      const where = {
        isDeleted: false,
        AND: [
          search ? {
            OR: [
              { fullname: { contains: search } },
              { nic: { contains: search } },
              { clientNo: { contains: search } },
            ],
          } : {},
          status && status !== "All" ? { status } : {},
        ],
      };

      const [clients, total] = await Promise.all([
        fastify.prisma.client.findMany({
          where,
          skip,
          take: limit,
          include: {
            profileImage: true,
            documents: {
              include: { attachment: true }
            },
            groupMembers: {
              include: {
                group: {
                  select: { id: true, name: true, branch: true }
                }
              }
            }
          },
          orderBy: { createdAt: "desc" },
        }),
        fastify.prisma.client.count({ where }),
      ]);

      return {
        success: true,
        clients,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    },
  });

  // Create Client
  fastify.post("/", {
    schema: {
      body: {
        type: "object",
        required: ["fullname", "nic", "phone"],
        properties: {
          fullname: { type: "string", minLength: 3 },
          nic: { type: "string", minLength: 9 },
          phone: { type: "string", minLength: 8 },
          address: { type: "string" },
          status: { type: "string", enum: ["ACTIVE", "INACTIVE", "BLACKLISTED"] },
          profileImageId: { type: "string" },
          documents: {
            type: "array",
            items: {
              type: "object",
              required: ["attachmentId", "type"],
              properties: {
                attachmentId: { type: "string" },
                type: { type: "string" }
              }
            }
          }
        },
        errorMessage: {
          required: {
            fullname: "Full name is required",
            nic: "NIC number is required",
            phone: "Phone number is required"
          },
          properties: {
            fullname: "Full name must be at least 3 characters",
            nic: "NIC must be at least 9 characters",
            phone: "Invalid phone number format"
          }
        }
      },
    },
    handler: async (request, reply) => {
      const { fullname, nic, phone, address, job, status, profileImageId, documents } = request.body;

      const existingClient = await fastify.prisma.client.findUnique({
        where: { nic },
      });

      if (existingClient) {
        throw createBadRequestError("Validation error", { nic: "Client with this NIC already exists" });
      }

      // Generate client number (C-001, C-002, etc.)
      const lastClient = await fastify.prisma.client.findFirst({
        orderBy: { createdAt: "desc" },
      });

      let nextNo = 1;
      if (lastClient && lastClient.clientNo.startsWith("C-")) {
        nextNo = parseInt(lastClient.clientNo.split("-")[1]) + 1;
      }
      const clientNo = `C-${nextNo.toString().padStart(3, "0")}`;

      const client = await fastify.prisma.client.create({
        data: {
          clientNo,
          fullname,
          nic,
          phone,
          address,
          job,
          status: status || "ACTIVE",
          createdBy: request.user.id,
          ...(profileImageId ? { profileImage: { connect: { id: profileImageId } } } : {}),
          ...(documents && documents.length > 0 ? {
            documents: {
              create: documents.map(doc => ({
                attachmentId: doc.attachmentId,
                type: doc.type
              }))
            }
          } : {})
        },
        include: {
          profileImage: true,
          documents: {
            include: { attachment: true }
          }
        }
      });

      // Audit Log
      await fastify.prisma.auditLog.create({
        data: {
          action: "CREATE",
          entity: "CLIENT",
          entityId: client.id,
          userId: request.user.id,
          details: {
            message: `Created client ${client.fullname} (${client.clientNo})`,
            after: client
          }
        }
      });

      return { success: true, client };
    },
  });

  // Update Client
  fastify.put("/:id", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
      },
      body: {
        type: "object",
        properties: {
          fullname: { type: "string", minLength: 3 },
          nic: { type: "string", minLength: 9 },
          phone: { type: "string", minLength: 8 },
          address: { type: "string" },
          job: { type: "string" },
          status: { type: "string", enum: ["ACTIVE", "INACTIVE", "BLACKLISTED"] },
          profileImageId: { type: "string" },
          documents: {
            type: "array",
            items: {
              type: "object",
              required: ["attachmentId", "type"],
              properties: {
                attachmentId: { type: "string" },
                type: { type: "string" }
              }
            }
          }
        },
        errorMessage: {
          required: {
            fullname: "Full name is required",
            nic: "NIC number is required",
            phone: "Phone number is required"
          },
          properties: {
            fullname: "Full name must be at least 3 characters",
            nic: "NIC must be at least 9 characters",
            phone: "Invalid phone number format"
          }
        }
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params;
      const data = request.body;

      const client = await fastify.prisma.client.findUnique({ where: { id } });
      if (!client || client.isDeleted) throw createNotFoundError("Client not found");

      // Check if NIC is being updated and if it already exists
      if (data.nic && data.nic !== client.nic) {
        const existingNic = await fastify.prisma.client.findUnique({
          where: { nic: data.nic },
        });
        if (existingNic) {
          throw createBadRequestError("Validation error", { nic: "NIC already in use by another client" });
        }
      }

      const { profileImageId, profileImage, groupMembers, instalments, documents, ...rest } = data;

      const updatedClient = await fastify.prisma.client.update({
        where: { id },
        data: {
          ...rest,
          updatedBy: request.user.id,
          ...(profileImageId ? { profileImage: { connect: { id: profileImageId } } } : {}),
          ...(documents ? {
            documents: {
              deleteMany: {},
              create: documents.map(doc => ({
                attachmentId: doc.attachmentId,
                type: doc.type
              }))
            }
          } : {})
        },
        include: {
          profileImage: true,
          documents: {
            include: { attachment: true }
          }
        }
      });

      // Audit Log
      await fastify.prisma.auditLog.create({
        data: {
          action: "UPDATE",
          entity: "CLIENT",
          entityId: updatedClient.id,
          userId: request.user.id,
          details: {
            message: `Updated client ${updatedClient.fullname} (${updatedClient.clientNo})`,
            before: client,
            after: updatedClient
          }
        }
      });

      return { success: true, client: updatedClient };
    },
  });

  // Get single client
  fastify.get("/:id", async (request, reply) => {
    const { id } = request.params;
    const client = await fastify.prisma.client.findUnique({ 
      where: { id },
      include: {
        groupMembers: {
          include: {
            group: true
          }
        },
        instalments: {
          include: {
            loan: {
              include: {
                group: true
              }
            }
          },
          orderBy: {
            dueDate: "desc"
          }
        },
        profileImage: true,
        documents: {
          include: { attachment: true }
        }
      }
    });
    if (!client || client.isDeleted) throw createNotFoundError("Client not found");
    return { success: true, client };
  });

  // Delete Client
  fastify.delete("/:id", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params;

      const client = await fastify.prisma.client.findUnique({
        where: { id },
        include: {
          groupMembers: true,
          instalments: true,
          guarantors: true,
        }
      });

      if (!client) throw createNotFoundError("Client not found");

      // Business Logic: Prevent deletion if client is linked to critical data
      if (client.groupMembers.length > 0) {
        throw createBadRequestError("Cannot delete client because they are a member of one or more groups. Remove them from groups first.");
      }

      if (client.instalments.length > 0) {
        throw createBadRequestError("Cannot delete client because they have loan instalments linked to their profile.");
      }

      if (client.guarantors.length > 0) {
        throw createBadRequestError("Cannot delete client because they are acting as a guarantor for one or more loans.");
      }

      await fastify.prisma.client.update({
        where: { id },
        data: { 
          isDeleted: true,
          updatedBy: request.user.id
        }
      });

      // Audit Log
      await fastify.prisma.auditLog.create({
        data: {
          action: "DELETE",
          entity: "CLIENT",
          entityId: client.id,
          userId: request.user.id,
          details: {
            message: `Deleted client ${client.fullname} (${client.clientNo})`,
            before: client
          }
        }
      });

      return { success: true, message: "Client deleted successfully" };
    },
  });
}
