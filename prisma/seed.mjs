// Creates the first ADMIN login from ADMIN_EMAIL / ADMIN_PASSWORD (only if that user doesn't exist yet).
// Runs automatically on every start; safe to repeat. Plain JS so it needs no build step.
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
try {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.log("Seed: ADMIN_EMAIL / ADMIN_PASSWORD not set, skipping admin creation");
  } else if (await db.user.findUnique({ where: { email } })) {
    console.log("Seed: admin already exists:", email);
  } else {
    await db.user.create({ data: { email, name: "Admin", role: "ADMIN", passwordHash: await bcrypt.hash(password, 10) } });
    console.log("Seed: admin created:", email);
  }
} finally {
  await db.$disconnect();
}
