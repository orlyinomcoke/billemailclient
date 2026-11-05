"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar, Icon, I } from "./ui";

type Business = { id: string; name: string; color: string };
type Contact = {
  id: string; email: string; name: string | null; firstName: string | null; lastName: string | null;
  phone: string | null; company: string | null; status: string | null; businessId: string | null;
  doNotContact: boolean; dncReason: string | null;
};
type Patch = Partial<Contact> & { applyToMessages?: boolean };

const STATUS_SUGGESTIONS = ["Lead", "Prospect", "Client", "Active", "Inactive"];
const PAGE = 100;

const COLUMNS: { key: keyof Contact | "business"; label: string; sortable: boolean }[] = [
  { key: "firstName", label: "First name", sortable: true },
  { key: "lastName", label: "Last name", sortable: true },
  { key: "name", label: "Full name", sortable: true },
  { key: "email", label: "Email", sortable: true },
  { key: "phone", label: "Contact number", sortable: true },
  { key: "company", label: "Company", sortable: true },
  { key: "status", label: "Status", sortable: true },
  { key: "business", label: "Business", sortable: false },
  { key: "doNotContact", label: "Do not contact", sortable: true },
];

// Click-to-edit text cell. Enter or clicking away saves, Esc cancels.
function Cell({ value, onSave, list }: { value: string | null; onSave: (v: string) => void; list?: string }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value ?? "");
  const cancelled = useRef(false);
  useEffect(() => setV(value ?? ""), [value]);

  if (!editing)
    return (
      <div className={`cell ${value ? "" : "blank"}`} title={value ? `${value} — click to edit` : "Click to add"}
        onClick={() => { cancelled.current = false; setEditing(true); }}>
        {value || "—"}
      </div>
    );
  return (
    <input className="cell-input" autoFocus value={v} list={list}
      onChange={e => setV(e.target.value)}
      onBlur={() => {
        setEditing(false);
        if (!cancelled.current && v.trim() !== (value ?? "")) onSave(v.trim());
        else setV(value ?? "");
      }}
      onKeyDown={e => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") { cancelled.current = true; e.currentTarget.blur(); }
      }} />
  );
}

export default function Contacts({ biz }: { biz: Business[] }) {
  const [rows, setRows] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [bizFilter, setBizFilter] = useState("");
  const [dncFilter, setDncFilter] = useState("");
  const [hideAuto, setHideAuto] = useState(true);
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "firstName", dir: "asc" });
  const [extractMsg, setExtractMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const p = new URLSearchParams({ page: String(page), sort: sort.key, dir: sort.dir });
    if (q) p.set("q", q);
    if (bizFilter) p.set("businessId", bizFilter);
    if (dncFilter) p.set("dnc", dncFilter);
    if (hideAuto) p.set("hideAuto", "1");
    const r = await fetch(`/api/contacts?${p}`).then(r => r.json()).catch(() => null);
    setRows(r?.rows ?? []); setTotal(r?.total ?? 0); setLoading(false);
  }, [page, q, bizFilter, dncFilter, hideAuto, sort]);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => { load(); }, [load]);

  // Fill in details for contacts that haven't been scanned yet (runs on open; Re-scan does everyone)
  const extracting = useRef(false);
  const runExtract = useCallback(async (all = false) => {
    if (extracting.current) return;
    extracting.current = true;
    try {
      for (let first = true; ; first = false) {
        const r = await fetch(`/api/contacts/extract${all && first ? "?all=1" : ""}`, { method: "POST" }).then(r => r.json());
        if (r.busy || !r.processed) break;
        await loadRef.current();
        if (!r.remaining) break;
        setExtractMsg(`Extracting details… ${r.remaining.toLocaleString()} left`);
      }
      setExtractMsg("");
    } catch { setExtractMsg("Extraction failed"); }
    finally { extracting.current = false; }
  }, []);
  useEffect(() => { runExtract(); }, [runExtract]);

  async function save(c: Contact, patch: Patch) {
    const { applyToMessages, ...fields } = patch;
    setRows(rs => rs.map(r => (r.id === c.id ? { ...r, ...fields } : r)));
    const r = await fetch(`/api/contacts/${c.id}`, { method: "PATCH", body: JSON.stringify(patch) });
    if (!r.ok) { alert("Couldn't save that change."); load(); }
  }
  function toggleDnc(c: Contact) {
    if (c.doNotContact) return save(c, { doNotContact: false, dncReason: null });
    const reason = prompt(`Mark ${c.name || c.email} as Do Not Contact?\n\nReason (optional):`);
    if (reason === null) return;
    save(c, { doNotContact: true, dncReason: reason || null });
  }
  function sortBy(key: string) {
    setPage(1);
    setSort(s => ({ key, dir: s.key === key && s.dir === "asc" ? "desc" : "asc" }));
  }
  const bizOf = (id: string | null) => biz.find(b => b.id === id);
  const from = total ? (page - 1) * PAGE + 1 : 0, to = Math.min(page * PAGE, total);

  return (
    <section className="contacts">
      <header className="ct-head">
        <div className="ct-title">
          <h2>Contacts</h2>
          <span className="muted">{total.toLocaleString()} {total === 1 ? "person" : "people"}</span>
          {extractMsg && <span className="pill"><span className="spin"><Icon d={I.refresh} size={12} /></span>{extractMsg}</span>}
        </div>
        <div className="ct-tools">
          <div className="search">
            <Icon d={I.search} size={15} />
            <input placeholder="Search name, email, company, number…" value={q} onChange={e => { setQ(e.target.value); setPage(1); }} />
          </div>
          <select value={bizFilter} onChange={e => { setBizFilter(e.target.value); setPage(1); }}>
            <option value="">All businesses</option>
            <option value="none">No business</option>
            {biz.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select value={dncFilter} onChange={e => { setDncFilter(e.target.value); setPage(1); }}>
            <option value="">Anyone</option>
            <option value="yes">Do not contact</option>
            <option value="no">OK to contact</option>
          </select>
          <label className="check">
            <input type="checkbox" checked={hideAuto} onChange={e => { setHideAuto(e.target.checked); setPage(1); }} />
            Hide automated senders
          </label>
          <button onClick={() => runExtract(true)} title="Scan emails again to fill in any blank details (your edits are kept)">
            <Icon d={I.refresh} size={14} /> Re-scan
          </button>
        </div>
      </header>

      <div className="ct-wrap">
        <table className="ct-table">
          <thead>
            <tr>
              {COLUMNS.map(c => (
                <th key={c.key} className={c.sortable ? "sortable" : ""} onClick={c.sortable ? () => sortBy(c.key) : undefined}>
                  {c.label}{sort.key === c.key && <span className="arrow">{sort.dir === "asc" ? "↑" : "↓"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(c => {
              const b = bizOf(c.businessId);
              return (
                <tr key={c.id} className={c.doNotContact ? "is-dnc" : ""}>
                  <td>
                    <div className="namecell">
                      <Avatar name={c.name} email={c.email} size={26} />
                      <Cell value={c.firstName} onSave={v => save(c, { firstName: v || null })} />
                    </div>
                  </td>
                  <td><Cell value={c.lastName} onSave={v => save(c, { lastName: v || null })} /></td>
                  <td><Cell value={c.name} onSave={v => save(c, { name: v || null })} /></td>
                  <td className="email" title={c.email}>{c.email}</td>
                  <td><Cell value={c.phone} onSave={v => save(c, { phone: v || null })} /></td>
                  <td><Cell value={c.company} onSave={v => save(c, { company: v || null })} /></td>
                  <td><Cell value={c.status} list="contact-statuses" onSave={v => save(c, { status: v || null })} /></td>
                  <td>
                    <label className="biz-select" title="Also tags all of this person's emails">
                      <span className="dot" style={{ background: b?.color ?? "transparent", borderColor: b ? b.color : undefined }} />
                      <select value={c.businessId ?? ""} onChange={e => save(c, { businessId: e.target.value || null, applyToMessages: true })}>
                        <option value="">—</option>
                        {biz.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                      </select>
                    </label>
                  </td>
                  <td>
                    <button className={`dnc-toggle ${c.doNotContact ? "yes" : ""}`} onClick={() => toggleDnc(c)}
                      title={c.doNotContact ? `Reason: ${c.dncReason || "none given"} — click to remove` : "Click to mark Do Not Contact"}>
                      {c.doNotContact ? "Yes" : "No"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && !loading && (
          <div className="empty"><Icon d={I.users} size={32} /><p>{q ? "No contacts match your search." : "No contacts yet."}</p></div>
        )}
      </div>

      <footer className="ct-foot">
        <span className="muted">{from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}</span>
        <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
        <button disabled={to >= total} onClick={() => setPage(p => p + 1)}>Next</button>
      </footer>

      <datalist id="contact-statuses">{STATUS_SUGGESTIONS.map(s => <option key={s} value={s} />)}</datalist>
    </section>
  );
}
