// routes/loans/index.js
import { createBadRequestError, createNotFoundError } from "../../utils/errors.js";
import { addDays, nextDay, startOfDay } from "date-fns";

export default async function loanRoutes(fastify, opts) {
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
              { loanNo: { contains: search } },
              { group: { name: { contains: search } } }
            ]
          } : {},
          status && status !== "All" ? { status } : {},
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
        include: { members: true },
      });

      if (!group) throw createNotFoundError("Group not found");
      if (group.members.length === 0) throw createBadRequestError("Group has no members");

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

        // Generate Instalments
        const instalments = [];
        const targetDay = group.collectionDay === 7 ? 0 : group.collectionDay;
        let firstDueDate = nextDay(new Date(), targetDay);
        firstDueDate = startOfDay(firstDueDate);

        for (let week = 1; week <= data.totalWeeks; week++) {
          const dueDate = addDays(firstDueDate, (week - 1) * 7);
          for (const member of group.members) {
            const dueAmount = member.isLeader ? data.leaderWeeklyAmount : data.memberWeeklyAmount;
            instalments.push({
              loanId: loan.id,
              clientId: member.clientId,
              weekNumber: week,
              dueDate,
              dueAmount,
              remainingDue: dueAmount,
              status: "UNPAID",
            });
          }
        }

        await tx.instalment.createMany({ data: instalments });

        return { success: true, loan, instalmentCount: instalments.length };
      });
    },
  });

  // Helper function to generate instalments
  const generateInstalments = async (tx, loan, group, totalWeeks, leaderWeeklyAmount, memberWeeklyAmount) => {
    const instalments = [];
    const targetDay = group.collectionDay === 7 ? 0 : group.collectionDay;
    let firstDueDate = nextDay(new Date(loan.createdAt), targetDay);
    firstDueDate = startOfDay(firstDueDate);

    for (let week = 1; week <= totalWeeks; week++) {
      const dueDate = addDays(firstDueDate, (week - 1) * 7);
      for (const member of group.members) {
        const dueAmount = member.isLeader ? leaderWeeklyAmount : memberWeeklyAmount;
        instalments.push({
          loanId: loan.id,
          clientId: member.clientId,
          weekNumber: week,
          dueDate,
          dueAmount,
          remainingDue: dueAmount,
          status: "UNPAID",
        });
      }
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
        // 1. Delete existing instalments and guarantors
        await tx.instalment.deleteMany({ where: { loanId: id } });
        await tx.guarantor.deleteMany({ where: { loanId: id } });

        // 2. Generate new instalments
        const newInstalmentsData = await generateInstalments(
          tx, 
          loan, 
          group, 
          data.totalWeeks, 
          data.leaderWeeklyAmount, 
          data.memberWeeklyAmount
        );

        // 3. Save new instalments and guarantors
        await tx.instalment.createMany({ data: newInstalmentsData });
        if (data.memberGuarantors) {
          for (const item of data.memberGuarantors) {
            await tx.guarantor.createMany({
              data: item.guarantors.map(g => ({
                loanId: id,
                clientId: item.clientId,
                fullname: g.fullname,
                nic: g.nic,
                phone: g.phone,
                address: g.address,
              })),
            });
          }
        }

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

        return { success: true, loan: updatedLoan, instalmentCount: newInstalmentsData.length };
      });
    }
  });

  // Get single loan with instalments and guarantors
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
        guarantors: true,
        instalments: {
          include: {
            client: { select: { fullname: true, clientNo: true } },
          },
          orderBy: [
            { weekNumber: "asc" },
            { clientId: "asc" },
          ],
        },
      },
    });

    if (!loan) throw createNotFoundError("Loan not found");
    return { success: true, loan };
  });

  // Approve Loan
  fastify.put("/:id/approve", {
    schema: {
      params: { type: "object", properties: { id: { type: "string" } } },
      body: {
        type: "object",
        required: ["approvedById"],
        properties: {
          approvedById: { type: "string" },
        }
      }
    },
    handler: async (request, reply) => {
      const { id } = request.params;
      const { approvedById } = request.body;

      const loan = await fastify.prisma.loan.update({
        where: { id },
        data: {
          status: "APPROVED",
          approvedById,
        },
      });

      return { success: true, loan };
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

      const loan = await fastify.prisma.loan.update({
        where: { id },
        data: {
          status: "REJECTED",
          rejectionReason,
        },
      });

      return { success: true, loan };
    },
  });
}
