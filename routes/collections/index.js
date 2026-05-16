// routes/collections/index.js
import { createBadRequestError, createNotFoundError } from "../../utils/errors.js";

export default async function collectionRoutes(fastify, opts) {
  // Create Group Collection Entry
  fastify.post("/", {
    schema: {
      body: {
        type: "object",
        required: ["groupId", "date", "instalmentNumber", "collectorId", "amountCollected"],
        properties: {
          groupId: { type: "string" },
          date: { type: "string", format: "date-time" },
          instalmentNumber: { type: "number" },
          collectorId: { type: "string" },
          amountCollected: { type: "number", minimum: 0 },
          bankReference: { type: "string" },
          breakdownNotes: { type: "string" },
        }
      }
    },
    handler: async (request, reply) => {
      const { groupId, date, instalmentNumber, collectorId, payments, bankReference, breakdownNotes } = request.body;

      // 1. Validation
      const group = await fastify.prisma.group.findUnique({
        where: { id: groupId },
      });

      if (!group) throw createNotFoundError("Group not found");
      if (!payments || !Array.isArray(payments)) throw createBadRequestError("Payments list is required");

      const totalAmount = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);

      // 2. Wrap in Transaction
      const result = await fastify.prisma.$transaction(async (tx) => {
        // Create Collection Record
        const collection = await tx.collection.create({
          data: {
            groupId,
            date: new Date(date),
            instalmentNumber,
            collectorId,
            amountCollected: totalAmount,
            bankReference,
            breakdownNotes,
          }
        });

        // Process each member's payment
        for (const pay of payments) {
          let remainingPool = Number(pay.amount);
          if (remainingPool <= 0) continue;

          // Fetch this member's pending instalments (FIFO)
          const pending = await tx.instalment.findMany({
            where: {
              clientId: pay.clientId,
              loan: { groupId },
              status: { in: ["UNPAID", "PARTIAL"] }
            },
            orderBy: [
              { dueDate: "asc" },
              { id: "asc" }
            ]
          });

          for (const inst of pending) {
            if (remainingPool <= 0) break;
            const due = Number(inst.remainingDue);
            
            if (remainingPool >= due) {
              await tx.instalment.update({
                where: { id: inst.id },
                data: {
                  paidAmount: inst.dueAmount,
                  remainingDue: 0,
                  status: "PAID"
                }
              });
              remainingPool -= due;
            } else {
              await tx.instalment.update({
                where: { id: inst.id },
                data: {
                  paidAmount: Number(inst.paidAmount) + remainingPool,
                  remainingDue: due - remainingPool,
                  status: "PARTIAL"
                }
              });
              remainingPool = 0;
            }
          }

          // Advance payments for this member if pool remains
          if (remainingPool > 0) {
            const upcoming = await tx.instalment.findMany({
              where: {
                clientId: pay.clientId,
                loan: { groupId },
                status: "UNPAID"
              },
              orderBy: [
                { dueDate: "asc" },
                { id: "asc" }
              ]
            });

            for (const inst of upcoming) {
              if (remainingPool <= 0) break;
              const due = Number(inst.remainingDue);
              
              if (remainingPool >= due) {
                await tx.instalment.update({
                  where: { id: inst.id },
                  data: {
                    paidAmount: inst.dueAmount,
                    remainingDue: 0,
                    status: "PAID"
                  }
                });
                remainingPool -= due;
              } else {
                await tx.instalment.update({
                  where: { id: inst.id },
                  data: {
                    paidAmount: Number(inst.paidAmount) + remainingPool,
                    remainingDue: due - remainingPool,
                    status: "PARTIAL"
                  }
                });
                remainingPool = 0;
              }
            }
          }
        }

        // 6. Audit Log
        await tx.auditLog.create({
          data: {
            action: "COLLECTION_CREATED",
            entity: "Collection",
            entityId: collection.id,
            userId: collectorId,
            details: {
              totalAmount,
              groupId: groupId,
              paymentCount: payments.length
            }
          }
        });

        return { collection, totalAmount };
      });

      return { success: true, ...result };
    }
  });

  // Get Collections (History)
  fastify.get("/", async (request, reply) => {
    const { groupId } = request.query;
    const where = groupId ? { groupId } : {};
    
    const collections = await fastify.prisma.collection.findMany({
      where,
      include: {
        group: { select: { name: true, branch: true } }
      },
      orderBy: { createdAt: "desc" }
    });

    return { success: true, collections };
  });

  // Get Daily Collection Registry (Expected instalments for a specific day)
  fastify.get("/daily-registry", {
    schema: {
      query: {
        type: "object",
        properties: {
          date: { type: "string", format: "date" },
        }
      }
    },
    handler: async (request, reply) => {
      const { date } = request.query;
      // const targetDate = date ? new Date(date) : new Date();
      const targetDate = "2026-06-07";
      
      const start = new Date(targetDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(targetDate);
      end.setHours(23, 59, 59, 999);

      // 1. Fetch instalments due today
      const instalments = await fastify.prisma.instalment.findMany({
        where: {
          dueDate: {
            gte: start,
            lte: end
          },
          loan: {
            status: { in: ["DRAFT", "PENDING", "APPROVED", "ACTIVE"] }
            // status: "APPROVED" // Only active/approved loans
          }
        },
        include: {
          loan: {
            include: {
              group: {
                include: {
                  members: {
                    include: {
                      client: { select: { fullname: true, phone: true } }
                    }
                  }
                }
              }
            }
          }
        }
      });



      // 2. Group by Group ID
      const grouped = instalments.reduce((acc, inst) => {
        const group = inst.loan.group;
        if (!acc[group.id]) {
          const leader = group.members.find(m => m.isLeader)?.client;
          acc[group.id] = {
            id: group.id,
            groupNo: group.groupNo || "N/A",
            groupName: group.name,
            location: group.branch,
            center: group.center || "Main Center",
            leader: leader?.fullname || "No Leader",
            phone: leader?.phone || "N/A",
            members: group.members.length,
            instalmentNo: inst.weekNumber,
            expected: 0,
            arrears: 0, // Will fetch separately if needed, or simplified here
            collected: 0,
            status: "Pending"
          };
        }
        
        acc[group.id].expected += Number(inst.dueAmount);
        acc[group.id].collected += Number(inst.paidAmount);
        
        return acc;
      }, {});

      // 3. Finalize Status
      const registry = Object.values(grouped).map((g) => {
        if (g.collected >= g.expected) g.status = "Verified";
        else if (g.collected > 0) g.status = "Pending";
        else g.status = "Pending";
        return g;
      });

      return { success: true, date: start.toISOString(), registry };
    }
  });
}
