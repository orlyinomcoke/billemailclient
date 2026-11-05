import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET() {
  if (!(await getSession())) return new Response("Unauthorized", { status: 401 });
  return Response.json(await db.business.findMany({ orderBy: { name: "asc" } }));
}

export async function POST(req: Request) {
  const s = await getSession();
  if (s?.role !== "ADMIN") return new Response("Forbidden", { status: 403 });
  const { name, color } = await req.json();
  return Response.json(await db.business.create({ data: { name, color } }));
}
