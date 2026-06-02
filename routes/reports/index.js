import { PrismaClient } from "@prisma/client";
import { createBadRequestError } from "../../utils/errors.js";
import { getStartOfDaySL, getEndOfDaySL } from "../../utils/dateHelpers.js";
import { generateLoanPdf } from "../../services/pdfGenerator.js";

const prisma = new PrismaClient();

export default async function reportRoutes(fastify, options) {
  fastify.get(
    "/client-wise",
    {
      preValidation: [fastify.authenticate],
      schema: {
        querystring: {
          type: "object",
          properties: {
            startDate: { type: "string", format: "date" },
            endDate: { type: "string", format: "date" },
            paymentStatus: { type: "string" },
            search: { type: "string" },
            page: { type: "integer", default: 1 },
            limit: { type: "integer", default: 100 },
          },
        },
      },
    },
    async (request, reply) => {
      const { startDate, endDate, search, page, limit, paymentStatus } = request.query;

      const dateFilter = {};
      if (startDate && endDate) {
        dateFilter.gte = new Date(`${startDate}T00:00:00.000Z`);
        dateFilter.lte = new Date(`${endDate}T23:59:59.999Z`);
      }

      // Base query for clients who have active or completed loans
      const clientWhere = {
        isDeleted: false,
        instalments: {
          some: {
            loan: { status: { in: ["ACTIVE", "APPROVED", "COMPLETED"] } },
          },
        },
      };

      if (search) {
        clientWhere.OR = [
          { fullname: { contains: search } },
          { nic: { contains: search } },
          { clientNo: { contains: search } },
        ];
      }

      const skip = (page - 1) * limit;

      // 1. Fetch Clients with related Data
      const clients = await prisma.client.findMany({
        where: clientWhere,
        include: {
          groupMembers: {
            include: { group: true }
          },
          instalments: {
            where: { loan: { status: { in: ["ACTIVE", "APPROVED", "COMPLETED"] } } },
            include: {
              collectionItems: {
                include: { collection: true }
              }
            }
          }
        },
        orderBy: { createdAt: "desc" },
      });

      // 2. Process Client Data
      let totalPaidClientsCount = 0;
      let totalNotPaidClientsCount = 0;
      let notPaidClientsOutstanding = 0;
      let globalTotalPaid = 0;
      let globalTotalOutstanding = 0;

      const reportData = clients.map((client) => {
        let clientExpected = 0;
        let clientCollected = 0;
        let clientArrears = 0;
        let clientTotalOutstanding = 0;

        const today = getStartOfDaySL();

        client.instalments.forEach((inst) => {
          const instDueDate = new Date(inst.dueDate);

          // Expected in Range
          if (startDate && endDate) {
            const start = new Date(`${startDate}T00:00:00.000Z`);
            const end = new Date(`${endDate}T23:59:59.999Z`);
            if (instDueDate >= start && instDueDate <= end) {
              clientExpected += Number(inst.dueAmount);
            }
          } else {
            clientExpected += Number(inst.dueAmount);
          }

          // Collected in Range (by checking collection dates)
          inst.collectionItems.forEach((item) => {
            if (item.status !== "REJECTED") {
              if (startDate && endDate) {
                const colDate = new Date(item.collection.date);
                const start = new Date(`${startDate}T00:00:00.000Z`);
                const end = new Date(`${endDate}T23:59:59.999Z`);
                if (colDate >= start && colDate <= end) {
                  clientCollected += Number(item.amount);
                }
              } else {
                clientCollected += Number(item.amount);
              }
            }
          });

          // Arrears (unpaid before today)
          if (instDueDate < today && inst.remainingDue > 0) {
            clientArrears += Number(inst.remainingDue);
          }

          // Total Outstanding (up to end date)
          if (inst.remainingDue > 0) {
            if (endDate) {
              const end = new Date(`${endDate}T23:59:59.999Z`);
              if (instDueDate <= end) {
                clientTotalOutstanding += Number(inst.remainingDue);
              }
            } else {
              clientTotalOutstanding += Number(inst.remainingDue);
            }
          }
        });

        // Determine Status for Range
        let status = "PENDING";
        if (clientExpected > 0) {
          if (clientCollected >= clientExpected) status = "PAID";
          else if (clientCollected > 0) status = "PARTIAL";
          else status = "UNPAID";
        } else if (clientCollected > 0) {
           status = "PAID"; // Advanced payment or arrears payment
        } else if (clientArrears > 0) {
           status = "UNPAID";
        }

        // Summary Aggregations
        globalTotalPaid += clientCollected;
        globalTotalOutstanding += clientTotalOutstanding;

        if (status === "PAID") {
          totalPaidClientsCount++;
        } else if (status === "UNPAID" || status === "PARTIAL") {
          totalNotPaidClientsCount++;
          notPaidClientsOutstanding += clientTotalOutstanding;
        }

        // Group Info
        const group = client.groupMembers[0]?.group;

        return {
          id: client.id,
          clientNo: client.clientNo,
          fullname: client.fullname,
          nic: client.nic,
          phone: client.phone,
          groupNo: group?.groupNo || "-",
          groupName: group?.name || "-",
          location: group?.location || "-",
          expected: clientExpected,
          collected: clientCollected,
          arrears: clientArrears,
          totalOutstanding: clientTotalOutstanding,
          status,
        };
      });

      let filteredData = reportData;
      if (paymentStatus === "PAID") {
        filteredData = reportData.filter((d) => d.status === "PAID");
      } else if (paymentStatus === "UNPAID") {
        filteredData = reportData.filter((d) => d.status === "UNPAID" || d.status === "PARTIAL");
      }

      const totalItems = filteredData.length;
      const paginatedData = filteredData.slice((page - 1) * limit, page * limit);

      return reply.send({
        success: true,
        summary: {
          paidClients: totalPaidClientsCount,
          notPaidClients: totalNotPaidClientsCount,
          notPaidOutstanding: notPaidClientsOutstanding,
          totalPaid: globalTotalPaid,
          totalOutstanding: globalTotalOutstanding,
        },
        data: paginatedData,
        pagination: {
          total: totalItems,
          page,
          limit,
          totalPages: Math.ceil(totalItems / limit),
        },
      });
    }
  );

  fastify.get(
    "/client-wise/export/pdf",
    {
      preValidation: [fastify.authenticate],
    },
    async (request, reply) => {
      const { startDate, endDate, search, paymentStatus } = request.query;

      const dateFilter = {};
      if (startDate && endDate) {
        dateFilter.gte = new Date(`${startDate}T00:00:00.000Z`);
        dateFilter.lte = new Date(`${endDate}T23:59:59.999Z`);
      }

      const clientWhere = {
        isDeleted: false,
        instalments: {
          some: { loan: { status: { in: ["ACTIVE", "APPROVED", "COMPLETED"] } } },
        },
      };

      if (search) {
        clientWhere.OR = [
          { fullname: { contains: search } },
          { nic: { contains: search } },
          { clientNo: { contains: search } },
        ];
      }

      const clients = await prisma.client.findMany({
        where: clientWhere,
        include: {
          groupMembers: { include: { group: true } },
          instalments: {
            where: { loan: { status: { in: ["ACTIVE", "APPROVED", "COMPLETED"] } } },
            include: {
              collectionItems: { include: { collection: true } }
            }
          }
        },
        orderBy: { createdAt: "desc" },
      });

      let globalTotalPaid = 0;
      let globalTotalOutstanding = 0;
      let globalTotalArrears = 0;
      let globalTotalExpected = 0;

      const reportData = clients.map((client) => {
        let clientExpected = 0;
        let clientCollected = 0;
        let clientArrears = 0;
        let clientTotalOutstanding = 0;

        const today = getStartOfDaySL();

        client.instalments.forEach((inst) => {
          const instDueDate = new Date(inst.dueDate);

          if (startDate && endDate) {
            const start = new Date(`${startDate}T00:00:00.000Z`);
            const end = new Date(`${endDate}T23:59:59.999Z`);
            if (instDueDate >= start && instDueDate <= end) clientExpected += Number(inst.dueAmount);
          } else {
            clientExpected += Number(inst.dueAmount);
          }

          inst.collectionItems.forEach((item) => {
            if (item.status !== "REJECTED") {
              if (startDate && endDate) {
                const colDate = new Date(item.collection.date);
                const start = new Date(`${startDate}T00:00:00.000Z`);
                const end = new Date(`${endDate}T23:59:59.999Z`);
                if (colDate >= start && colDate <= end) clientCollected += Number(item.amount);
              } else {
                clientCollected += Number(item.amount);
              }
            }
          });

          if (instDueDate < today && inst.remainingDue > 0) clientArrears += Number(inst.remainingDue);

          if (inst.remainingDue > 0) {
            if (endDate) {
              const end = new Date(`${endDate}T23:59:59.999Z`);
              if (instDueDate <= end) clientTotalOutstanding += Number(inst.remainingDue);
            } else {
              clientTotalOutstanding += Number(inst.remainingDue);
            }
          }
        });

        let status = "PENDING";
        if (clientExpected > 0) {
          if (clientCollected >= clientExpected) status = "PAID";
          else if (clientCollected > 0) status = "PARTIAL";
          else status = "UNPAID";
        } else if (clientCollected > 0) {
           status = "PAID";
        } else if (clientArrears > 0) {
           status = "UNPAID";
        }

        const group = client.groupMembers[0]?.group;

        return {
          clientNo: client.clientNo,
          fullname: client.fullname,
          nic: client.nic,
          groupName: group?.name || "-",
          expected: clientExpected,
          collected: clientCollected,
          arrears: clientArrears,
          totalOutstanding: clientTotalOutstanding,
          status,
        };
      });

      let filteredData = reportData;
      if (paymentStatus === "PAID") {
        filteredData = reportData.filter((d) => d.status === "PAID");
      } else if (paymentStatus === "UNPAID") {
        filteredData = reportData.filter((d) => d.status === "UNPAID" || d.status === "PARTIAL");
      }

      // Calculate totals for the filtered subset
      filteredData.forEach(d => {
        globalTotalPaid += d.collected;
        globalTotalOutstanding += d.totalOutstanding;
        globalTotalArrears += d.arrears;
        globalTotalExpected += d.expected;
      });

      const pdfData = {
        dateRange: (startDate && endDate) ? `${startDate} to ${endDate}` : "All Time",
        paymentStatus: paymentStatus || "All",
        search: search || "None",
        summary: {
          totalOutstanding: globalTotalOutstanding.toLocaleString('en-US', { minimumFractionDigits: 2 }),
          totalArrears: globalTotalArrears.toLocaleString('en-US', { minimumFractionDigits: 2 }),
          totalPaid: globalTotalPaid.toLocaleString('en-US', { minimumFractionDigits: 2 }),
          totalExpected: globalTotalExpected.toLocaleString('en-US', { minimumFractionDigits: 2 }),
        },
        records: filteredData.map(d => ({
          ...d,
          expected: d.expected.toLocaleString('en-US', { minimumFractionDigits: 2 }),
          collected: d.collected.toLocaleString('en-US', { minimumFractionDigits: 2 }),
          arrears: d.arrears.toLocaleString('en-US', { minimumFractionDigits: 2 }),
          totalOutstanding: d.totalOutstanding.toLocaleString('en-US', { minimumFractionDigits: 2 }),
        }))
      };

      const pdfBuffer = await generateLoanPdf(pdfData, "client-wise-report.html");

      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `attachment; filename="Client-Wise-Report.pdf"`);
      return reply.send(pdfBuffer);
    }
  );
}
