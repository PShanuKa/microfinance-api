// routes/mortgage-dashboard/index.js

export default async function mortgageDashboardRoutes(fastify, opts) {
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.get("/stats", async (request, reply) => {
    const { branchId } = request.query;

    // Base branch filter for MortgageLoan
    const loanBranchFilter = branchId ? { branchId } : {};

    // ──────────────────────────────────────────────
    // 1. KPI Counts
    // ──────────────────────────────────────────────

    // Total mortgage loans (all statuses)
    const totalMortgageLoans = await fastify.prisma.mortgageLoan.count({
      where: loanBranchFilter,
    });

    // Active loans (APPROVED)
    const activeLoans = await fastify.prisma.mortgageLoan.count({
      where: { ...loanBranchFilter, status: "APPROVED" },
    });

    // Completed loans
    const completedLoans = await fastify.prisma.mortgageLoan.count({
      where: { ...loanBranchFilter, status: "COMPLETED" },
    });

    // Total Lent Amount (APPROVED + COMPLETED only)
    const lentAgg = await fastify.prisma.mortgageLoan.aggregate({
      where: {
        ...loanBranchFilter,
        status: { in: ["APPROVED", "COMPLETED"] },
      },
      _sum: { lentAmount: true },
    });
    const totalLentAmount = Number(lentAgg._sum.lentAmount || 0);

    // ──────────────────────────────────────────────
    // 2. Outstanding & Collected from Instalments/Collections
    // ──────────────────────────────────────────────

    const instalmentBranchFilter = branchId
      ? { mortgage: { branchId } }
      : {};

    const instalmentAgg = await fastify.prisma.mortgageInstalment.aggregate({
      where: {
        ...instalmentBranchFilter,
        mortgage: {
          ...instalmentBranchFilter.mortgage,
          status: { in: ["APPROVED", "COMPLETED"] },
        },
      },
      _sum: {
        remainingDue: true,
        paidAmount: true,
        dueAmount: true,
      },
    });

    const totalOutstanding = Number(instalmentAgg._sum.remainingDue || 0);
    const totalPaidFromInstalments = Number(instalmentAgg._sum.paidAmount || 0);
    const totalDue = Number(instalmentAgg._sum.dueAmount || 0);

    // Total collected from MortgageCollection
    const collectionBranchFilter = branchId
      ? { mortgage: { branchId } }
      : {};

    const collectionAgg = await fastify.prisma.mortgageCollection.aggregate({
      where: collectionBranchFilter,
      _sum: { amount: true },
    });
    const totalCollected = Number(collectionAgg._sum.amount || 0);

    // Collection rate
    const collectionRate = totalDue > 0
      ? Math.round(((totalPaidFromInstalments / totalDue) * 100) * 10) / 10
      : 0;

    // ──────────────────────────────────────────────
    // 3. Pending / Draft Approval Stats
    // ──────────────────────────────────────────────

    const pendingLoansCount = await fastify.prisma.mortgageLoan.count({
      where: { ...loanBranchFilter, status: "PENDING" },
    });

    const pendingLentAgg = await fastify.prisma.mortgageLoan.aggregate({
      where: { ...loanBranchFilter, status: "PENDING" },
      _sum: { lentAmount: true },
    });
    const pendingLoanAmount = Number(pendingLentAgg._sum.lentAmount || 0);

    const draftLoansCount = await fastify.prisma.mortgageLoan.count({
      where: { ...loanBranchFilter, status: "DRAFT" },
    });

    const draftLentAgg = await fastify.prisma.mortgageLoan.aggregate({
      where: { ...loanBranchFilter, status: "DRAFT" },
      _sum: { lentAmount: true },
    });
    const draftLoanAmount = Number(draftLentAgg._sum.lentAmount || 0);

    // ──────────────────────────────────────────────
    // 4. Overdue Instalments
    // ──────────────────────────────────────────────

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const overdueInstalments = await fastify.prisma.mortgageInstalment.count({
      where: {
        ...instalmentBranchFilter,
        mortgage: {
          ...instalmentBranchFilter.mortgage,
          status: "APPROVED",
        },
        status: { in: ["UNPAID", "PARTIAL", "OVERDUE"] },
        dueDate: { lt: today },
      },
    });

    // ──────────────────────────────────────────────
    // 5. Monthly Collection Chart (Last 6 Months)
    // ──────────────────────────────────────────────

    const collections = await fastify.prisma.mortgageCollection.findMany({
      where: collectionBranchFilter,
      select: {
        amount: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });

    const monthlyGroups = {};
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key =
        d.toLocaleString("en-US", { month: "short" }) +
        " " +
        d.getFullYear().toString().slice(-2);
      monthlyGroups[key] = 0;
    }

    for (const col of collections) {
      const colDate = new Date(col.createdAt);
      const key =
        colDate.toLocaleString("en-US", { month: "short" }) +
        " " +
        colDate.getFullYear().toString().slice(-2);
      if (monthlyGroups[key] !== undefined) {
        monthlyGroups[key] += Number(col.amount || 0);
      }
    }

    const chartData = Object.keys(monthlyGroups).map((month) => ({
      month,
      amount: monthlyGroups[month],
    }));

    // ──────────────────────────────────────────────
    // 6. Recent Mortgage Collections (Last 5)
    // ──────────────────────────────────────────────

    const recentCollectionsData =
      await fastify.prisma.mortgageCollection.findMany({
        where: collectionBranchFilter,
        take: 5,
        orderBy: { createdAt: "desc" },
        include: {
          client: { select: { fullname: true, clientNo: true } },
          mortgage: { select: { loanNo: true } },
          collectedBy: { select: { fullname: true } },
        },
      });

    const recentCollections = recentCollectionsData.map((col) => ({
      id: col.id,
      clientName: col.client?.fullname || "N/A",
      clientNo: col.client?.clientNo || "N/A",
      loanNo: col.mortgage?.loanNo || "N/A",
      collectedBy: col.collectedBy?.fullname || "N/A",
      amount: Number(col.amount),
      date: col.createdAt,
    }));

    // ──────────────────────────────────────────────
    // Return
    // ──────────────────────────────────────────────

    return {
      success: true,
      stats: {
        totalMortgageLoans,
        activeLoans,
        completedLoans,
        totalLentAmount,
        totalOutstanding,
        totalCollected,
        collectionRate,
        pendingLoansCount,
        pendingLoanAmount,
        draftLoansCount,
        draftLoanAmount,
        overdueInstalments,
        chartData,
        recentCollections,
      },
    };
  });
}
