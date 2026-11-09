"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { Avatar, Icon, I } from "./ui";
import Contacts from "./Contacts";

const AUTO_SYNC_MS = 2 * 60 * 1000; // how often the app syncs while open

type Business = { id: string; name: string; color: string };
type Contact = { id: string; email: string; name?: string; doNotContact: boolean; dncReason?: string; businessId?: string };
type Row = {
  id: string; subject: string; fromEmail: string; fromName?: string; toEmails?: string[]; preview: string;
  receivedAt: string; isRead: boolean; direction: string; businessId?: string; contact?: Contact;
};
type Filter = { key: string; businessId?: string; unassigned?: boolean; assigned?: boolean; direction?: "in" | "out"; category?: "inbox" | "newsletter" | "auto" };

// Built-in folders. "inbox" category = real email (newsletters and auto-replies are sorted out).
const FOLDERS: Record<string, Filter & { label: string }> = {
  inbox: { key: "inbox", label: "Inbox", direction: "in", category: "inbox" },
  sent: { key: "sent", label: "Sent", direction: "out" },
  newsletter: { key: "newsletter", label: "Newsletters", category: "newsletter" },
  auto: { key: "auto", label: "Auto-replies", category: "auto" },
  assigned: { key: "assigned", label: "Assigned", assigned: true, category: "inbox" },
  unassigned: { key: "unassigned", label: "Unassigned", unassigned: true, category: "inbox" },
};

const j = (url: string, init?: RequestInit) => fetch(url, init).then(r => r.json());

// Outlook-style timestamps: time today, weekday this week, date otherwise
function when(d: string) {
  const t = new Date(d), now = new Date();
  if (t.toDateString() === now.toDateString()) return t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (now.getTime() - t.getTime() < 6 * 86_400_000) return t.toLocaleDateString([], { weekday: "short" });
  return t.toLocaleDateString([], { month: "short", day: "numeric", ...(t.getFullYear() !== now.getFullYear() && { year: "numeric" }) });
}

// Who to show on a row: the sender for received mail, the recipient for sent mail
function person(r: Row) {
  if (r.direction === "out") return { name: r.contact?.name, email: r.contact?.email || r.toEmails?.[0] || "" };
  return { name: r.fromName || r.contact?.name, email: r.fromEmail };
}

const emailDoc = (html: string) => `<!doctype html><html><head><meta charset="utf-8"><base target="_blank">
<style>body{margin:0;padding:2px;font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;color:#1f2937;word-wrap:break-word}
img{max-width:100%;height:auto}a{color:#2563eb}</style></head><body>${html}</body></html>`;

function Chip({ b }: { b: Business }) {
  return <span className="chip" style={{ "--c": b.color } as React.CSSProperties}><span className="dot" />{b.name}</span>;
}

function NavItem({ on, icon, dot, label, count, onClick, children }: {
  on: boolean; icon?: string; dot?: string; label: string; count?: number; onClick: () => void; children?: React.ReactNode;
}) {
  return (
    <div className={`nav ${on ? "on" : ""}`} onClick={onClick}>
      {icon && <Icon d={icon} />}
      {dot && <span className="dot" style={{ background: dot }} />}
      <span className="label">{label}</span>
      {!!count && <span className="count">{count.toLocaleString()}</span>}
      {children}
    </div>
  );
}

/* ---------- main app ---------- */

export default function Mail({ user }: { user: { name: string; role: string } }) {
  const isAdmin = user.role === "ADMIN";
  const [biz, setBiz] = useState<Business[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [counts, setCounts] = useState<{ inbox: number; newsletter: number; auto: number; business: Record<string, number> }>({ inbox: 0, newsletter: 0, auto: 0, business: {} });
  const [view, setView] = useState<"mail" | "contacts" | "autoContacts">("mail");
  const [filter, setFilter] = useState<Filter>(FOLDERS.inbox);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<any>(null);
  const [compose, setCompose] = useState<null | { to: string; subject: string; body: string }>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("Checking for mail…");

  const load = useCallback(async () => {
    const p = new URLSearchParams();
    if (filter.businessId) p.set("businessId", filter.businessId);
    if (filter.unassigned) p.set("unassigned", "1");
    if (filter.assigned) p.set("assigned", "1");
    if (filter.direction) p.set("direction", filter.direction);
    if (filter.category) p.set("category", filter.category);
    if (q) p.set("q", q);
    const [r, c] = await Promise.all([j(`/api/messages?${p}`), j("/api/counts")]);
    if (Array.isArray(r)) setRows(r);
    if (c && typeof c.inbox === "number") setCounts(c);
  }, [filter, q]);

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => { j("/api/businesses").then(setBiz); }, []);
  useEffect(() => { load(); }, [load]);

  // Sync: keeps calling the server while it reports more to import (first run), then stops.
  const busy = useRef(false);
  const sync = useCallback(async () => {
    if (busy.current) return;
    busy.current = true; setSyncing(true);
    try {
      for (;;) {
        const r = await fetch("/api/sync", { method: "POST" });
        if (!r.ok) { setSyncMsg("Sync failed · retrying soon"); break; }
        const d = await r.json();
        if (d.busy) break;
        await loadRef.current();
        if (d.done) { setSyncMsg(`Up to date · ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`); break; }
        setSyncMsg(`Importing mail… ${Number(d.total).toLocaleString()} so far`);
      }
    } catch { setSyncMsg("Sync failed · retrying soon"); }
    finally { busy.current = false; setSyncing(false); }
  }, []);

  // Sync when the app opens, then every 2 minutes
  useEffect(() => {
    sync();
    const t = setInterval(sync, AUTO_SYNC_MS);
    return () => clearInterval(t);
  }, [sync]);

  async function openMsg(id: string) { setOpen(await j(`/api/messages/${id}`)); load(); }

  async function setBusiness(businessId: string, applyToContact: boolean) {
    await fetch(`/api/messages/${open.id}`, { method: "PATCH", body: JSON.stringify({ businessId, applyToContact }) });
    setOpen(await j(`/api/messages/${open.id}`)); load();
  }
  async function toggleDnc(c: Contact) {
    const dncReason = !c.doNotContact ? prompt("Reason for Do Not Contact (optional)") ?? "" : undefined;
    await fetch(`/api/contacts/${c.id}`, { method: "PATCH", body: JSON.stringify({ doNotContact: !c.doNotContact, dncReason }) });
    if (open) setOpen(await j(`/api/messages/${open.id}`)); load();
  }
  async function addBusiness() {
    const name = prompt("Business name"); if (!name?.trim()) return;
    const color = prompt("Color (hex)", "#10b981") || "#10b981";
    await fetch("/api/businesses", { method: "POST", body: JSON.stringify({ name: name.trim(), color }) });
    setBiz(await j("/api/businesses"));
  }
  async function editBusiness(b: Business) {
    const name = prompt("Rename business", b.name); if (!name?.trim()) return;
    const color = prompt("Color (hex)", b.color) || b.color;
    const r = await fetch(`/api/businesses/${b.id}`, { method: "PATCH", body: JSON.stringify({ name: name.trim(), color }) });
    if (!r.ok) alert((await r.json().catch(() => null))?.error || "Could not rename business");
    setBiz(await j("/api/businesses"));
  }
  const bizOf = (id?: string) => biz.find(b => b.id === id);
  const go = (f: Filter) => { setView("mail"); setFilter(f); setOpen(null); };
  const inMail = view === "mail";

  const title = filter.businessId ? bizOf(filter.businessId)?.name ?? "Business" : FOLDERS[filter.key]?.label ?? "Inbox";
  const folderNav = (key: string, icon: string, count?: number) => (
    <NavItem on={inMail && filter.key === key} icon={icon} label={FOLDERS[key].label} count={count} onClick={() => go(FOLDERS[key])} />
  );

  // Move to Inbox / Newsletters (applies to the sender's past and future mail) or Auto-replies (this email only)
  async function moveTo(folder: "inbox" | "newsletter") {
    await fetch(`/api/messages/${open.id}`, { method: "PATCH", body: JSON.stringify({ folder }) });
    setOpen(await j(`/api/messages/${open.id}`)); load();
  }

  return (
    <div className={`app ${inMail && open ? "reading" : ""} ${inMail ? "" : "contacts-mode"}`}>
      {/* ---------- Sidebar ---------- */}
      <aside className="side">
        <div className="brand"><span className="logo"><Icon d={I.mail} size={16} /></span>MailHub</div>
        <button className="primary new" onClick={() => setCompose({ to: "", subject: "", body: "" })}>
          <Icon d={I.plus} /> New email
        </button>

        {folderNav("inbox", I.inbox, counts.inbox)}
        {folderNav("sent", I.sent)}
        {folderNav("newsletter", I.news)}
        {folderNav("auto", I.auto)}
        {folderNav("assigned", I.tag)}
        {folderNav("unassigned", I.layers)}
        <NavItem on={view === "contacts"} icon={I.users} label="Contacts" onClick={() => { setView("contacts"); setOpen(null); }} />
        <NavItem on={view === "autoContacts"} icon={I.auto} label="Contacts from Auto Replies" onClick={() => { setView("autoContacts"); setOpen(null); }} />

        <div className="section">
          <span>Businesses</span>
          {isAdmin && <button className="icon-btn" title="Add business" onClick={addBusiness}><Icon d={I.plus} size={14} /></button>}
        </div>
        {biz.map(b => (
          <NavItem key={b.id} on={inMail && filter.key === `biz:${b.id}`} dot={b.color} label={b.name}
            count={counts.business[b.id]} onClick={() => go({ key: `biz:${b.id}`, businessId: b.id })}>
            {isAdmin && (
              <button className="icon-btn edit" title="Rename" onClick={e => { e.stopPropagation(); editBusiness(b); }}>
                <Icon d={I.edit} size={13} />
              </button>
            )}
          </NavItem>
        ))}
        {!biz.length && <div className="hint">No businesses yet{isAdmin ? " — use + to add one" : ""}</div>}

        <div className="side-foot">
          <div className="sync-status">
            <button className={`icon-btn ${syncing ? "spin" : ""}`} onClick={sync} disabled={syncing} title="Check for new mail">
              <Icon d={I.refresh} size={14} />
            </button>
            <span>{syncMsg}</span>
          </div>
          <div className="me">
            <Avatar name={user.name} size={28} />
            <span className="label">{user.name}</span>
            <button className="icon-btn" title="Sign out"
              onClick={() => fetch("/api/auth", { method: "DELETE" }).then(() => (location.href = "/login"))}>
              <Icon d={I.logout} />
            </button>
          </div>
        </div>
      </aside>

      {view !== "mail" ? <Contacts key={view} biz={biz} mode={view === "autoContacts" ? "auto" : "all"} /> : <>
      {/* ---------- Message list ---------- */}
      <section className="list">
        <header className="list-head">
          <h2>{title}</h2>
          <div className="search">
            <Icon d={I.search} size={15} />
            <input placeholder="Search mail" value={q} onChange={e => setQ(e.target.value)} />
          </div>
        </header>
        <div className="rows">
          {rows.map(r => {
            const p = person(r), b = bizOf(r.businessId);
            const unread = !r.isRead && r.direction === "in";
            return (
              <div key={r.id} className={`row ${unread ? "unread" : ""} ${open?.id === r.id ? "on" : ""}`} onClick={() => openMsg(r.id)}>
                <Avatar name={p.name} email={p.email} />
                <div className="row-main">
                  <div className="row-top">
                    <span className="who">{r.direction === "out" && <span className="to">To: </span>}{p.name || p.email}</span>
                    {r.contact?.doNotContact && <span className="dnc">DNC</span>}
                    <span className="time">{when(r.receivedAt)}</span>
                  </div>
                  <div className="subj-line">
                    <span className="subj">{r.subject}</span>
                    {b && <Chip b={b} />}
                  </div>
                  <div className="prev">{r.preview || " "}</div>
                </div>
              </div>
            );
          })}
          {!rows.length && (
            <div className="empty">
              <Icon d={I.inbox} size={32} />
              <p>{q ? "No emails match your search." : "Nothing here yet."}</p>
            </div>
          )}
        </div>
      </section>

      {/* ---------- Reading pane ---------- */}
      <main className="reader">
        {!open ? (
          <div className="empty-reader"><Icon d={I.mail} size={44} /><p>Select an email to read</p></div>
        ) : <>
          <button className="ghost back" onClick={() => setOpen(null)}><Icon d={I.back} /> Back</button>
          <h1 className="subject">{open.subject}</h1>
          <div className="meta">
            <Avatar name={open.fromName} email={open.fromEmail} size={42} />
            <div className="meta-main">
              <div className="from"><b>{open.fromName || open.fromEmail}</b>{open.fromName && <span className="muted"> &lt;{open.fromEmail}&gt;</span>}</div>
              <div className="muted small">
                To: {open.toEmails.join(", ")}{open.ccEmails?.length ? ` · Cc: ${open.ccEmails.join(", ")}` : ""}
              </div>
            </div>
            <div className="muted small nowrap">{new Date(open.receivedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</div>
          </div>

          <div className="toolbar">
            {open.contact && !open.contact.doNotContact && (
              <button className="primary" onClick={() => setCompose({
                to: open.contact.email, subject: /^re:/i.test(open.subject) ? open.subject : `Re: ${open.subject}`, body: "",
              })}><Icon d={I.reply} /> Reply</button>
            )}
            <label className="select">
              <Icon d={I.tag} size={15} />
              <select value={open.businessId || ""} onChange={e => setBusiness(e.target.value, false)}>
                <option value="">No business</option>
                {biz.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
            {open.contact && <button onClick={() => setBusiness(open.businessId || "", true)}>Apply to all mail from this person</button>}
            {open.direction === "in" && (open.category === "inbox"
              ? <button onClick={() => moveTo("newsletter")} title="Moves this sender's past and future mail to Newsletters"><Icon d={I.news} size={15} /> Move to Newsletters</button>
              : <button onClick={() => moveTo("inbox")} title={open.category === "auto" ? "Moves this email to the Inbox" : "Moves this sender's past and future mail to the Inbox"}><Icon d={I.inbox} size={15} /> Move to Inbox</button>)}
            {open.contact && (
              <button className={open.contact.doNotContact ? "" : "danger-ghost"} onClick={() => toggleDnc(open.contact)}>
                <Icon d={I.ban} size={15} /> {open.contact.doNotContact ? "Remove Do Not Contact" : "Do Not Contact"}
              </button>
            )}
          </div>

          {open.contact?.doNotContact && (
            <div className="banner"><Icon d={I.ban} size={15} /> Do Not Contact{open.contact.dncReason ? ` — ${open.contact.dncReason}` : ""}</div>
          )}
          <iframe className="body" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={emailDoc(open.bodyHtml)} title="Email body" />
        </>}
      </main>
      </>}

      {compose && <Compose init={compose} onClose={() => setCompose(null)} onSent={() => setTimeout(sync, 5000)} />}
    </div>
  );
}

function Compose({ init, onClose, onSent }: {
  init: { to: string; subject: string; body: string }; onClose: () => void; onSent: () => void;
}) {
  const [f, setF] = useState({ ...init, cc: "" });
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true); setErr("");
    const html = f.body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>");
    const r = await fetch("/api/send", { method: "POST", body: JSON.stringify({ to: f.to, cc: f.cc, subject: f.subject, html }) });
    const d = await r.json().catch(() => ({ error: "Send failed" })); setBusy(false);
    if (r.ok) { onSent(); return onClose(); }
    setErr(d.blocked ? `Blocked — Do Not Contact: ${d.blocked.map((b: any) => b.email).join(", ")}` : d.error);
  }
  return (
    <div className="modal" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>{init.subject ? "Reply" : "New email"}</h3>
          <button className="icon-btn" onClick={onClose} title="Close"><Icon d={I.x} /></button>
        </div>
        {err && <div className="err">{err}</div>}
        <div className="field"><label>To</label><input value={f.to} onChange={e => setF({ ...f, to: e.target.value })} placeholder="name@example.com" autoFocus={!init.to} /></div>
        <div className="field"><label>Cc</label><input value={f.cc} onChange={e => setF({ ...f, cc: e.target.value })} /></div>
        <div className="field"><label>Subject</label><input value={f.subject} onChange={e => setF({ ...f, subject: e.target.value })} /></div>
        <textarea rows={12} value={f.body} onChange={e => setF({ ...f, body: e.target.value })} placeholder="Write your message…" autoFocus={!!init.to} />
        <div className="sheet-foot">
          <button className="primary" disabled={busy} onClick={send}><Icon d={I.sent} /> {busy ? "Sending…" : "Send"}</button>
          <button className="ghost" onClick={onClose}>Discard</button>
        </div>
      </div>
    </div>
  );
}
