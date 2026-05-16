// routes/collections/index.js
import { createBadRequestError, createNotFoundError } from "../../utils/errors.js";

export default async function collectionRoutes(fastify, opts) {
  // Create Group Collection Entry
  fastify.post("/", {
    schema: {
      body: {
        type: "object",
        required: ["groupId", "date", "instalmentNumber", "collectorId"],
        properties: {
          groupId: { type: "string" },
          loanId: { type: "string" },
          date: { type: "string", format: "date-time" },
          instalmentNumber: { type: "number" },
          collectorId: { type: "string" },
          bankReference: { type: "string" },
          breakdownNotes: { type: "string" },
          breakdownData: { 
            type: "array",
            items: {
              type: "object",
              required: ["instalmentId", "amount"],
              properties: {
                instalmentId: { type: "string" },
                amount: { type: "number" },
                memberName: { type: "string" }
              }
            }
          }
        }
      }
    },
    handler: async (request, reply) => {
      const { groupId, loanId, date, instalmentNumber, collectorId, breakdownData, bankReference, breakdownNotes } = request.body;

      // 1. Validation
      const group = await fastify.prisma.group.findUnique({
        where: { id: groupId },
      });

      if (!group) throw createNotFoundError("Group not found");
      if (!breakdownData || !Array.isArray(breakdownData)) throw createBadRequestError("Breakdown data is required");

      const totalAmount = breakdownData.reduce((sum, p) => sum + Number(p.amount || 0), 0);

      // 2. Wrap in Transaction
      const result = await fastify.prisma.$transaction(async (tx) => {
        // Create Collection Record with nested items
        const collection = await tx.collection.create({
          data: {
            groupId,
            loanId,
            date: new Date(date),
            instalmentNumber,
            collectorId,
            amountCollected: totalAmount,
            bankReference,
            breakdownNotes,
            items: {
              create: breakdownData.map(item => ({
                instalmentId: item.instalmentId,
                amount: Number(item.amount)
              }))
            }
          }
        });

        // Update each specified instalment
        for (const item of breakdownData) {
          const amount = Number(item.amount);
          if (amount <= 0) continue;

          const inst = await tx.instalment.findUnique({
            where: { id: item.instalmentId }
          });

          if (!inst) continue;

          const currentPaid = Number(inst.paidAmount);
          const newPaid = currentPaid + amount;
          const remaining = Number(inst.dueAmount) - newPaid;

          await tx.instalment.update({
            where: { id: inst.id },
            data: {
              paidAmount: newPaid,
              remainingDue: remaining > 0 ? remaining : 0,
              status: newPaid >= Number(inst.dueAmount) ? "PAID" : "PARTIAL"
            }
          });
        }

        // 3. Audit Log
        await tx.auditLog.create({
          data: {
            action: "COLLECTION_CREATED",
            entity: "Collection",
            entityId: collection.id,
            userId: collectorId,
            details: {
              totalAmount,
              groupId: groupId,
              loanId: loanId,
              itemCount: breakdownData.length
            }
          }
        });

        return collection;
      });

      return { success: true, collection: result };
    }
  });

  // Get Collections (History)
  fastify.get("/", async (request, reply) => {
    const { groupId } = request.query;
    const where = groupId ? { groupId } : {};
    
    const collections = await fastify.prisma.collection.findMany({
      where,
      include: {
        group: { select: { name: true, branch: true, groupNo: true, leaderName: true, phone: true, memberCount: true } }
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
          loanId: { type: "string" },
        }
      }
    },
    handler: async (request, reply) => {
      const { date, loanId } = request.query;
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
          loanId: loanId || undefined,
          loan: {
            status: { in: ["DRAFT", "PENDING", "APPROVED", "ACTIVE"] }
          }
        },
        include: {
          client: { select: { fullname: true, clientNo: true } },
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

      // 2. Group by Loan ID (Each row in registry is a Loan)
      const grouped = instalments.reduce((acc, inst) => {
        const currentLoanId = inst.loanId;
        if (!acc[currentLoanId]) {
          const group = inst.loan.group;
          const leader = group.members.find(m => m.isLeader)?.client;
          acc[currentLoanId] = {
            id: currentLoanId,
            groupId: group.id,
            loanId: currentLoanId,
            loanNo: inst.loan.loanNo,
            groupNo: group.groupNo || "N/A",
            groupName: group.name,
            location: group.branch,
            center: group.center || "Main Center",
            leader: leader?.fullname || "No Leader",
            phone: leader?.phone || "N/A",
            members: group.members.length,
            instalmentNo: inst.weekNumber,
            expected: 0,
            arrears: 0,
            collected: 0,
            status: "Pending"
          };
        }
        
        acc[currentLoanId].expected += Number(inst.dueAmount);
        acc[currentLoanId].collected += Number(inst.paidAmount);
        
        return acc;
      }, {});

      // 3. Finalize Status
      const registry = Object.values(grouped).map((g) => {
        if (g.collected >= g.expected) g.status = "Verified";
        else if (g.collected > 0) g.status = "Pending";
        else g.status = "Pending";
        return g;
      });

      return { 
        success: true, 
        date: start.toISOString(), 
        registry,
        instalments: loanId ? instalments.map(i => ({
          id: i.id,
          weekNumber: i.weekNumber,
          dueAmount: Number(i.dueAmount),
          paidAmount: Number(i.paidAmount),
          status: i.status,
          memberName: i.client.fullname,
          clientNo: i.client.clientNo
        })) : []
      };
    }
  });
}
