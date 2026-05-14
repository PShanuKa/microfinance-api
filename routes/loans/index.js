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
            group: { name: { contains: search } }
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
            group: { select: { name: true, branch: true } },
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
        },
      },
    },
    handler: async (request, reply) => {
      const data = request.body;

      const group = await fastify.prisma.group.findUnique({
        where: { id: data.groupId },
        include: { members: true },
      });

      if (!group) throw createNotFoundError("Group not found");
      if (group.members.length === 0) throw createBadRequestError("Group has no members");

      // Check if there's an active loan for this group already
      const activeLoan = await fastify.prisma.loan.findFirst({
        where: { 
          groupId: data.groupId,
          status: { in: ["PENDING", "APPROVED"] }
        }
      });
      if (activeLoan) throw createBadRequestError("This group already has an active or pending loan");

      // Create Loan
      const loan = await fastify.prisma.loan.create({
        data: {
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

      // Generate Instalments
      const instalments = [];
      
      // Calculate first payment date (next occurrence of collectionDay)
      // Prisma collectionDay is 1 (Mon) to 7 (Sun). 
      // date-fns nextDay uses 0 (Sun) to 6 (Sat).
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

      // Bulk create instalments
      await fastify.prisma.instalment.createMany({
        data: instalments,
      });

      return { success: true, loan, instalmentCount: instalments.length };
    },
  });

  // Helper function to generate instalments
  const generateInstalments = async (prisma, loan, group, totalWeeks, leaderWeeklyAmount, memberWeeklyAmount) => {
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

  // Update Loan Schedule (All Fields)
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
        }
      }
    },
    handler: async (request, reply) => {
      const { id } = request.params;
      const data = request.body;

      const loan = await fastify.prisma.loan.findUnique({
        where: { id },
      });

      if (!loan) throw createNotFoundError("Loan not found");
      if (loan.status !== "PENDING") throw createBadRequestError("Only pending loans can be edited");

      // Fetch the group (either existing or new one)
      const group = await fastify.prisma.group.findUnique({
        where: { id: data.groupId },
        include: { members: true }
      });
      if (!group) throw createNotFoundError("Group not found");
      if (group.members.length === 0) throw createBadRequestError("Selected group has no members");

      return await fastify.prisma.$transaction(async (tx) => {
        // 1. Delete existing instalments
        await tx.instalment.deleteMany({ where: { loanId: id } });

        // 2. Generate new instalments with potentially new group/amounts
        const newInstalmentsData = await generateInstalments(
          tx, 
          loan, 
          group, 
          data.totalWeeks, 
          data.leaderWeeklyAmount, 
          data.memberWeeklyAmount
        );

        // 3. Create new instalments
        await tx.instalment.createMany({ data: newInstalmentsData });

        // 4. Update loan record with all new fields
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

  // Get single loan with instalments
  fastify.get("/:id", async (request, reply) => {
    const { id } = request.params;
    const loan = await fastify.prisma.loan.findUnique({
      where: { id },
      include: {
        group: {
          include: {
            officer: { select: { fullname: true } },
          },
        },
        approvedBy: { select: { fullname: true } },
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
