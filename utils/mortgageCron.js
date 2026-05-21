// utils/mortgageCron.js

/**
 * Monthly Mortgage Instalment Generator
 *
 * Logic:
 *  - Month 1 is always the upfront interest instalment created during approval (already exists)
 *  - Starting from Month 2, each monthly instalment uses the regular monthlyDueAmount
 *  - The base anchor date is mortgage.approvedAt (the date the loan was approved)
 *    e.g. Approved Jan 3 → Month 2 anniversary = Feb 3, Month 3 = Mar 3, etc.
 *  - instalment createdAt  = anniversary date (e.g. Feb 3)
 *  - instalment dueDate    = anniversary date + 3 days (e.g. Feb 6)
 *  - This cron runs daily and creates any missing instalments up to the current month
 */
export async function processMortgageInstalments(prisma, log) {
  log.info("⏰ Starting mortgage instalments generation job...");
  const today = new Date();

  try {
    // 1. Fetch all APPROVED mortgage loans with their instalments
    const mortgages = await prisma.mortgageLoan.findMany({
      where: { status: "APPROVED" },
      include: {
        instalments: {
          orderBy: { monthNumber: "asc" }
        }
      }
    });

    log.info(`Found ${mortgages.length} approved mortgage loans to check.`);

    let totalCreated = 0;

    for (const mortgage of mortgages) {
      // Use approvedAt as the anchor; fall back to createdAt for legacy records
      const anchorDate = new Date(mortgage.approvedAt ?? mortgage.createdAt);

      // Calculate how many complete months have elapsed since approval
      // e.g. Approved Jan 3, today Mar 5 → monthsElapsed = 2
      let monthsElapsed =
        (today.getFullYear() - anchorDate.getFullYear()) * 12 +
        (today.getMonth() - anchorDate.getMonth());

      // If today hasn't yet reached the day-of-month of approval, that month hasn't ticked over
      if (today.getDate() < anchorDate.getDate()) {
        monthsElapsed--;
      }

      // Required instalments:
      //   Month 1 (upfront, PAID)  → created at approval
      //   Month 2, 3 … N          → one per elapsed month after approval
      // So total required = 1 (Month 1) + monthsElapsed
      const requiredInstalmentCount = monthsElapsed + 1;

      const currentCount = mortgage.instalments.length;

      if (currentCount >= requiredInstalmentCount) {
        // Nothing to do for this loan
        continue;
      }

      log.info(
        `Mortgage ${mortgage.loanNo}: required=${requiredInstalmentCount}, ` +
        `existing=${currentCount}. Creating ${requiredInstalmentCount - currentCount} new instalment(s)...`
      );

      // Fill in missing instalments from (currentCount+1) to requiredInstalmentCount
      for (let m = currentCount + 1; m <= requiredInstalmentCount; m++) {
        // Anniversary date: (m-1) months after the approval date
        // m=2 → 1 month after approval → Feb 3 (if approved Jan 3)
        const instCreationDate = new Date(anchorDate);
        instCreationDate.setMonth(anchorDate.getMonth() + (m - 1));

        // Guard against month overflow (e.g. Jan 31 + 1 month → Mar 3 in JS)
        // Clamp to last day of the intended month
        const targetMonthIndex = (anchorDate.getMonth() + (m - 1)) % 12;
        if (instCreationDate.getMonth() !== targetMonthIndex) {
          instCreationDate.setDate(0); // moves back to last day of previous month
        }

        // Due date = anniversary date + 3 days
        const instDueDate = new Date(instCreationDate);
        instDueDate.setDate(instCreationDate.getDate() + 3);

        // Month 2+ always use the regular monthly interest amount
        const dueAmount = mortgage.monthlyDueAmount;

        await prisma.mortgageInstalment.create({
          data: {
            mortgageId: mortgage.id,
            clientId: mortgage.clientId,
            monthNumber: m,
            dueDate: instDueDate,
            dueAmount: dueAmount,
            paidAmount: 0.0,
            remainingDue: dueAmount,
            status: "UNPAID",
            createdAt: instCreationDate, // anniversary date as creation timestamp
          }
        });

        totalCreated++;
        log.info(
          `  ✔ Month ${m} for ${mortgage.loanNo} — ` +
          `Instalment Date: ${instCreationDate.toDateString()}, ` +
          `Due Date: ${instDueDate.toDateString()}`
        );
      }
    }

    log.info(
      `⏰ Job complete. Created ${totalCreated} new instalment(s).`
    );
    return { success: true, totalCreated };
  } catch (error) {
    log.error("❌ Error in mortgage instalments generation job:", error);
    throw error;
  }
}
