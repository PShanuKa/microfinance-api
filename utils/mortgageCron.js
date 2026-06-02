// utils/mortgageCron.js

/**
 * Monthly Mortgage Instalment Generator (Timezone & Leap-Year Fixed)
 */
export async function processMortgageInstalments(prisma, log) {
  log.info("⏰ Starting mortgage instalments generation job...");

  
  const normalizeDate = (dateInput) => {
    if (!dateInput) return null;
    const d = new Date(dateInput);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  };

  const today = normalizeDate(new Date());

  try {
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
      
      const anchorDate = normalizeDate(mortgage.approvedAt ?? mortgage.createdAt);
      const currentCount = mortgage.instalments.length;

  
      let m = currentCount + 1;
      let keepChecking = true;

    
      while (keepChecking) {
        
        const instCreationDate = new Date(anchorDate);
        instCreationDate.setUTCMonth(anchorDate.getUTCMonth() + (m - 1));


        const targetMonthIndex = (anchorDate.getUTCMonth() + (m - 1)) % 12;
        if (instCreationDate.getUTCMonth() !== targetMonthIndex) {
          instCreationDate.setUTCDate(0); 
        }

        if (today >= instCreationDate) {
          
     
          const instDueDate = new Date(instCreationDate);
          instDueDate.setUTCDate(instCreationDate.getUTCDate() + 2);

          const remainingPrincipal = Math.max(0, Number(mortgage.lentAmount) - Number(mortgage.principalPaid || 0));
          const dueAmount = remainingPrincipal * (Number(mortgage.interestRate) / 100);

          const result = await prisma.mortgageInstalment.upsert({
            where: {
              mortgageId_clientId_monthNumber: {
                mortgageId:  mortgage.id,
                clientId:    mortgage.clientId,
                monthNumber: m,
              }
            },
            create: {
              mortgageId:  mortgage.id,
              clientId:    mortgage.clientId,
              monthNumber: m,
              dueDate:     instDueDate,
              dueAmount:   dueAmount,
              paidAmount:  0.0,
              remainingDue: dueAmount,
              status:      "UNPAID",
              createdAt:   instCreationDate, 
            },
            update: {}
          });

          if (result.createdAt.getTime() === result.updatedAt.getTime()) {
            totalCreated++;
            log.info(
              `  ✔ Month ${m} for ${mortgage.loanNo} — ` +
              `Instalment Date: ${instCreationDate.toISOString().split('T')[0]}, ` +
              `Due Date: ${instDueDate.toISOString().split('T')[0]}`
            );
          } else {
            log.info(`  ⚡ Month ${m} for ${mortgage.loanNo} already exists — skipped.`);
          }

          m++; 
        } else {
         
          keepChecking = false;
        }
      }
    }

    log.info(`⏰ Job complete. Created ${totalCreated} new instalment(s).`);
    return { success: true, totalCreated };
  } catch (error) {
    log.error("❌ Error in mortgage instalments generation job:", error);
    throw error;
  }
}