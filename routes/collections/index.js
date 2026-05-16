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
          weekNumber: { type: "number" },
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
      const { groupId, loanId, date, weekNumber, instalmentNumber, collectorId, breakdownData, bankReference, breakdownNotes } = request.body;

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
            weekNumber,
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
    
    const collectionsData = await fastify.prisma.collection.findMany({
      where,
      include: {
        group: { 
          include: {
            members: {
              include: { client: { select: { fullname: true, phone: true } } }
            }
          }
        }
      },
      orderBy: { createdAt: "desc" }
    });

    // Map data to include computed fields for frontend
    const collections = collectionsData.map(col => {
      const group = col.group;
      const leader = group.members.find(m => m.isLeader)?.client;
      
      return {
        ...col,
        groupNo: group.groupNo,
        groupName: group.name,
        location: group.branch,
        center: group.location || "Main Center",
        leader: leader?.fullname || "No Leader",
        phone: leader?.phone || "N/A",
        members: group.members.length,
        amountCollected: Number(col.amountCollected)
      };
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
      const targetDate = "2026-06-14";
      
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
          collectionItems: {
            where: { status: "SUBMITTED" }
          },
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
            center: group.location || "Main Center",
            leader: leader?.fullname || "No Leader",
            phone: leader?.phone || "N/A",
            members: group.members.length,
            instalmentNo: inst.weekNumber,
            expected: 0,
            collected: 0,
            hasPending: false,
            allPaid: true,
            allUnpaid: true,
            status: "Pending"
          };
        }
        
        acc[currentLoanId].expected += Number(inst.dueAmount);
        
        const pendingTotal = inst.collectionItems.reduce((sum, item) => sum + Number(item.amount), 0);
        if (pendingTotal > 0) acc[currentLoanId].hasPending = true;

        const effectivePaid = inst.status === "UNPAID" ? pendingTotal : Number(inst.paidAmount);
        acc[currentLoanId].collected += effectivePaid;

        // Track statuses for final classification
        if (inst.status !== "PAID") acc[currentLoanId].allPaid = false;
        if (effectivePaid > 0 || inst.status !== "UNPAID") acc[currentLoanId].allUnpaid = false;
        
        return acc;
      }, {});

      // 3. Finalize Status
      const registry = Object.values(grouped).map((g) => {
        if (g.hasPending) {
          g.status = "PENDING_APPROVAL";
        } else if (g.allPaid) {
          g.status = "Verified";
        } else if (g.allUnpaid) {
          g.status = "UNPAID";
        } else {
          g.status = "PARTIAL";
        }
        
        // Clean up internal tracking fields
        delete g.hasPending;
        delete g.allPaid;
        delete g.allUnpaid;
        
        return g;
      });

      return { 
        success: true, 
        date: start.toISOString(), 
        registry,
        instalments: loanId ? instalments.map(i => {
          const pendingTotal = i.collectionItems.reduce((sum, item) => sum + Number(item.amount), 0);
          const effectivePaid = i.status === "UNPAID" ? pendingTotal : Number(i.paidAmount);
          
          // If there's a submitted collection for an unpaid instalment, mark status as Pending
          let effectiveStatus = i.status;
          if (i.status === "UNPAID" && pendingTotal > 0) {
            effectiveStatus = "Pending";
          }

          return {
            id: i.id,
            weekNumber: i.weekNumber,
            dueAmount: Number(i.dueAmount),
            paidAmount: effectivePaid,
            status: effectiveStatus,
            memberName: i.client.fullname,
            clientNo: i.client.clientNo
          };
        }) : []
      };
    }
  });
}
