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
        const finalItems = [];

        for (const item of breakdownData) {
          if (Number(item.amount) <= 0) {
            finalItems.push({
              instalmentId: item.instalmentId,
              amount: 0
            });
            continue;
          }

          const targetInstalment = await tx.instalment.findUnique({
            where: { id: item.instalmentId },
            select: { clientId: true, loanId: true }
          });

          if (!targetInstalment) {
            throw createNotFoundError(`Instalment ${item.instalmentId} not found`);
          }

          // Fetch all instalments for this client and loan, ordered by weekNumber ASC
          const allInstalments = await tx.instalment.findMany({
            where: {
              clientId: targetInstalment.clientId,
              loanId: targetInstalment.loanId,
            },
            orderBy: { weekNumber: "asc" }
          });

          let remainingPayment = Number(item.amount);
          const allocatedItems = [];

          for (const inst of allInstalments) {
            if (remainingPayment <= 0) break;

            const due = Number(inst.dueAmount);
            const paid = Number(inst.paidAmount);
            const remaining = due - paid;

            if (remaining > 0) {
              const allocate = Math.min(remainingPayment, remaining);
              allocatedItems.push({
                instalmentId: inst.id,
                amount: allocate
              });
              remainingPayment -= allocate;
            }
          }

          // If there is still extra payment, allocate it to the last instalment
          if (remainingPayment > 0 && allInstalments.length > 0) {
            if (allocatedItems.length > 0) {
              allocatedItems[allocatedItems.length - 1].amount += remainingPayment;
            } else {
              const lastInst = allInstalments[allInstalments.length - 1];
              allocatedItems.push({
                instalmentId: lastInst.id,
                amount: remainingPayment
              });
            }
          }

          finalItems.push(...allocatedItems);
        }

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
              create: finalItems.map(item => ({
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

  // Get Single Collection Details
  fastify.get("/:id", async (request, reply) => {
    const { id } = request.params;
    
    const collection = await fastify.prisma.collection.findUnique({
      where: { id },
      include: {
        group: true,
        loan: true,
        items: {
          include: {
            instalment: {
              include: { client: { select: { fullname: true, clientNo: true } } }
            }
          }
        }
      }
    });

    if (!collection) throw createNotFoundError("Collection not found");

    return { success: true, collection };
  });

  // Approve Collection
  fastify.post("/:id/approve", async (request, reply) => {
    const { id } = request.params;
    const { approverId = "ADMIN", confirmOverpayment } = request.body || {};

    // 1. Get collection and items to check for overpayments/conflicts
    const collectionData = await fastify.prisma.collection.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            instalment: {
              include: { client: { select: { fullname: true } } }
            }
          }
        }
      }
    });

    if (!collectionData) throw createNotFoundError("Collection not found");
    if (collectionData.status !== "SUBMITTED") throw createBadRequestError("Collection is already processed");

    const conflicts = [];
    for (const item of collectionData.items) {
      const inst = await fastify.prisma.instalment.findUnique({
        where: { id: item.instalmentId }
      });

      if (inst) {
        const remaining = Number(inst.dueAmount) - Number(inst.paidAmount);
        if (inst.status === "PAID" || remaining < Number(item.amount)) {
          conflicts.push({
            memberName: item.instalment.client?.fullname || "Unknown",
            weekNumber: inst.weekNumber,
            status: inst.status,
            itemAmount: Number(item.amount),
            remainingDue: remaining
          });
        }
      }
    }

    if (conflicts.length > 0 && !confirmOverpayment) {
      return {
        success: false,
        code: "OVERPAYMENT_DETECTED",
        message: "Some weeks are already paid. Extra money will be applied to the upcoming weeks.",
        conflicts
      };
    }

    const result = await fastify.prisma.$transaction(async (tx) => {
      // Fetch collection inside transaction
      const collection = await tx.collection.findUnique({
        where: { id },
        include: {
          items: {
            include: { instalment: true }
          }
        }
      });

      if (!collection) throw createNotFoundError("Collection not found");
      if (collection.status !== "SUBMITTED") throw createBadRequestError("Collection is already processed");

      // Group items by client to calculate their total payment in this collection
      const clientPayments = {};
      for (const item of collection.items) {
        const clientId = item.instalment.clientId;
        const loanId = item.instalment.loanId;
        if (!clientPayments[clientId]) {
          clientPayments[clientId] = {
            clientId,
            loanId,
            totalAmount: 0,
            itemIds: []
          };
        }
        clientPayments[clientId].totalAmount += Number(item.amount);
        clientPayments[clientId].itemIds.push(item.id);
      }

      // Re-allocate payments for each client to make sure it matches the CURRENT database state
      for (const clientId of Object.keys(clientPayments)) {
        const payment = clientPayments[clientId];

        // Fetch all instalments for this client and loan, ordered by weekNumber ASC
        const allInstalments = await tx.instalment.findMany({
          where: {
            clientId: payment.clientId,
            loanId: payment.loanId,
          },
          orderBy: { weekNumber: "asc" }
        });

        let remainingPayment = payment.totalAmount;
        const newAllocations = [];

        for (const inst of allInstalments) {
          if (remainingPayment <= 0) break;

          const due = Number(inst.dueAmount);
          const paid = Number(inst.paidAmount);
          const remaining = due - paid;

          if (remaining > 0) {
            const allocate = Math.min(remainingPayment, remaining);
            newAllocations.push({
              instalmentId: inst.id,
              amount: allocate
            });
            remainingPayment -= allocate;
          }
        }

        // If there is still extra payment, allocate it to the last instalment
        if (remainingPayment > 0 && allInstalments.length > 0) {
          if (newAllocations.length > 0) {
            newAllocations[newAllocations.length - 1].amount += remainingPayment;
          } else {
            const lastInst = allInstalments[allInstalments.length - 1];
            newAllocations.push({
              instalmentId: lastInst.id,
              amount: remainingPayment
            });
          }
        }

        // Delete existing items for this client in this collection
        await tx.collectionItem.deleteMany({
          where: {
            id: { in: payment.itemIds }
          }
        });

        // Re-create the collection items with the new allocations
        for (const alloc of newAllocations) {
          await tx.collectionItem.create({
            data: {
              collectionId: id,
              instalmentId: alloc.instalmentId,
              amount: Number(alloc.amount),
              status: "APPROVED"
            }
          });
        }

        // Update the instalments' paid amount, remaining due, and status
        for (const alloc of newAllocations) {
          const inst = await tx.instalment.findUnique({
            where: { id: alloc.instalmentId }
          });

          if (inst) {
            const currentPaid = Number(inst.paidAmount);
            const newPaid = currentPaid + Number(alloc.amount);
            const remaining = Number(inst.dueAmount) - newPaid;

            await tx.instalment.update({
              where: { id: inst.id },
              data: {
                paidAmount: newPaid,
                remainingDue: remaining > 0 ? remaining : 0,
                status: newPaid >= Number(inst.dueAmount) ? "PAID" : 
                        newPaid > 0 ? "PARTIAL" : "UNPAID"
              }
            });
          }
        }
      }

      // Update Collection status
      await tx.collection.update({
        where: { id },
        data: { status: "APPROVED" }
      });

      // Audit Log
      await tx.auditLog.create({
        data: {
          action: "COLLECTION_APPROVED",
          entity: "Collection",
          entityId: id,
          userId: approverId
        }
      });

      return { success: true };
    });

    return result;
  });

  // Reject Collection
  fastify.post("/:id/reject", async (request, reply) => {
    const { id } = request.params;
    const { rejecterId = "ADMIN" } = request.body || {};

    const result = await fastify.prisma.$transaction(async (tx) => {
      const collection = await tx.collection.findUnique({ where: { id } });
      if (!collection) throw createNotFoundError("Collection not found");
      if (collection.status !== "SUBMITTED") throw createBadRequestError("Collection is already processed");

      await tx.collection.update({
        where: { id },
        data: { status: "REJECTED" }
      });

      await tx.collectionItem.updateMany({
        where: { collectionId: id },
        data: { status: "REJECTED" }
      });

      await tx.auditLog.create({
        data: {
          action: "COLLECTION_REJECTED",
          entity: "Collection",
          entityId: id,
          userId: rejecterId
        }
      });

      return { success: true };
    });

    return result;
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
          g.status = "PAID";
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
