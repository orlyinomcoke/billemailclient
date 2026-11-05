import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth";

export async function POST(req: Request) {
  const { email, password } = await req.json();
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
