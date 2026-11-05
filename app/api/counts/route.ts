import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";

// Unread counts for the sidebar
export async function GET() {
  if (!(await getSession())) return new Response("Unauthorized", { status: 401 });
  const where = { isRead: false, direction: "in" };
  const [byCat, byBiz] = await Promise.all([
    db.message.groupBy({ by: ["category"], where, _count: { _all: true } }),
    db.message.groupBy({ by: ["businessId"], where: { ...where, category: "inbox", businessId: { not: null } }, _count: { _all: true } }),
  ]);
  const cat = (c: string) => byCat.find(x => x.category === c)?._count._all ?? 0;
  return Response.json({
    inbox: cat("inbox"), newsletter: cat("newsletter"), auto: cat("auto"),
    business: Object.fromEntries(byBiz.map(b => [b.businessId, b._count._all])),
  });
}
