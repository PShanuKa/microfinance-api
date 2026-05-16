import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkData() {
  const targetDate = "2026-05-24";
  const start = new Date(targetDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(targetDate);
  end.setHours(23, 59, 59, 999);

  console.log("Searching between:", start.toISOString(), "and", end.toISOString());

  const countAll = await prisma.instalment.count({
    where: {
      dueDate: {
        gte: start,
        lte: end
      }
    }
  });
  console.log("Total instalments for this date:", countAll);

  const instalments = await prisma.instalment.findMany({
    where: {
      dueDate: {
        gte: start,
        lte: end
      }
    },
    include: {
      loan: true
    }
  });

  const statuses = [...new Set(instalments.map(i => i.loan.status))];
  console.log("Loan statuses found for these instalments:", statuses);

  process.exit(0);
}

checkData();
