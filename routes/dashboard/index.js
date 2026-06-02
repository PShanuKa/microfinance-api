// routes/dashboard/index.js
import { createBadRequestError, createNotFoundError } from "../../utils/errors.js";
import { formatMonthKeySL } from "../../utils/dateHelpers.js";

export default async function dashboardRoutes(fastify, opts) {
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.get("/stats", async (request, reply) => {
    const { branchId } = request.query;

    // Filters based on branchId
    const branchFilter = branchId ? { branchId } : {};

    // 1. Group Count
    const totalGroups = await fastify.prisma.group.count({
      where: branchFilter
    });

    // 2. Clients Count
    const clientWhere = branchId
      ? { groupMembers: { some: { group: { branchId } } } }
      : {};
    const totalClients = await fastify.prisma.client.count({
      where: {
        ...clientWhere,
        status: "ACTIVE",
        isDeleted: false
      }
    });

    // 3. Outstanding Portfolio and Collected Amount
    const instalmentWhere = branchId
      ? { loan: { group: { branchId } } }
      : {};

    const instalmentsData = await fastify.prisma.instalment.aggregate({
      where: instalmentWhere,
      _sum: {
        remainingDue: true,
        paidAmount: true,
        dueAmount: true
      }
    });

    const totalOutstanding = Number(instalmentsData._sum.remainingDue || 0);
    const totalCollected = Number(instalmentsData._sum.paidAmount || 0);
    const totalDue = Number(instalmentsData._sum.dueAmount || 0);

    const collectionRate = totalDue > 0 ? (totalCollected / totalDue) * 100 : 0;

    // 4. Monthly collections chart (last 6 months)
    const collections = await fastify.prisma.collection.findMany({
      where: {
        ...(branchId ? { group: { branchId } } : {}),
        status: "APPROVED"
      },
      select: {
        amountCollected: true,
        date: true
      },
      orderBy: { date: "asc" }
    });

    // Group collections by month
    const monthlyGroups = {};
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = formatMonthKeySL(d);
      monthlyGroups[key] = 0;
    }

    for (const col of collections) {
      const colDate = new Date(col.date);
      const key = formatMonthKeySL(colDate);
      if (monthlyGroups[key] !== undefined) {
        monthlyGroups[key] += Number(col.amountCollected || 0);
      }
    }

    const chartData = Object.keys(monthlyGroups).map(month => ({
      month,
      amount: monthlyGroups[month]
    }));

    // 5. Recent Collections Log
    const recentCollectionsData = await fastify.prisma.collection.findMany({
      where: branchId ? { group: { branchId } } : {},
      take: 5,
      orderBy: { createdAt: "desc" },
      include: {
        group: {
          select: { name: true, groupNo: true }
        }
      }
    });

    const recentCollections = recentCollectionsData.map(col => ({
      id: col.id,
      groupName: col.group?.name || "N/A",
      groupNo: col.group?.groupNo || "N/A",
      amount: Number(col.amountCollected),
      status: col.status,
      date: col.date
    }));

    return {
      success: true,
      stats: {
        totalGroups,
        totalClients,
        totalOutstanding,
        totalCollected,
        collectionRate: Math.round(collectionRate * 10) / 10,
        chartData,
        recentCollections
      }
    };
  });
}
