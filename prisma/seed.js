import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // 1. Create or Find the Branch "Arunodayata Saviyak"
  let branch = await prisma.branch.findFirst({
    where: { name: 'Arunodayata Saviyak' }
  });

  if (!branch) {
    branch = await prisma.branch.create({
      data: {
        name: 'Arunodayata Saviyak',
        address: 'No 45, Arunodayata Saviyak,  Sri Lanka'
      }
    });
    console.log(`🏢 Created Branch: ${branch.name}`);
  } else {
    console.log(`🏢 Branch already exists: ${branch.name}`);
  }

  // 2. Create or Find the Admin User: admin@gmail.com / admin123
  let admin = await prisma.user.findUnique({
    where: { email: 'admin@gmail.com' }
  });

  if (!admin) {
    const hashedPassword = await bcrypt.hash('admin123', 10);
    admin = await prisma.user.create({
      data: {
        fullname: 'System Administrator',
        email: 'admin@gmail.com',
        password: hashedPassword,
        roles: ['ADMIN'],
        status: true,
        branchId: branch.id
      }
    });
    console.log(`👤 Created Admin User: ${admin.email}`);
  } else {
    console.log(`👤 Admin User already exists: ${admin.email}`);
  }

  // 3. Create Default System Settings (for microfinance configs)
  let settings = await prisma.settings.findUnique({
    where: { id: 'default' }
  });

  if (!settings) {
    settings = await prisma.settings.create({
      data: {
        id: 'default',
        lateWeeksFlag: 3,
        minLoanWeeks: 4,
        maxLoanWeeks: 52,
        defaultLoanWeeks: 50,
        maxActiveLoansGroup: 1
      }
    });
    console.log('⚙️ Created default settings');
  }

  console.log('✅ Seeding complete');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
