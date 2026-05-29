// routes/mortgage-loans/index.js
import { createBadRequestError, createNotFoundError } from "../../utils/errors.js";
import fs from "fs";
import path from "path";
import { numberToWords } from "../../utils/numberToWords.js";
import { generateLoanPdf } from "../../services/pdfGenerator.js";

export default async function mortgageLoanRoutes(fastify, opts) {
  // Enforce JWT authentication on all routes in this plugin
  fastify.addHook("preHandler", fastify.authenticate);

  // GET /api/mortgage-loans - Fetch list with search, filtering, and pagination
  fastify.get("/", {
    schema: {
      query: {
        type: "object",
        properties: {
          page: { type: "number", default: 1 },
          limit: { type: "number", default: 10 },
          search: { type: "string" },
          status: { type: "string" },
          branchId: { type: "string" },
        },
      },
    },
    handler: async (request, reply) => {
      const { page, limit, search, status, branchId } = request.query;
      const skip = (page - 1) * limit;

      const where = {
        AND: [
          search ? {
            OR: [
              { loanNo: { contains: search } },
              { client: { fullname: { contains: search } } },
              { client: { clientNo: { contains: search } } }
            ]
          } : {},
          status && status !== "All" ? { status } : {},
          branchId && branchId !== "All" ? { branchId } : {},
        ],
      };

      const [mortgages, total] = await Promise.all([
        fastify.prisma.mortgageLoan.findMany({
          where,
          skip,
          take: limit,
          include: {
            client: { select: { id: true, fullname: true, clientNo: true, phone: true } },
            createdBy: { select: { id: true, fullname: true, email: true } },
            branch: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: "desc" },
        }),
        fastify.prisma.mortgageLoan.count({ where }),
      ]);

      return {
        success: true,
        mortgages,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    },
  });

  // POST /api/mortgage-loans - Create new Mortgage Loan record
  fastify.post("/", {
    schema: {
      body: {
        type: "object",
        required: [
          "clientId",
          "lentAmount",
          "interestRate",
          "assetType",
          "estimatedMarketValue",
          "assessedValue"
        ],
        properties: {
          clientId: { type: "string" },
          branchId: { type: "string" },
          lentAmount: { type: "number", minimum: 1 },
          interestRate: { type: "number", minimum: 0 },
          assetType: { type: "string", enum: ["VEHICLE", "PROPERTY", "GOLD", "OTHER"] },
          assetDescription: { type: "string" },
          estimatedMarketValue: { type: "number", minimum: 1 },
          assessedValue: { type: "number", minimum: 1 },
          status: { type: "string", enum: ["DRAFT", "PENDING", "APPROVED", "COMPLETED"] },
          collateralFiles: {
            type: "array",
            items: {
              type: "object",
              required: ["attachmentId", "name"],
              properties: {
                attachmentId: { type: "string" },
                name: { type: "string" },
              },
            },
          },
          titledFiles: {
            type: "array",
            items: {
              type: "object",
              required: ["attachmentId", "title", "name"],
              properties: {
                attachmentId: { type: "string" },
                title: { type: "string" },
                name: { type: "string" },
              },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const data = request.body;
      const creatorId = request.user.id;

      // 1. Fetch Creator and check their branch
      const creator = await fastify.prisma.user.findUnique({
        where: { id: creatorId },
        select: { id: true, branchId: true }
      });

      if (!creator) {
        throw createNotFoundError("Creator user not found");
      }
      
      const targetBranchId = creator.branchId || data.branchId || null;

      // 2. Fetch Client to verify existence and check if blacklisted
      const client = await fastify.prisma.client.findUnique({
        where: { id: data.clientId }
      });

      if (!client) {
        throw createNotFoundError("Client not found");
      }

      if (client.status === "BLACKLISTED") {
        throw createBadRequestError(`Client ${client.fullname} is Blacklisted. Cannot issue a mortgage loan.`);
      }

      // 3. Perform Transaction for creation
      const mortgage = await fastify.prisma.$transaction(async (tx) => {
        // Generate Unique Sequential ML Number
        const lastMortgage = await tx.mortgageLoan.findFirst({
          orderBy: { createdAt: "desc" },
        });

        let nextNo = 1;
        if (lastMortgage && lastMortgage.loanNo?.startsWith("ML-")) {
          const parts = lastMortgage.loanNo.split("-");
          nextNo = parseInt(parts[1], 10) + 1;
        }
        const loanNo = `ML-${nextNo.toString().padStart(6, "0")}`;

        // Compute financial metrics (same as frontend equations)
        const upfrontInterest = data.lentAmount * (data.interestRate / 100);
        const netCashDisbursed = Math.max(0, data.lentAmount - upfrontInterest);
        const monthlyDueAmount = data.lentAmount * (data.interestRate / 100);
        const dailyPenaltyAmount = monthlyDueAmount * 0.01;
        const ltvRatio = data.estimatedMarketValue > 0 
          ? Math.round((data.lentAmount / data.estimatedMarketValue) * 100)
          : 0;

        // Create the mortgage loan
        const newMortgage = await tx.mortgageLoan.create({
          data: {
            loanNo,
            client: { connect: { id: data.clientId } },
            lentAmount: data.lentAmount,
            interestRate: data.interestRate,
            upfrontInterest,
            netCashDisbursed,
            monthlyDueAmount,
            dailyPenaltyAmount,
            ltvRatio,
            assetType: data.assetType,
            assetDescription: data.assetDescription,
            estimatedMarketValue: data.estimatedMarketValue,
            assessedValue: data.assessedValue,
            status: "DRAFT",
            createdBy: { connect: { id: creatorId } },
            ...(targetBranchId ? { branch: { connect: { id: targetBranchId } } } : {}),
          }
        });

        // Save collateral documents links
        if (data.collateralFiles && data.collateralFiles.length > 0) {
          await tx.mortgageCollateral.createMany({
            data: data.collateralFiles.map(file => ({
              mortgageId: newMortgage.id,
              attachmentId: file.attachmentId,
              name: file.name
            }))
          });
        }

        // Save titled Supplementary documents links
        if (data.titledFiles && data.titledFiles.length > 0) {
          await tx.mortgageTitledFile.createMany({
            data: data.titledFiles.map(file => ({
              mortgageId: newMortgage.id,
              attachmentId: file.attachmentId,
              title: file.title,
              name: file.name
            }))
          });
        }

        // Write audit log entry
        await tx.auditLog.create({
          data: {
            action: "MORTGAGE_LOAN_CREATE",
            entity: "MORTGAGE_LOAN",
            entityId: newMortgage.id,
            userId: creatorId,
            details: { loanNo, clientId: data.clientId }
          }
        });

        return newMortgage;
      });

      return {
        success: true,
        mortgage
      };
    }
  });

  // GET /api/mortgage-loans/collections - Fetch collections list with search, filtering, and pagination
  fastify.get("/collections", {
    schema: {
      query: {
        type: "object",
        properties: {
          page: { type: "number", default: 1 },
          limit: { type: "number", default: 10 },
          search: { type: "string" },
          startDate: { type: "string" },
          endDate: { type: "string" },
        },
      },
    },
    handler: async (request, reply) => {
      const { page, limit, search, startDate, endDate } = request.query;
      const skip = (page - 1) * limit;

      const where = {
        AND: [
          search ? {
            OR: [
              { mortgage: { loanNo: { contains: search } } },
              { client: { fullname: { contains: search } } },
              { client: { clientNo: { contains: search } } },
              { client: { nic: { contains: search } } },
            ]
          } : {},
          startDate && endDate ? {
            createdAt: {
              gte: new Date(startDate),
              lte: new Date(new Date(endDate).setHours(23, 59, 59, 999))
            }
          } : {},
        ],
      };

      const [collections, total] = await Promise.all([
        fastify.prisma.mortgageCollection.findMany({
          where,
          skip,
          take: limit,
          include: {
            client: { select: { id: true, fullname: true, clientNo: true, nic: true } },
            mortgage: { select: { id: true, loanNo: true } },
            collectedBy: { select: { id: true, fullname: true } },
          },
          orderBy: { createdAt: "desc" },
        }),
        fastify.prisma.mortgageCollection.count({ where }),
      ]);

      return {
        success: true,
        collections,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    },
  });

  // GET /api/mortgage-loans/collections/export/pdf - Export collections list to PDF
  fastify.get("/collections/export/pdf", {
    preValidation: [fastify.authenticate],
  }, async (request, reply) => {
    const { search, startDate, endDate } = request.query;
    
    const where = {
      AND: [
        search ? {
          OR: [
            { mortgage: { loanNo: { contains: search } } },
            { client: { fullname: { contains: search } } },
            { client: { clientNo: { contains: search } } },
            { client: { nic: { contains: search } } },
          ]
        } : {},
        startDate && endDate ? {
          createdAt: {
            gte: new Date(startDate),
            lte: new Date(new Date(endDate).setHours(23, 59, 59, 999))
          }
        } : {},
      ],
    };

    const collections = await fastify.prisma.mortgageCollection.findMany({
      where,
      include: {
        client: { select: { id: true, fullname: true, nic: true } },
        mortgage: { select: { id: true, loanNo: true } },
        collectedBy: { select: { id: true, fullname: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    let totalPaid = 0;
    let totalPrincipal = 0;

    const records = collections.map(col => {
      const amount = Number(col.amount);
      const principal = Number(col.principalReduction);
      totalPaid += amount;
      totalPrincipal += principal;

      return {
        date: new Date(col.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
        loanNo: col.mortgage?.loanNo || "-",
        clientName: col.client?.fullname || "-",
        nic: col.client?.nic || "-",
        totalPaid: amount.toLocaleString('en-US', { minimumFractionDigits: 2 }),
        principalReduced: principal > 0 ? principal.toLocaleString('en-US', { minimumFractionDigits: 2 }) : "-",
        collectedBy: col.collectedBy?.fullname || "System",
      };
    });

    const pdfData = {
      dateRange: (startDate && endDate) ? `${startDate} to ${endDate}` : "All Time",
      search: search || "None",
      summary: {
        totalCount: collections.length,
        totalPaid: totalPaid.toLocaleString('en-US', { minimumFractionDigits: 2 }),
        totalPrincipal: totalPrincipal.toLocaleString('en-US', { minimumFractionDigits: 2 }),
      },
      records,
    };

    const pdfBuffer = await generateLoanPdf(pdfData, "mortgage-collection-report.html");

    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="Mortgage-Collections-Report.pdf"`);
    return reply.send(pdfBuffer);
  });

  // GET /api/mortgage-loans/collections/:id - Fetch single collection details
  fastify.get("/collections/:id", async (request, reply) => {
    const { id } = request.params;
    const collection = await fastify.prisma.mortgageCollection.findUnique({
      where: { id },
      include: {
        client: true,
        mortgage: {
          select: {
            id: true,
            loanNo: true,
            lentAmount: true,
            interestRate: true,
            netCashDisbursed: true,
            monthlyDueAmount: true,
            dailyPenaltyAmount: true,
          }
        },
        collectedBy: { select: { id: true, fullname: true, email: true } },
        items: {
          include: {
            instalment: true
          }
        }
      }
    });

    if (!collection) {
      throw createNotFoundError("Mortgage collection not found");
    }

    return {
      success: true,
      collection
    };
  });

  // GET /api/mortgage-loans/:id/voucher - Generate Payment Voucher HTML
  fastify.get("/:id/voucher", async (request, reply) => {
    const { id } = request.params;
    const mortgage = await fastify.prisma.mortgageLoan.findUnique({
      where: { id },
      include: {
        client: true,
        branch: { select: { name: true } }
      }
    });

    if (!mortgage) {
      throw createNotFoundError("Mortgage loan not found");
    }

    // Prepare data
    const templatePath = path.join(process.cwd(), "templates", "receipts", "mortgage-disbursement-voucher.html");
    let templateHtml = fs.readFileSync(templatePath, "utf-8");

    const amount = Number(mortgage.netCashDisbursed);
    const amountFormatted = amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const amountWords = numberToWords(amount);

    const logoPath = path.join(process.cwd(), "assets", "don&dons.png");
    let logoBase64 = "";
    try {
      const logoBuffer = fs.readFileSync(logoPath);
      logoBase64 = `data:image/png;base64,${logoBuffer.toString("base64")}`;
    } catch (err) {
      console.warn("Logo not found for voucher", err);
    }
    
    // Default placeholders
    const placeholders = {
      "{{companyName}}": "Don and don's",
      "{{branchName}}": mortgage.branch?.name || "Main Branch",
      "{{payeeName}}": mortgage.client?.fullname || "Unknown",
      "{{idNumber}}": mortgage.client?.nic || "Unknown",
      "{{voucherNo}}": mortgage.loanNo,
      "{{date}}": mortgage.approvedAt ? new Date(mortgage.approvedAt).toLocaleDateString('en-GB') : new Date().toLocaleDateString('en-GB'),
      "{{invNo}}": "-",
      "{{description}}": "Mortgage Loan Disbursement",
      "{{amountFormatted}}": amountFormatted,
      "{{ledgerAccount}}": "Loan Account",
      "{{remarks}}": "-",
      "{{amountWords}}": amountWords,
      "{{logoBase64}}": logoBase64,
    };

    for (const [key, value] of Object.entries(placeholders)) {
      // Use regex with global flag to replace all occurrences
      templateHtml = templateHtml.replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value);
    }

    reply.type('text/html').send(templateHtml);
  });

  // GET /api/mortgage-loans/:id - Fetch single record details
  fastify.get("/:id", async (request, reply) => {
    const { id } = request.params;
    const mortgage = await fastify.prisma.mortgageLoan.findUnique({
      where: { id },
      include: {
        client: true,
        createdBy: { select: { id: true, fullname: true, email: true } },
        branch: { select: { id: true, name: true } },
        collateralFiles: { include: { attachment: true } },
        titledFiles: { include: { attachment: true } },
        instalments: {
          include: {
            collectionItems: true
          },
          orderBy: { monthNumber: "asc" }
        },
        collections: {
          include: {
            items: true,
            collectedBy: { select: { fullname: true } }
          },
          orderBy: { createdAt: "desc" }
        }
      }
    });

    if (!mortgage) {
      throw createNotFoundError("Mortgage loan not found");
    }

    return {
      success: true,
      mortgage
    };
  });

  // PUT /api/mortgage-loans/:id - Update Mortgage Loan details and files
  fastify.put("/:id", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } }
      },
      body: {
        type: "object",
        required: [
          "clientId",
          "lentAmount",
          "interestRate",
          "assetType",
          "estimatedMarketValue",
          "assessedValue"
        ],
        properties: {
          clientId: { type: "string" },
          lentAmount: { type: "number", minimum: 1 },
          interestRate: { type: "number", minimum: 0 },
          assetType: { type: "string", enum: ["VEHICLE", "PROPERTY", "GOLD", "OTHER"] },
          assetDescription: { type: "string" },
          estimatedMarketValue: { type: "number", minimum: 1 },
          assessedValue: { type: "number", minimum: 1 },
          status: { type: "string", enum: ["DRAFT", "PENDING", "APPROVED", "COMPLETED"] },
          collateralFiles: {
            type: "array",
            items: {
              type: "object",
              required: ["attachmentId", "name"],
              properties: {
                attachmentId: { type: "string" },
                name: { type: "string" },
              },
            },
          },
          titledFiles: {
            type: "array",
            items: {
              type: "object",
              required: ["attachmentId", "title", "name"],
              properties: {
                attachmentId: { type: "string" },
                title: { type: "string" },
                name: { type: "string" },
              },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params;
      const data = request.body;
      const updaterId = request.user.id;

      // Verify mortgage exists
      const existing = await fastify.prisma.mortgageLoan.findUnique({
        where: { id }
      });
      if (!existing) {
        throw createNotFoundError("Mortgage loan not found");
      }

      if (existing.status !== "DRAFT" && existing.status !== "PENDING") {
        throw createBadRequestError("Only Draft or Pending mortgage loans can be edited.");
      }

      // Verify client exists and is not blacklisted
      const client = await fastify.prisma.client.findUnique({
        where: { id: data.clientId }
      });
      if (!client) {
        throw createNotFoundError("Client not found");
      }
      if (client.status === "BLACKLISTED") {
        throw createBadRequestError(`Client ${client.fullname} is Blacklisted. Cannot issue mortgage loan.`);
      }

      // Compute metrics
      const upfrontInterest = data.lentAmount * (data.interestRate / 100);
      const netCashDisbursed = Math.max(0, data.lentAmount - upfrontInterest);
      const monthlyDueAmount = data.lentAmount * (data.interestRate / 100);
      const dailyPenaltyAmount = monthlyDueAmount * 0.01;
      const ltvRatio = data.estimatedMarketValue > 0
        ? Math.round((data.lentAmount / data.estimatedMarketValue) * 100)
        : 0;

      const mortgage = await fastify.prisma.$transaction(async (tx) => {
        // Update basic details
        const updated = await tx.mortgageLoan.update({
          where: { id },
          data: {
            clientId: data.clientId,
            lentAmount: data.lentAmount,
            interestRate: data.interestRate,
            upfrontInterest,
            netCashDisbursed,
            monthlyDueAmount,
            dailyPenaltyAmount,
            ltvRatio,
            assetType: data.assetType,
            assetDescription: data.assetDescription,
            estimatedMarketValue: data.estimatedMarketValue,
            assessedValue: data.assessedValue,
            status: data.status || existing.status,
            // Clear rejectionReason if moving to PENDING
            rejectionReason: data.status === "PENDING" ? null : undefined,
          }
        });

        // Sync collateral files (delete old, insert new)
        await tx.mortgageCollateral.deleteMany({
          where: { mortgageId: id }
        });
        if (data.collateralFiles && data.collateralFiles.length > 0) {
          await tx.mortgageCollateral.createMany({
            data: data.collateralFiles.map(file => ({
              mortgageId: id,
              attachmentId: file.attachmentId,
              name: file.name
            }))
          });
        }

        // Sync titled files (delete old, insert new)
        await tx.mortgageTitledFile.deleteMany({
          where: { mortgageId: id }
        });
        if (data.titledFiles && data.titledFiles.length > 0) {
          await tx.mortgageTitledFile.createMany({
            data: data.titledFiles.map(file => ({
              mortgageId: id,
              attachmentId: file.attachmentId,
              title: file.title,
              name: file.name
            }))
          });
        }

        // Write Audit Log
        await tx.auditLog.create({
          data: {
            action: "MORTGAGE_LOAN_UPDATE",
            entity: "MORTGAGE_LOAN",
            entityId: id,
            userId: updaterId,
            details: { loanNo: updated.loanNo, clientId: data.clientId }
          }
        });

        return updated;
      });

      return {
        success: true,
        mortgage
      };
    }
  });

  // PUT /api/mortgage-loans/:id/send-for-approval - Submit DRAFT mortgage for approval
  fastify.put("/:id/send-for-approval", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } }
      }
    },
    handler: async (request, reply) => {
      const { id } = request.params;

      const mortgage = await fastify.prisma.$transaction(async (tx) => {
        const existing = await tx.mortgageLoan.findUnique({ where: { id } });
        if (!existing) {
          throw createNotFoundError("Mortgage loan not found");
        }
        if (existing.status !== "DRAFT") {
          throw createBadRequestError("Only DRAFT mortgage loans can be submitted for approval.");
        }

        const updated = await tx.mortgageLoan.update({
          where: { id },
          data: {
            status: "PENDING",
            rejectionReason: null,
          }
        });

        await tx.auditLog.create({
          data: {
            action: "MORTGAGE_LOAN_SUBMIT",
            entity: "MORTGAGE_LOAN",
            entityId: id,
            userId: request.user.id,
            details: { loanNo: updated.loanNo, submittedBy: request.user.id }
          }
        });

        return updated;
      });

      return { success: true, mortgage };
    }
  });

  // PUT /api/mortgage-loans/:id/approve - Approve Mortgage Loan (Gated)
  fastify.put("/:id/approve", {
    preHandler: fastify.authorize(["ADMIN", "BRANCH_MANAGER", "APPROVER"]),
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } }
      }
    },
    handler: async (request, reply) => {
      const { id } = request.params;
      const approvedById = request.user.id;

      const mortgage = await fastify.prisma.$transaction(async (tx) => {
        const existing = await tx.mortgageLoan.findUnique({ where: { id } });
        if (!existing) {
          throw createNotFoundError("Mortgage loan not found");
        }

        const approvedAt = new Date();

        const updated = await tx.mortgageLoan.update({
          where: { id },
          data: {
            status: "APPROVED",
            approvedAt,
            rejectionReason: null,
          }
        });

        // Delete any existing instalments for safety
        await tx.mortgageInstalment.deleteMany({
          where: { mortgageId: id }
        });

        // Due date = approval date + 3 days
        const firstDueDate = new Date(approvedAt);
        firstDueDate.setDate(approvedAt.getDate() + 3);

        // Create the first month's interest instalment, marked as PAID
        // createdAt is set to the approval date so the cron can use it as the base
        await tx.mortgageInstalment.create({
          data: {
            mortgageId: id,
            clientId: existing.clientId,
            monthNumber: 1,
            dueDate: firstDueDate,
            dueAmount: existing.upfrontInterest,
            paidAmount: existing.upfrontInterest,
            remainingDue: 0.00,
            status: "PAID",
            paidAt: approvedAt,
            createdAt: approvedAt,
          }
        });

        await tx.auditLog.create({
          data: {
            action: "MORTGAGE_LOAN_APPROVE",
            entity: "MORTGAGE_LOAN",
            entityId: id,
            userId: request.user.id,
            details: { loanNo: updated.loanNo, approvedBy: approvedById }
          }
        });

        return updated;
      });

      return { success: true, mortgage };
    }
  });

  // PUT /api/mortgage-loans/:id/reject - Reject Mortgage Loan (Gated)
  fastify.put("/:id/reject", {
    preHandler: fastify.authorize(["ADMIN", "BRANCH_MANAGER", "APPROVER"]),
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } }
      },
      body: {
        type: "object",
        required: ["rejectionReason"],
        properties: {
          rejectionReason: { type: "string", minLength: 1 }
        }
      }
    },
    handler: async (request, reply) => {
      const { id } = request.params;
      const { rejectionReason } = request.body;

      const mortgage = await fastify.prisma.$transaction(async (tx) => {
        const existing = await tx.mortgageLoan.findUnique({ where: { id } });
        if (!existing) {
          throw createNotFoundError("Mortgage loan not found");
        }

        const updated = await tx.mortgageLoan.update({
          where: { id },
          data: {
            status: "DRAFT", // Reset to DRAFT so details can be fixed
            rejectionReason
          }
        });

        await tx.auditLog.create({
          data: {
            action: "MORTGAGE_LOAN_REJECT",
            entity: "MORTGAGE_LOAN",
            entityId: id,
            userId: request.user.id,
            details: { loanNo: updated.loanNo, reason: rejectionReason }
          }
        });

        return updated;
      });

      return { success: true, mortgage };
    }
  });

  // POST /api/mortgage-loans/:id/payment - Record Mortgage Payment
  fastify.post("/:id/payment", {
    schema: {
      params: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } }
      },
      body: {
        type: "object",
        required: ["amount"],
        properties: {
          amount: { type: "number", minimum: 0.01 },
          notes: { type: "string" }
        }
      }
    },
    handler: async (request, reply) => {
      const { id } = request.params;
      const { amount, notes } = request.body;
      const collectedById = request.user.id;

      const result = await fastify.prisma.$transaction(async (tx) => {
        // 1. Fetch Mortgage Loan
        const mortgage = await tx.mortgageLoan.findUnique({
          where: { id },
          include: {
            instalments: {
              orderBy: { monthNumber: "asc" }
            }
          }
        });

        if (!mortgage) {
          throw createNotFoundError("Mortgage loan not found");
        }

        if (mortgage.status !== "APPROVED" && mortgage.status !== "COMPLETED") {
          throw createBadRequestError("Payments can only be recorded for APPROVED or COMPLETED mortgage loans.");
        }

        let amountLeft = Number(amount);
        const totalPaymentAmount = amountLeft;
        let principalReduction = 0;

        const collectionItemsToCreate = [];

        // 2. Fetch all unpaid/partial/overdue instalments
        const unpaidInstalments = mortgage.instalments.filter(
          inst => inst.status !== "PAID" || Number(inst.remainingDue) > 0
        );

        for (const instalment of unpaidInstalments) {
          if (amountLeft <= 0) break;

          // Fetch all collection items for this instalment to sum penaltyPaid
          const existingItems = await tx.mortgageCollectionItem.findMany({
            where: { instalmentId: instalment.id }
          });

          const totalPenaltyPaid = existingItems.reduce(
            (sum, item) => sum + Number(item.penaltyPaid),
            0
          );

          const outstandingPenalty = Math.max(0, Number(instalment.penaltyAmount) - totalPenaltyPaid);
          const outstandingBaseDue = Math.max(0, Number(instalment.dueAmount) - Number(instalment.paidAmount));

          let penaltyPaidThisInstalment = 0;
          let duePaidThisInstalment = 0;

          // Prioritize paying penalty first
          if (outstandingPenalty > 0) {
            const p = Math.min(amountLeft, outstandingPenalty);
            penaltyPaidThisInstalment = p;
            amountLeft -= p;
          }

          // Then pay the base due
          if (amountLeft > 0 && outstandingBaseDue > 0) {
            const d = Math.min(amountLeft, outstandingBaseDue);
            duePaidThisInstalment = d;
            amountLeft -= d;
          }

          if (penaltyPaidThisInstalment > 0 || duePaidThisInstalment > 0) {
            const totalPaidThisInstalment = penaltyPaidThisInstalment + duePaidThisInstalment;
            const newRemainingDue = Math.max(0, Number(instalment.remainingDue) - totalPaidThisInstalment);
            const newPaidAmount = Number(instalment.paidAmount) + duePaidThisInstalment;

            const isFullyPaid = newRemainingDue === 0;

            await tx.mortgageInstalment.update({
              where: { id: instalment.id },
              data: {
                paidAmount: newPaidAmount,
                remainingDue: newRemainingDue,
                status: isFullyPaid ? "PAID" : "PARTIAL",
                paidAt: isFullyPaid ? new Date() : instalment.paidAt,
              }
            });

            collectionItemsToCreate.push({
              instalmentId: instalment.id,
              penaltyPaid: penaltyPaidThisInstalment,
              duePaid: duePaidThisInstalment,
              totalPaid: totalPaidThisInstalment
            });
          }
        }

        // 3. Excess payment reduces the principal
        if (amountLeft > 0) {
          principalReduction = amountLeft;
          await tx.mortgageLoan.update({
            where: { id },
            data: {
              principalPaid: { increment: principalReduction }
            }
          });
        }

        // 4. Create Mortgage Collection record
        const collection = await tx.mortgageCollection.create({
          data: {
            mortgageId: id,
            clientId: mortgage.clientId,
            amount: totalPaymentAmount,
            principalReduction,
            notes,
            collectedById,
          }
        });

        // 5. Create Collection Items
        if (collectionItemsToCreate.length > 0) {
          await tx.mortgageCollectionItem.createMany({
            data: collectionItemsToCreate.map(item => ({
              collectionId: collection.id,
              instalmentId: item.instalmentId,
              penaltyPaid: item.penaltyPaid,
              duePaid: item.duePaid,
              totalPaid: item.totalPaid,
            }))
          });
        }

        // 6. Write Audit Log
        await tx.auditLog.create({
          data: {
            action: "MORTGAGE_LOAN_PAYMENT",
            entity: "MORTGAGE_LOAN",
            entityId: id,
            userId: collectedById,
            details: {
              loanNo: mortgage.loanNo,
              amount: totalPaymentAmount,
              principalReduction,
              collectionId: collection.id
            }
          }
        });

        return {
          collection,
          collectionItemsCount: collectionItemsToCreate.length,
          principalReduction
        };
      }, {
        maxWait: 15000, // 15 seconds max wait to acquire transaction lock
        timeout: 30000  // 30 seconds max execution time
      });

      return {
        success: true,
        message: "Payment successfully recorded",
        ...result
      };
    }
  });

  // POST /api/mortgage-loans/:id/complete - Mark Mortgage Loan as COMPLETED
  fastify.post("/:id/complete", {
    handler: async (request, reply) => {
      const { id } = request.params;
      const mortgage = await fastify.prisma.mortgageLoan.findUnique({
        where: { id },
      });

      if (!mortgage) throw createNotFoundError("Mortgage Loan not found");

      if (mortgage.status === "COMPLETED") {
        throw createBadRequestError("Mortgage Loan is already completed");
      }

      // Allow completion if remaining principal is zero
      const remainingPrincipal = Math.max(0, Number(mortgage.lentAmount) - Number(mortgage.principalPaid || 0));
      if (remainingPrincipal > 0) {
        throw createBadRequestError("Cannot complete mortgage loan with outstanding principal balance");
      }

      const updated = await fastify.prisma.$transaction(async (tx) => {
        const ml = await tx.mortgageLoan.update({
          where: { id },
          data: { status: "COMPLETED" },
        });
        
        await tx.auditLog.create({
          data: {
            action: "MORTGAGE_LOAN_COMPLETED",
            entity: "MORTGAGE_LOAN",
            entityId: id,
            userId: request.user.id,
            details: { loanNo: mortgage.loanNo },
          },
        });
        
        return ml;
      });

      return {
        success: true,
        message: "Mortgage Loan successfully marked as COMPLETED",
        mortgage: updated,
      };
    },
  });

  // Export Mortgage Loan to PDF
  fastify.get("/:id/export/pdf", async (request, reply) => {
    const { id } = request.params;
    
    // Fetch full mortgage details
    const mortgage = await fastify.prisma.mortgageLoan.findUnique({
      where: { id },
      include: {
        client: true,
        branch: true,
        createdBy: { select: { fullname: true } },
        collections: {
          include: {
            collectedBy: { select: { fullname: true } }
          },
          orderBy: { createdAt: "desc" }
        }
      }
    });

    if (!mortgage) throw createNotFoundError("Mortgage Loan not found");

    const flatCollections = mortgage.collections.map(c => ({
      date: new Date(c.createdAt).toLocaleDateString(),
      receiptNo: c.id.substring(0, 8).toUpperCase(),
      type: "Mortgage",
      amount: c.amount,
      penalty: 0, // Simplified for PDF overview
      status: "COMPLETED"
    }));

    const pdfData = {
      loan: {
        loanNo: mortgage.loanNo,
        status: mortgage.status,
        lentAmount: mortgage.lentAmount,
        netCashDisbursed: mortgage.netCashDisbursed,
        assetType: mortgage.assetType,
        estimatedMarketValue: mortgage.estimatedMarketValue,
        assessedValue: mortgage.assessedValue,
        ltvRatio: mortgage.ltvRatio,
        monthlyDueAmount: mortgage.monthlyDueAmount,
        createdAt: new Date(mortgage.createdAt).toLocaleDateString()
      },
      client: {
        fullname: mortgage.client.fullname,
        nic: mortgage.client.nic,
        phone: mortgage.client.phone,
        address: mortgage.client.address || "-"
      },
      collections: flatCollections
    };

    const pdfBuffer = await generateLoanPdf(pdfData, "mortgage-details.html");

    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="mortgage-${mortgage.loanNo}.pdf"`);
    return reply.send(pdfBuffer);
  });
}

