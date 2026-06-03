// routes/loans/index.js
import { createBadRequestError, createNotFoundError } from "../../utils/errors.js";
import { addDays, nextDay, startOfDay } from "date-fns";
import { generateLoanPdf } from "../../services/pdfGenerator.js";
import { excelExportService } from "../../services/excelExportService.js";
import { formatDateSL } from "../../utils/dateHelpers.js";

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

  // Export Batch Loans to Excel
  fastify.get("/export-batch-excel", {
    schema: {
      query: {
        type: "object",
        properties: {
          search: { type: "string" },
          status: { type: "string" },
          collectionDay: { type: "number" },
          branchId: { type: "string" },
        },
      },
    },
    handler: async (request, reply) => {
      try {
        const { search, status, collectionDay, branchId } = request.query;

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

        const loans = await fastify.prisma.loan.findMany({
          where,
          include: {
            group: {
              include: {
                members: {
                  include: {
                    client: true
                  }
                }
              }
            },
            instalments: {
              include: {
                client: true,
                collectionItems: true
              },
              orderBy: [
                { clientId: 'asc' },
                { weekNumber: 'asc' }
              ]
            }
          },
          orderBy: { createdAt: "desc" },
        });

        const buffer = await excelExportService.generateBatchGroupLoanInterestPayments(fastify, loans);

        reply
          .header("Content-Disposition", `attachment; filename=Batch_GroupLoans_Interest_Payments.xlsx`)
          .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
          .send(buffer);
      } catch (error) {
        request.log.error(error);
        throw createBadRequestError("Failed to generate batch excel export");
      }
    }
  });

  // Export Batch Loan Information to Excel
  fastify.get("/export-batch-info-excel", {
    schema: {
      query: {
        type: "object",
        properties: {
          search: { type: "string" },
          status: { type: "string" },
          collectionDay: { type: "number" },
          branchId: { type: "string" },
        },
      },
    },
    handler: async (request, reply) => {
      try {
        const { search, status, collectionDay, branchId } = request.query;

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

        const loans = await fastify.prisma.loan.findMany({
          where,
          include: {
            group: {
              include: {
                members: {
                  include: {
                    client: true
                  }
                }
              }
            },
            instalments: {
              include: {
                client: true,
                collectionItems: true
              },
              orderBy: [
                { clientId: 'asc' },
                { weekNumber: 'asc' }
              ]
            },
            approvedBy: true
          },
          orderBy: { createdAt: "desc" },
        });

        const buffer = await excelExportService.generateBatchGroupLoanInformation(fastify, loans);

        reply
          .header("Content-Disposition", `attachment; filename=Batch_GroupLoans_Information.xlsx`)
          .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
          .send(buffer);
      } catch (error) {
        request.log.error(error);
        throw createBadRequestError("Failed to generate batch excel export");
      }
    }
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

  // Complete Loan
  fastify.post("/:id/complete", async (request, reply) => {
    const { id } = request.params;
    
    // Role check directly from JWT payload
    const allowedRoles = ["ADMIN", "BRANCH_MANAGER", "APPROVER"];
    if (!(request.user.roles || []).some(role => allowedRoles.includes(role))) {
      throw createBadRequestError("You do not have permission to complete loans.");
    }

    const loan = await fastify.prisma.loan.findUnique({
      where: { id },
      include: { instalments: true }
    });

    if (!loan) throw createNotFoundError("Loan not found");
    if (loan.status !== "ACTIVE" && loan.status !== "APPROVED") {
      throw createBadRequestError("Only active or approved loans can be completed");
    }

    // Verify balance is 0
    const remainingDue = loan.instalments.reduce((sum, inst) => sum + Number(inst.remainingDue), 0);
    if (remainingDue > 0) {
      throw createBadRequestError("Cannot complete loan: there is still an outstanding balance.");
    }

    await fastify.prisma.$transaction(async (tx) => {
      await tx.loan.update({
        where: { id },
        data: { status: "COMPLETED", completedAt: new Date() }
      });
      await tx.auditLog.create({
        data: {
          action: "LOAN_COMPLETED",
          entity: "LOAN",
          entityId: id,
          userId: request.user.id
        }
      });
    });

    return { success: true, message: "Loan marked as completed." };
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

  // Export Loan to PDF
  fastify.get("/:id/export/pdf", async (request, reply) => {
    const { id } = request.params;
    
    // Fetch full loan details including all nested data
    const loan = await fastify.prisma.loan.findUnique({
      where: { id },
      include: {
        group: {
          include: {
            officer: { select: { fullname: true } },
            branch: { select: { name: true, address: true } },
            members: {
              include: {
                client: { select: { fullname: true, nic: true, phone: true } }
              }
            }
          }
        },
        instalments: {
          include: {
            client: { select: { fullname: true } }
          },
          orderBy: { weekNumber: "asc" }
        }
      }
    });

    if (!loan) throw createNotFoundError("Loan not found");

    // We need the client details. A loan belongs to a group, and the group has members. 
    // Wait, the instalments have clientIds. Or we can just get the leader/member info.
    // For simplicity, let's fetch the group members' clients and find the main client if it's a member loan.
    // Actually, "Loan Details" usually apply to the whole group, or we can just list the loan info.
    // Let's pass the raw loan data to the generator.
    
    // Gather all collections for this loan
    const collections = await fastify.prisma.collectionItem.findMany({
      where: { instalment: { loanId: id } },
      include: {
        collection: { select: { date: true, collector: { select: { fullname: true } } } },
        instalment: { include: { client: { select: { fullname: true } } } }
      },
      orderBy: { collection: { date: "desc" } }
    });

    const flatCollections = collections.map(c => ({
      date: formatDateSL(c.collection.date),
      receiptNo: c.id.substring(0, 8).toUpperCase(),
      memberName: c.instalment?.client?.fullname || "Unknown",
      weekNumber: c.instalment?.weekNumber || "-",
      amount: c.amount,
      collectedBy: c.collection.collector?.fullname || "Unknown",
      status: c.status
    }));

    const pdfData = {
      loan: {
        loanNo: loan.loanNo,
        status: loan.status,
        lentAmount: loan.leaderLentAmount + loan.memberLentAmount, // Total lent
        totalPayableAmount: loan.leaderWeeklyAmount * loan.totalWeeks + loan.memberWeeklyAmount * loan.totalWeeks,
        totalPaidAmount: collections.filter(c => c.status !== 'REJECTED').reduce((sum, c) => sum + Number(c.amount), 0),
        remainingDue: loan.leaderWeeklyAmount * loan.totalWeeks + loan.memberWeeklyAmount * loan.totalWeeks - collections.filter(c => c.status !== 'REJECTED').reduce((sum, c) => sum + Number(c.amount), 0),
        createdAt: formatDateSL(loan.createdAt)
      },
      client: {
        fullname: loan.group.name + " (Group)",
        nic: "-",
        phone: "-",
        address: loan.group.branch?.name || "-"
      },
      members: loan.group.members.map(m => ({
        fullname: m.client?.fullname || "-",
        nic: m.client?.nic || "-",
        phone: m.client?.phone || "-",
        role: m.isLeader ? "Leader" : "Member"
      })),
      instalments: loan.instalments.map(i => ({
        memberName: i.client?.fullname || "Unknown",
        number: i.weekNumber,
        dueDate: formatDateSL(i.dueDate),
        dueAmount: i.dueAmount,
        paidAmount: i.paidAmount,
        remainingDue: i.remainingDue,
        status: i.status
      })),
      collections: flatCollections
    };

    const pdfBuffer = await generateLoanPdf(pdfData);

    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="loan-${loan.loanNo}.pdf"`);
    return reply.send(pdfBuffer);
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
            approvedAt: new Date(),
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

  // Export Loan to Excel
  fastify.get("/:id/export-excel", {
    schema: {
      params: { type: "object", properties: { id: { type: "string" } } }
    },
    handler: async (request, reply) => {
      try {
        const { id } = request.params;
        const buffer = await excelExportService.generateGroupLoanInterestPayments(fastify, id);

        reply
          .header("Content-Disposition", `attachment; filename=GroupLoan-${id}-Interest-Payments.xlsx`)
          .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
          .send(buffer);
      } catch (error) {
        request.log.error(error);
        if (error.message === "Loan not found") {
          throw createNotFoundError("Loan not found");
        }
        throw error;
      }
    }
  });

  // Export Loan Information to Excel
  fastify.get("/:id/export-info-excel", {
    schema: {
      params: { type: "object", properties: { id: { type: "string" } } }
    },
    handler: async (request, reply) => {
      try {
        const { id } = request.params;
        const buffer = await excelExportService.generateGroupLoanInformation(fastify, id);

        reply
          .header("Content-Disposition", `attachment; filename=GroupLoan-${id}-Information.xlsx`)
          .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
          .send(buffer);
      } catch (error) {
        request.log.error(error);
        if (error.message === "Loan not found") {
          throw createNotFoundError("Loan not found");
        }
        throw error;
      }
    }
  });
}
