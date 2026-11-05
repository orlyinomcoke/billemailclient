import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL!, password = process.env.ADMIN_PASSWORD!;
  if (!email || !password) throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD");
  await db.user.upsert({
    where: { email: email.toLowerCase() },
    create: { email: email.toLowerCase(), name: "Admin", role: "ADMIN", passwordHash: await bcrypt.hash(password, 10) },
    update: {},
  });
  console.log("Admin ready:", email);
}
main().finally(() => db.$disconnect());
