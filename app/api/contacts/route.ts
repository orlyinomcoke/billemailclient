import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

// The per-person "folders" sidebar
export async function GET(req: Request) {
  if (!(await getSession())) return new Response("Unauthorized", { status: 401 });
  const businessId = new URL(req.url).searchParams.get("businessId") || undefined;
  const contacts = await db.contact.findMany({
    where: { businessId },
    orderBy: [{ name: "asc" }, { email: "asc" }],
    include: { _count: { select: { messages: { where: { isRead: false, direction: "in" } } } } },
  });
  return Response.json(contacts.map(c => ({ ...c, unread: c._count.messages })));
}
