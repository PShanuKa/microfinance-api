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
}
