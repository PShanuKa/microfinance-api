// routes/loans/index.js
import { createBadRequestError, createNotFoundError } from "../../utils/errors.js";
import { addDays, nextDay, startOfDay } from "date-fns";

export default async function loanRoutes(fastify, opts) {
  fastify.addHook("preHandler", fastify.authenticate);

  // Get all loans with pagination
  fastify.get("/", {
    schema: {
      query: {
        type: "object",
        properties: {
          page: { type: "number", default: 1 },
          limit: { type: "number", default: 10 },
          search: { type: "string" },
          status: { type: "string" },
          collectionDay: { type: "number" },
          branchId: { type: "string" },
        },
      },
    },
    handler: async (request, reply) => {
      const { page, limit, search, status, collectionDay, branchId } = request.query;
      const skip = (page - 1) * limit;

      const where = {
        AND: [
          search ? {
            OR: [
              { loanNo: { contains: search } },
              { group: { name: { contains: search } } }
            ]
          } : {},
          status && status !== "All" ? { status } : {},
          collectionDay ? { group: { collectionDay } } : {},
          branchId && branchId !== "All" ? { branchId } : {},
        ],
      };

      const [loans, total] = await Promise.all([
        fastify.prisma.loan.findMany({
          where,
          skip,
          take: limit,
          include: {
            group: { 
              include: { 
                members: {
                  where: { isLeader: true },
                  include: {
                    client: { select: { fullname: true, phone: true } }
                  }
                }
              }
            },
            approvedBy: { select: { fullname: true } },
          },
          orderBy: { createdAt: "desc" },
        }),
        fastify.prisma.loan.count({ where }),
      ]);

      return {
        success: true,
        loans,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    },
  });

  // Create Loan & Generate Instalments
  fastify.post("/", {
    schema: {
      body: {
        type: "object",
        required: [
          "groupId", 
          "leaderLentAmount", 
          "memberLentAmount", 
          "totalWeeks", 
          "leaderWeeklyAmount", 
          "memberWeeklyAmount", 
          "processingFee",
          "createdBy"
        ],
        properties: {
          groupId: { type: "string" },
          leaderLentAmount: { type: "number" },
          memberLentAmount: { type: "number" },
          totalWeeks: { type: "number", minimum: 1 },
          leaderWeeklyAmount: { type: "number" },
          memberWeeklyAmount: { type: "number" },
          processingFee: { type: "number" },
          status: { type: "string" },
          createdBy: { type: "string" },
          memberGuarantors: {
            type: "array",
            items: {
              type: "object",
              required: ["clientId", "guarantors"],
              properties: {
                clientId: { type: "string" },
                guarantors: {
                  type: "array",
                  minItems: 2,
                  maxItems: 2,
                  items: {
                    type: "object",
                    required: ["fullname", "nic", "phone", "address"],
                    properties: {
                      fullname: { type: "string" },
                      nic: { type: "string" },
                      phone: { type: "string" },
                      address: { type: "string" },
                    }
                  }
                }
              }
            }
          }
        },
      },
    },
    handler: async (request, reply) => {
      const data = request.body;

      // 1. Fetch system settings
      let settings = await fastify.prisma.settings.findUnique({ where: { id: "default" } });
      if (!settings) {
        settings = await fastify.prisma.settings.create({ data: { id: "default" } });
      }

      // 2. Validate duration
      if (data.totalWeeks < settings.minLoanWeeks || data.totalWeeks > settings.maxLoanWeeks) {
        throw createBadRequestError(`Loan duration must be between ${settings.minLoanWeeks} and ${settings.maxLoanWeeks} weeks.`);
      }

      const group = await fastify.prisma.group.findUnique({
        where: { id: data.groupId },
        include: {
          members: {
            include: {
              client: {
                include: {
                  instalments: {
                    select: {
                      loan: {
                        select: {
                          id: true,
                          loanNo: true,
                          status: true
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        },
      });

      if (!group) throw createNotFoundError("Group not found");
      if (!group.branchId) {
        throw createBadRequestError("This group is not associated with any branch. A group must have a branch before applying for a loan.");
      }
      if (group.members.length === 0) throw createBadRequestError("Group has no members");

      // Check if any member is Blacklisted or has an active/approved loan
      for (const member of group.members) {
        if (member.client) {
          if (member.client.status === "BLACKLISTED") {
            throw createBadRequestError(`Client ${member.client.fullname} is Blacklisted. Cannot create loan.`);
          }
          
          const activeInstalment = member.client.instalments?.find(
            inst => inst.loan?.status === "APPROVED" || inst.loan?.status === "ACTIVE"
          );
          if (activeInstalment) {
            throw createBadRequestError(`Client ${member.client.fullname} already has an active loan (${activeInstalment.loan.loanNo}). Cannot create loan.`);
          }
        }
      }

      // 3. Check if there's an active loan for this group already (Max Limit)
      const activeLoansCount = await fastify.prisma.loan.count({
        where: { 
          groupId: data.groupId,
          status: { in: ["PENDING", "APPROVED", "ACTIVE"] }
        }
      });
      if (activeLoansCount >= settings.maxActiveLoansGroup) {
        throw createBadRequestError(`This group already has ${activeLoansCount} active or pending loan(s). Limit is ${settings.maxActiveLoansGroup}.`);
      }

      return await fastify.prisma.$transaction(async (tx) => {
        // Generate Loan Number
        const lastLoan = await tx.loan.findFirst({
          orderBy: { createdAt: "desc" },
        });

        let nextNo = 1;
        if (lastLoan && lastLoan.loanNo?.startsWith("L-")) {
          nextNo = parseInt(lastLoan.loanNo.split("-")[1]) + 1;
        }
        const loanNo = `L-${nextNo.toString().padStart(6, "0")}`;

        // Create Loan
        const loan = await tx.loan.create({
          data: {
            loanNo,
            groupId: data.groupId,
            branchId: group.branchId,
            leaderLentAmount: data.leaderLentAmount,
            memberLentAmount: data.memberLentAmount,
            totalWeeks: data.totalWeeks,
            leaderWeeklyAmount: data.leaderWeeklyAmount,
            memberWeeklyAmount: data.memberWeeklyAmount,
            processingFee: data.processingFee,
            status: data.status || "PENDING",
            createdBy: data.createdBy,
          },
        });

        // Save Guarantors
        if (data.memberGuarantors) {
          for (const item of data.memberGuarantors) {
            await tx.guarantor.createMany({
              data: item.guarantors.map(g => ({
                loanId: loan.id,
                clientId: item.clientId,
                fullname: g.fullname,
                nic: g.nic,
                phone: g.phone,
                address: g.address,
              })),
            });
          }
        }

        // Generate Instalments (with non-collection weeks skipped)
        const instalments = await generateInstalments(
          tx,
          loan,
          group,
          data.totalWeeks,
          data.leaderWeeklyAmount,
          data.memberWeeklyAmount,
          addDays(new Date(), 7)
        );

        await tx.instalment.createMany({ data: instalments });

        // Audit Log
        await tx.auditLog.create({
          data: {
            action: "LOAN_CREATE",
            entity: "LOAN",
            entityId: loan.id,
            userId: request.user.id,
            details: { loanNo: loan.loanNo, groupId: loan.groupId }
          }
        });

        return { success: true, loan, instalmentCount: instalments.length };
      });
    },
  });

  // Helper function to generate instalments skipping non-collection weeks
  const generateInstalments = async (tx, loan, group, totalWeeks, leaderWeeklyAmount, memberWeeklyAmount, baseDate = new Date(loan.createdAt)) => {
    // 1. Fetch upcoming non-collection weeks
    const nonCollectionWeeks = await tx.nonCollectionWeek.findMany({
      where: { endDate: { gte: baseDate } }
    });

    const instalments = [];
    const targetDay = group.collectionDay === 7 ? 0 : group.collectionDay;
    let currentDueDate = nextDay(baseDate, targetDay);
    currentDueDate = startOfDay(currentDueDate);

    for (let week = 1; week <= totalWeeks; week++) {
      // 2. Check if currentDueDate falls in any non-collection week and skip
      let isSkipped = true;
      while (isSkipped) {
        isSkipped = nonCollectionWeeks.some(ncw => {
          const start = new Date(ncw.startDate).getTime();
          const end = new Date(ncw.endDate).getTime();
          const curr = currentDueDate.getTime();
          return curr >= start && curr <= end;
        });

        if (isSkipped) {
          currentDueDate = addDays(currentDueDate, 7);
        }
      }

      for (const member of group.members) {
        const dueAmount = member.isLeader ? leaderWeeklyAmount : memberWeeklyAmount;
        instalments.push({
          loanId: loan.id,
          clientId: member.clientId,
          weekNumber: week,
          dueDate: new Date(currentDueDate), // clone date
          dueAmount,
          remainingDue: dueAmount,
          status: "UNPAID",
        });
      }
      
      // 3. Move to next week for the next iteration
      currentDueDate = addDays(currentDueDate, 7);
    }
    return instalments;
  };

  // Update Loan Schedule (All Fields + Guarantors)
  fastify.put("/:id/schedule", {
    schema: {
      params: { type: "object", properties: { id: { type: "string" } } },
      body: {
        type: "object",
        required: [
          "groupId",
          "totalWeeks", 
          "leaderWeeklyAmount", 
          "memberWeeklyAmount",
          "processingFee",
          "leaderLentAmount",
          "memberLentAmount"
        ],
        properties: {
          groupId: { type: "string" },
          totalWeeks: { type: "number", minimum: 1 },
          leaderWeeklyAmount: { type: "number" },
          memberWeeklyAmount: { type: "number" },
          processingFee: { type: "number" },
          leaderLentAmount: { type: "number" },
          memberLentAmount: { type: "number" },
          memberGuarantors: {
            type: "array",
            items: {
              type: "object",
              required: ["clientId", "guarantors"],
              properties: {
                clientId: { type: "string" },
                guarantors: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["fullname", "nic", "phone", "address"],
                    properties: {
                      fullname: { type: "string" },
                      nic: { type: "string" },
                      phone: { type: "string" },
                      address: { type: "string" },
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    preHandler: [fastify.authenticate, fastify.authorize(['ADMIN', 'BRANCH_MANAGER', 'LOAN_OFFICER'])],
      
    handler: async (request, reply) => {

      const { id } = request.params;
      const data = request.body;

      // 1. Fetch system settings
      let settings = await fastify.prisma.settings.findUnique({ where: { id: "default" } });
      if (!settings) settings = { minLoanWeeks: 4, maxLoanWeeks: 52 };

      // 2. Validate duration
      if (data.totalWeeks < settings.minLoanWeeks || data.totalWeeks > settings.maxLoanWeeks) {
        throw createBadRequestError(`Loan duration must be between ${settings.minLoanWeeks} and ${settings.maxLoanWeeks} weeks.`);
      }

      const loan = await fastify.prisma.loan.findUnique({
        where: { id },
      });
      

      if (!loan) throw createNotFoundError("Loan not found");
      
      if (loan.status !== "PENDING" && loan.status !== "DRAFT") throw createBadRequestError("Only pending or draft loans can be edited");

      const group = await fastify.prisma.group.findUnique({
        where: { id: data.groupId },
        include: { members: true }
      });
      if (!group) throw createNotFoundError("Group not found");

      return await fastify.prisma.$transaction(async (tx) => {
        // 1. Delete existing instalments
        await tx.instalment.deleteMany({ where: { loanId: id } });

        // 2. Generate new instalments
        const newInstalmentsData = await generateInstalments(
          tx, 
          loan, 
          group, 
          data.totalWeeks, 
          data.leaderWeeklyAmount, 
          data.memberWeeklyAmount
        );

        // 3. Save new instalments
        await tx.instalment.createMany({ data: newInstalmentsData });

        // 4. Update loan record
        const updatedLoan = await tx.loan.update({
          where: { id },
          data: {
            groupId: data.groupId,
            totalWeeks: data.totalWeeks,
            leaderWeeklyAmount: data.leaderWeeklyAmount,
            memberWeeklyAmount: data.memberWeeklyAmount,
            processingFee: data.processingFee,
            leaderLentAmount: data.leaderLentAmount,
            memberLentAmount: data.memberLentAmount,
          }
        });

        // Audit Log
        await tx.auditLog.create({
          data: {
            action: "LOAN_SCHEDULE_UPDATE",
            entity: "LOAN",
            entityId: id,
            userId: request.user.id,
            details: { 
              totalWeeks: data.totalWeeks, 
              leaderWeekly: data.leaderWeeklyAmount, 
              memberWeekly: data.memberWeeklyAmount 
            }
          }
        });

        return { success: true, loan: updatedLoan, instalmentCount: newInstalmentsData.length };
      });
    }
  });

  // Update Single Loan Guarantor (by member and index)
  fastify.put("/:id/guarantors", {
    schema: {
      params: { type: "object", properties: { id: { type: "string" } } },
      body: {
        type: "object",
        required: ["clientId", "index", "guarantor"],
        properties: {
          clientId: { type: "string" },
          index: { type: "integer", minimum: 0, maximum: 1 },
          guarantor: {
            type: "object",
            required: ["fullname", "nic", "phone", "address"],
            properties: {
              fullname: { type: "string" },
              nic: { type: "string" },
              phone: { type: "string" },
              address: { type: "string" },
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
            }
          }
        }
      }
    },
    handler: async (request, reply) => {
      const { id } = request.params;
      const { clientId, index, guarantor: gData } = request.body;

      await fastify.prisma.$transaction(async (tx) => {
        // 1. Delete existing guarantor at this index for this member/loan
        // We delete documents first (automatic due to Cascade in schema)
        await tx.guarantor.deleteMany({
          where: {
            loanId: id,
            clientId: clientId,
            index: index
          }
        });

        // 2. Create new one
        const { documents, ...guarantorData } = gData;
        const guarantor = await tx.guarantor.create({
          data: {
            ...guarantorData,
            loanId: id,
            clientId: clientId,
            index: index,
            documents: documents ? {
              create: documents.map(doc => ({
                attachmentId: doc.attachmentId,
                type: doc.type
              }))
            } : undefined
          }
        });

        // Audit Log
        await tx.auditLog.create({
          data: {
            action: "LOAN_GUARANTOR_UPDATE",
            entity: "LOAN",
            entityId: id,
            userId: request.user.id,
            details: { clientId, index, guarantorName: guarantorData.fullname }
          }
        });
      });

      return { success: true };
    }
  });

  // Delete Single Loan Guarantor
  fastify.delete("/:id/guarantors/:clientId/:index", {
    schema: {
      params: {
        type: "object",
        properties: {
          id: { type: "string" },
          clientId: { type: "string" },
          index: { type: "integer" }
        }
      }
    },
    handler: async (request, reply) => {
      const { id, clientId, index } = request.params;

      await fastify.prisma.$transaction(async (tx) => {
        await tx.guarantor.deleteMany({
          where: {
            loanId: id,
            clientId: clientId,
            index: Number(index)
          }
        });

        // Audit Log
        await tx.auditLog.create({
          data: {
            action: "LOAN_GUARANTOR_DELETE",
            entity: "LOAN",
            entityId: id,
            userId: request.user.id,
            details: { clientId, index: Number(index) }
          }
        });
      });

      return { success: true };
    }
  });

  // Get single loan without instalments
  fastify.get("/:id", async (request, reply) => {
    const { id } = request.params;
    const loan = await fastify.prisma.loan.findUnique({
      where: { id },
      include: {
        group: {
          include: {
            officer: { select: { fullname: true } },
            members: {
              include: {
                client: { select: { fullname: true, clientNo: true, phone: true } }
              }
            }
          },
        },
        approvedBy: { select: { fullname: true } },
        guarantors: {
          include: {
            documents: {
              include: {
                attachment: true
              }
            }
          }
        },
      },
    });

    if (!loan) throw createNotFoundError("Loan not found");
    return { success: true, loan };
  });

  // Get loan instalments separately
  fastify.get("/:id/instalments", async (request, reply) => {
    const { id } = request.params;
    const instalments = await fastify.prisma.instalment.findMany({
      where: { loanId: id },
      include: {
        client: { select: { fullname: true, clientNo: true } },
      },
      orderBy: [
        { weekNumber: "asc" },
        { clientId: "asc" },
      ],
    });

    return { success: true, instalments };
  });

  // Approve Loan
  fastify.put("/:id/approve", {
    schema: {
      params: { type: "object", properties: { id: { type: "string" } } },
    },
    handler: async (request, reply) => {
      const { id } = request.params;
      const approvedById = request.user.id;

      return await fastify.prisma.$transaction(async (tx) => {
        // 1. Fetch loan and group details
        const existingLoan = await tx.loan.findUnique({
          where: { id },
          include: {
            group: {
              include: {
                members: true
              }
            }
          }
        });

        if (!existingLoan) {
          throw createNotFoundError(`Loan ${id} not found`);
        }

        // 2. Delete existing instalments
        await tx.instalment.deleteMany({
          where: { loanId: id }
        });

        // 3. Generate new instalments starting with baseDate = next week (add 7 days)
        const instalments = await generateInstalments(
          tx,
          existingLoan,
          existingLoan.group,
          existingLoan.totalWeeks,
          existingLoan.leaderWeeklyAmount,
          existingLoan.memberWeeklyAmount,
          addDays(new Date(), 7)
        );

        // 4. Insert rescheduled instalments
        await tx.instalment.createMany({ data: instalments });

        // 5. Update loan status to APPROVED
        const loan = await tx.loan.update({
          where: { id },
          data: {
            status: "APPROVED",
            approvedById,
          },
        });

        // 6. Write Audit Log
        await tx.auditLog.create({
          data: {
            action: "LOAN_APPROVE",
            entity: "LOAN",
            entityId: id,
            userId: request.user.id,
            details: { loanNo: loan.loanNo, approvedBy: approvedById }
          }
        });

        return { success: true, loan, instalmentCount: instalments.length };
      });
    },
  });

  // Reject Loan
  fastify.put("/:id/reject", {
    schema: {
      params: { type: "object", properties: { id: { type: "string" } } },
      body: {
        type: "object",
        required: ["rejectionReason"],
        properties: {
          rejectionReason: { type: "string" },
        }
      }
    },
    handler: async (request, reply) => {
      const { id } = request.params;
      const { rejectionReason } = request.body;

      return await fastify.prisma.$transaction(async (tx) => {
        const loan = await tx.loan.update({
          where: { id },
          data: {
            status: "REJECTED",
            rejectionReason,
          },
        });

        await tx.auditLog.create({
          data: {
            action: "LOAN_REJECT",
            entity: "LOAN",
            entityId: id,
            userId: request.user.id,
            details: { loanNo: loan.loanNo, reason: rejectionReason }
          }
        });

        return { success: true, loan };
      });
    },
  });

  // Update Loan Status (Generic)
  fastify.patch("/:id/status", {
    schema: {
      params: { type: "object", properties: { id: { type: "string" } } },
      body: {
        type: "object",
        required: ["status"],
        properties: {
          status: { type: "string" },
          approvedById: { type: "string" },
          rejectionReason: { type: "string" },
        }
      }
    },
    handler: async (request, reply) => {
      const { id } = request.params;
      const { status, approvedById, rejectionReason } = request.body;

      return await fastify.prisma.$transaction(async (tx) => {
        const loan = await tx.loan.update({
          where: { id },
          data: {
            status,
            approvedById: approvedById || undefined,
            rejectionReason: rejectionReason || undefined,
          },
        });

        await tx.auditLog.create({
          data: {
            action: "LOAN_STATUS_UPDATE",
            entity: "LOAN",
            entityId: id,
            userId: request.user.id,
            details: { status, loanNo: loan.loanNo }
          }
        });

        return { success: true, loan };
      });
    },
  });
}
