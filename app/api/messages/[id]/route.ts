import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { scheduleSheetPush } from "@/lib/sheets";

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
// PATCH { folder: "inbox" | "newsletter" | "auto" } — move to another folder. For inbox/newsletter this
// becomes a rule for the sender, so all their past and future mail goes there too.
export async function PATCH(req: Request, { params }: Ctx) {
  if (!(await getSession())) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const body = await req.json();
  if (body.folder !== undefined) {
    const folder = String(body.folder);
    if (!["inbox", "newsletter", "auto"].includes(folder)) return Response.json({ error: "Unknown folder" }, { status: 400 });
    const m = await db.message.update({ where: { id }, data: { category: folder } });
    if (folder !== "auto" && m.contactId) {
      await db.contact.update({ where: { id: m.contactId }, data: { mailRule: folder } });
      await db.message.updateMany({
        where: { contactId: m.contactId, direction: "in", category: { not: "auto" } }, data: { category: folder },
      });
    }
    return Response.json({ ok: true });
  }
  const { businessId, applyToContact } = body;
  const m = await db.message.update({ where: { id }, data: { businessId: businessId || null } });
  if (applyToContact && m.contactId) {
    await db.contact.update({ where: { id: m.contactId }, data: { businessId: businessId || null } });
    await db.message.updateMany({ where: { contactId: m.contactId }, data: { businessId: businessId || null } });
    scheduleSheetPush();
  }
  return Response.json({ ok: true });
}
