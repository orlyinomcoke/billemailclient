import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

// PATCH { name, color } — rename / recolor a business (ADMIN only)
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (s?.role !== "ADMIN") return Response.json({ error: "Only admins can edit businesses" }, { status: 403 });
  const { id } = await params;
  const { name, color } = await req.json();
  const clash = name && await db.business.findFirst({ where: { name, NOT: { id } } });
  if (clash) return Response.json({ error: `A business named "${name}" already exists` }, { status: 409 });
  const b = await db.business.update({
    where: { id },
    data: { ...(name && { name: String(name).trim() }), ...(color && { color }) },
  });
  return Response.json(b);
}
