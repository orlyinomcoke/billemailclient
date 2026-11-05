"use client";
import { useEffect, useState, useCallback } from "react";

type Business = { id: string; name: string; color: string };
type Contact = { id: string; email: string; name?: string; doNotContact: boolean; dncReason?: string; businessId?: string; unread: number };
type Row = { id: string; subject: string; fromEmail: string; fromName?: string; preview: string; receivedAt: string; isRead: boolean; direction: string; businessId?: string; contact?: Contact };

const j = (url: string, init?: RequestInit) => fetch(url, init).then(r => r.json());

export default function Mail({ user }: { user: { name: string; role: string } }) {
  const [biz, setBiz] = useState<Business[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState<{ businessId?: string; contactId?: string; unassigned?: boolean }>({});
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<any>(null);
  const [compose, setCompose] = useState<null | { to: string; subject: string; body: string }>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    const p = new URLSearchParams();
    if (filter.businessId) p.set("businessId", filter.businessId);
    if (filter.contactId) p.set("contactId", filter.contactId);
    if (filter.unassigned) p.set("unassigned", "1");
    if (q) p.set("q", q);
    setRows(await j(`/api/messages?${p}`));
    setContacts(await j(`/api/contacts${filter.businessId ? `?businessId=${filter.businessId}` : ""}`));
  }, [filter, q]);

  useEffect(() => { j("/api/businesses").then(setBiz); }, []);
  useEffect(() => { load(); }, [load]);

  async function sync() { setSyncing(true); await fetch("/api/sync", { method: "POST" }); setSyncing(false); load(); }
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
    const name = prompt("Business name"); if (!name) return;
    const color = prompt("Color (hex)", "#10b981") || "#10b981";
    await fetch("/api/businesses", { method: "POST", body: JSON.stringify({ name, color }) });
    setBiz(await j("/api/businesses"));
  }
  const bizOf = (id?: string) => biz.find(b => b.id === id);

  return (
    <div className="app">
      <aside className="pane side">
        <div style={{ display: "flex", gap: 6 }}>
          <button className="primary" style={{ flex: 1 }} onClick={() => setCompose({ to: "", subject: "", body: "" })}>New email</button>
          <button onClick={sync} disabled={syncing}>{syncing ? "…" : "⟳"}</button>
        </div>
        <h4>Mail</h4>
        <div className={`item ${!filter.businessId && !filter.contactId && !filter.unassigned ? "on" : ""}`} onClick={() => setFilter({})}>All mail</div>
        <div className={`item ${filter.unassigned ? "on" : ""}`} onClick={() => setFilter({ unassigned: true })}>Unassigned</div>
        <h4>Businesses {user.role === "ADMIN" && <span style={{ cursor: "pointer" }} onClick={addBusiness}>＋</span>}</h4>
        {biz.map(b => (
          <div key={b.id} className={`item ${filter.businessId === b.id && !filter.contactId ? "on" : ""}`} onClick={() => setFilter({ businessId: b.id })}>
            <span><span className="dot" style={{ background: b.color }} />{b.name}</span>
          </div>
        ))}
        <h4>People</h4>
        {contacts.map(c => (
          <div key={c.id} className={`item ${filter.contactId === c.id ? "on" : ""}`} onClick={() => setFilter({ ...filter, unassigned: false, contactId: c.id })}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {c.businessId && <span className="dot" style={{ background: bizOf(c.businessId)?.color }} />}
              {c.name || c.email} {c.doNotContact && <span className="dnc">DNC</span>}
            </span>
            {c.unread > 0 && <span className="badge">{c.unread}</span>}
          </div>
        ))}
        <h4>{user.name}</h4>
        <div className="item" onClick={() => fetch("/api/auth", { method: "DELETE" }).then(() => location.href = "/login")}>Sign out</div>
      </aside>

      <section className="pane">
        <div style={{ padding: 10, borderBottom: "1px solid #e5e7eb" }}>
          <input placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        {rows.map(r => (
          <div key={r.id} className={`row ${r.isRead ? "" : "unread"} ${open?.id === r.id ? "on" : ""}`} onClick={() => openMsg(r.id)}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{r.direction === "out" ? "To: " : ""}{r.contact?.name || r.contact?.email || r.fromEmail} {r.contact?.doNotContact && <span className="dnc">DNC</span>}</span>
              <span className="muted">{new Date(r.receivedAt).toLocaleDateString()}</span>
            </div>
            <div className="subj">{bizOf(r.businessId) && <span className="dot" style={{ background: bizOf(r.businessId)!.color }} />}{r.subject}</div>
            <div className="muted" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.preview}</div>
          </div>
        ))}
        {!rows.length && <p className="muted" style={{ padding: 12 }}>No messages. Press ⟳ to sync.</p>}
      </section>

      <main className="reader">
        {!open ? <p className="muted">Select an email</p> : <>
          <h2 style={{ marginTop: 0 }}>{open.subject}</h2>
          <div className="muted">From {open.fromName} &lt;{open.fromEmail}&gt; · {new Date(open.receivedAt).toLocaleString()}</div>
          <div className="muted">To {open.toEmails.join(", ")}</div>
          <div className="toolbar" style={{ marginTop: 12 }}>
            <select style={{ width: 200 }} value={open.businessId || ""} onChange={e => setBusiness(e.target.value, false)}>
              <option value="">— No business —</option>
              {biz.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            {open.contact && <button onClick={() => setBusiness(open.businessId || "", true)}>Apply to all mail from this person</button>}
            {open.contact && <button className={open.contact.doNotContact ? "" : "danger"} onClick={() => toggleDnc(open.contact)}>
              {open.contact.doNotContact ? "Remove Do-Not-Contact" : "Mark Do-Not-Contact"}</button>}
            {open.contact && !open.contact.doNotContact &&
              <button className="primary" onClick={() => setCompose({ to: open.contact.email, subject: open.subject.startsWith("Re:") ? open.subject : `Re: ${open.subject}`, body: "" })}>Reply</button>}
          </div>
          {open.contact?.doNotContact && <div className="err">Do Not Contact{open.contact.dncReason ? `: ${open.contact.dncReason}` : ""}</div>}
          <iframe sandbox="" srcDoc={open.bodyHtml} style={{ width: "100%", height: "65vh", border: "1px solid #e5e7eb", borderRadius: 6, marginTop: 10 }} />
        </>}
      </main>

      {compose && <Compose init={compose} onClose={() => setCompose(null)} />}
    </div>
  );
}

function Compose({ init, onClose }: { init: { to: string; subject: string; body: string }; onClose: () => void }) {
  const [f, setF] = useState({ ...init, cc: "" });
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true); setErr("");
    const html = f.body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>");
    const r = await fetch("/api/send", { method: "POST", body: JSON.stringify({ to: f.to, cc: f.cc, subject: f.subject, html }) });
    const d = await r.json(); setBusy(false);
    if (r.ok) return onClose();
    setErr(d.blocked ? `Blocked — Do Not Contact: ${d.blocked.map((b: any) => b.email).join(", ")}` : d.error);
  }
  return (
    <div className="modal" onClick={onClose}><div onClick={e => e.stopPropagation()}>
      <h3 style={{ margin: 0 }}>New email</h3>
      {err && <div className="err">{err}</div>}
      <input placeholder="To (comma-separated)" value={f.to} onChange={e => setF({ ...f, to: e.target.value })} />
      <input placeholder="Cc" value={f.cc} onChange={e => setF({ ...f, cc: e.target.value })} />
      <input placeholder="Subject" value={f.subject} onChange={e => setF({ ...f, subject: e.target.value })} />
      <textarea rows={10} value={f.body} onChange={e => setF({ ...f, body: e.target.value })} />
      <div className="toolbar"><button className="primary" disabled={busy} onClick={send}>{busy ? "Sending…" : "Send"}</button><button onClick={onClose}>Cancel</button></div>
    </div></div>
  );
}
