import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function migrateRoles() {
  console.log("Starting role migration...");
  const users = await prisma.user.findMany();
  console.log(`Found ${users.length} users to migrate.`);
  
  for (const user of users) {
    if (user.role && (!user.roles || user.roles.length === 0 || JSON.stringify(user.roles) === '["LOAN_OFFICER"]')) {
      const rolesArray = [user.role];
      await prisma.user.update({
        where: { id: user.id },
        data: { roles: rolesArray }
      });
      console.log(`Migrated user ${user.id} (${user.email}) -> roles:`, rolesArray);
    }
  }
  
  console.log("Migration complete!");
}

migrateRoles()
  .catch(e => {
    console.error("Migration failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
