// routes/clients/index.js
import { createBadRequestError, createNotFoundError } from "../../utils/errors.js";

export default async function clientRoutes(fastify, opts) {
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
          job: { type: "string" },
          status: { type: "string", enum: ["ACTIVE", "INACTIVE", "BLACKLISTED"] },
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
      const { fullname, nic, phone, address, job, status, profileImageId } = request.body;

      const existingClient = await fastify.prisma.client.findUnique({
        where: { nic },
      });

      if (existingClient) {
        throw createBadRequestError("Client with this NIC already exists");
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
          profileImageId,
        },
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
      if (!client) throw createNotFoundError("Client not found");

      // Check if NIC is being updated and if it already exists
      if (data.nic && data.nic !== client.nic) {
        const existingNic = await fastify.prisma.client.findUnique({
          where: { nic: data.nic },
        });
        if (existingNic) {
          throw createBadRequestError("NIC already in use by another client");
        }
      }

      const updatedClient = await fastify.prisma.client.update({
        where: { id },
        data,
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
        profileImage: true
      }
    });
    if (!client) throw createNotFoundError("Client not found");
    return { success: true, client };
  });
}
