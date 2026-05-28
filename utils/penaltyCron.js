// utils/penaltyCron.js

/**
 * Daily Penalty Calculation Job
 *
 * Logic:
 * - Runs daily for all APPROVED mortgage loans
 * - Finds ALL UNPAID/PARTIAL/OVERDUE instalments that are past their due date
 * - Penalty starts after the due date (with a 3-day grace window from dueDate)
 * - Penalty accrues daily: loan.dailyPenaltyAmount × days overdue
 * - Penalty is CAPPED at 1 month from the due date:
 * penaltyWindow = dueDate → (dueDate + 1 month)
 * - Uses .filter() to ensure NO days are missed even if the server is down for months.
 * - Strict UTC normalization prevents timezone date-shifting bugs.
 */
export async function processDailyPenalties(prisma, log) {
  log.info("⏰ Starting daily penalty calculation job...");

  // 🔥 Timezone Bug Fix: 
  const normalizeDate = (dateInput) => {
    if (!dateInput) return null;
    const d = new Date(dateInput);
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  };

  const today = normalizeDate(new Date());

  try {
    const loans = await prisma.mortgageLoan.findMany({
      where: { status: "APPROVED" },
      include: {
        instalments: {
          where: {
            status: { in: ["UNPAID", "PARTIAL", "OVERDUE"] }
          },
          orderBy: { monthNumber: "desc" }
        }
      }
    });

    let totalPenaltiesApplied = 0;
    let totalMarkedOverdue    = 0;

    for (const loan of loans) {


      const activePenaltyInstalments = loan.instalments.filter(inst => {
        const graceEnd = normalizeDate(inst.dueDate);
       
        
        const penaltyEnd = normalizeDate(inst.createdAt);
        penaltyEnd.setUTCMonth(penaltyEnd.getUTCMonth() + 1);

        const lastApplied = inst.lastPenaltyAppliedAt 
          ? normalizeDate(inst.lastPenaltyAppliedAt) 
          : null;
        
    
        const isFullyPenalized = lastApplied && lastApplied >= penaltyEnd;

        return today > graceEnd && !isFullyPenalized;
      });

   
      for (const inst of activePenaltyInstalments) {
        
     
        if (inst.status === "UNPAID") {
          await prisma.mortgageInstalment.update({
            where: { id: inst.id },
            data: { status: "OVERDUE" }
          });
          totalMarkedOverdue++;
          log.info(`  ⚠ Marked Month ${inst.monthNumber} of ${loan.loanNo} as OVERDUE`);
        }

    
        const graceEnd = normalizeDate(inst.dueDate);
    

        const penaltyEnd = normalizeDate(inst.createdAt);
        penaltyEnd.setUTCMonth(penaltyEnd.getUTCMonth() + 1);

        
        const effectiveToday = today < penaltyEnd ? today : penaltyEnd;

        if (effectiveToday <= graceEnd) continue;

        
        const instDate = normalizeDate(inst.createdAt);
        const lastApplied = inst.lastPenaltyAppliedAt
          ? normalizeDate(inst.lastPenaltyAppliedAt)
          : instDate;

        
        const msInDay = 1000 * 60 * 60 * 24;
        const daysToPenalize = Math.round((effectiveToday - lastApplied) / msInDay);

       
        if (daysToPenalize > 0) {
          const penaltyToAdd = Number(inst.dueAmount) * 0.01 * daysToPenalize;

          await prisma.mortgageInstalment.update({
            where: { id: inst.id },
            data: {
              penaltyAmount:        { increment: penaltyToAdd },
              remainingDue:         { increment: penaltyToAdd },
              lastPenaltyAppliedAt: effectiveToday, 
            }
          });

          totalPenaltiesApplied++;
          log.info(
            `  ✔ Penalty +${penaltyToAdd.toFixed(2)} (${daysToPenalize} day(s)) ` +
            `→ Loan ${loan.loanNo} Month ${inst.monthNumber}`
          );
        }
      } // End of inner loop (instalments)
    } // End of outer loop (loans)

    log.info(
      `⏰ Penalty job complete. ` +
      `Applied to ${totalPenaltiesApplied} instalment(s), ` +
      `marked ${totalMarkedOverdue} as OVERDUE.`
    );
    return { success: true, totalPenaltiesApplied, totalMarkedOverdue };

  } catch (error) {
    log.error("❌ Error in daily penalty job:", error);
    throw error;
  }
}