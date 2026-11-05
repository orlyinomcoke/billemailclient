import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

// GET /api/messages?contactId=&businessId=&q=&unassigned=1&assigned=1&direction=in|out&category=inbox|newsletter|auto
export async function GET(req: Request) {
  if (!(await getSession())) return new Response("Unauthorized", { status: 401 });
  const p = new URL(req.url).searchParams;
  const q = p.get("q");
  const messages = await db.message.findMany({
    where: {
      contactId: p.get("contactId") || undefined,
      businessId: p.get("unassigned") ? null : p.get("assigned") ? { not: null } : p.get("businessId") || undefined,
      direction: p.get("direction") || undefined,
      category: p.get("category") || undefined,
      OR: q ? [
        { subject: { contains: q } },
        { preview: { contains: q } },
        { fromEmail: { contains: q } },
      ] : undefined,
    },
    orderBy: { receivedAt: "desc" },
    take: 100,
    select: {
      id: true, subject: true, fromEmail: true, fromName: true, preview: true, toEmails: true,
      receivedAt: true, isRead: true, direction: true, businessId: true, category: true,
      contact: { select: { id: true, email: true, name: true, doNotContact: true } },
    },
  });
  return Response.json(messages);
}
