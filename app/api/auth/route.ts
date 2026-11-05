import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth";

export async function POST(req: Request) {
  const { email, password } = await req.json();
  // First run: if there are no users yet, logging in with ADMIN_EMAIL/ADMIN_PASSWORD creates the admin.
  if (
    (await db.user.count()) === 0 &&
    process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD &&
    String(email).toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase() &&
    password === process.env.ADMIN_PASSWORD
  ) {
    await db.user.create({ data: {
      email: process.env.ADMIN_EMAIL.toLowerCase(), name: "Admin", role: "ADMIN",
      passwordHash: await bcrypt.hash(password, 10),
    } });
  }
  const u = await db.user.findUnique({ where: { email: String(email).toLowerCase() } });
  if (!u || !(await bcrypt.compare(password, u.passwordHash)))
    return Response.json({ error: "Invalid email or password" }, { status: 401 });
  await createSession({ uid: u.id, role: u.role, name: u.name });
  return Response.json({ ok: true });
}

export async function DELETE() {
  (await cookies()).delete("session");
  return Response.json({ ok: true });
}
