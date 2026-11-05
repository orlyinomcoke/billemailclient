import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import Mail from "./Mail";

export default async function Home() {
  const s = await getSession();
  if (!s) redirect("/login");
  return <Mail user={s} />;
}
