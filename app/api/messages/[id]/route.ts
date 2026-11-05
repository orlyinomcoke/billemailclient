import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Ctx) {
  if (!(await getSession())) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const m = await db.message.update({
    where: { id }, data: { isRead: true },
    include: { contact: true, business: true },
  });
  return Response.json(m);
}

// PATCH { businessId, applyToContact } — set the business category on an email.
// applyToContact also makes it the default for that person and tags all their mail.
export async function PATCH(req: Request, { params }: Ctx) {
  if (!(await getSession())) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const { businessId, applyToContact } = await req.json();
  const m = await db.message.update({ where: { id }, data: { businessId: businessId || null } });
  if (applyToContact && m.contactId) {
    await db.contact.update({ where: { id: m.contactId }, data: { businessId: businessId || null } });
    await db.message.updateMany({ where: { contactId: m.contactId }, data: { businessId: businessId || null } });
  }
  return Response.json({ ok: true });
}
