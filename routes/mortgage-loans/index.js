// routes/mortgage-loans/index.js
import { createBadRequestError, createNotFoundError } from "../../utils/errors.js";

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
            status: data.status || "PENDING",
            createdById: creatorId,
            branchId: creator.branchId || null,
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
        titledFiles: { include: { attachment: true } }
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
}
