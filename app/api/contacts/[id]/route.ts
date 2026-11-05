import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

// PATCH { doNotContact, dncReason, businessId, name }
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const b = await req.json();
  const c = await db.contact.update({
    where: { id },
    data: {
      ...(b.name !== undefined && { name: b.name }),
      ...(b.businessId !== undefined && { businessId: b.businessId || null }),
      ...(b.doNotContact !== undefined && {
        doNotContact: !!b.doNotContact,
        dncReason: b.doNotContact ? b.dncReason ?? null : null,
        dncSetAt: b.doNotContact ? new Date() : null,
      }),
    },
  });
  return Response.json(c);
}
