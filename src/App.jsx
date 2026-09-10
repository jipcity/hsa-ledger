import { useState, useEffect, useMemo, useRef } from "react";
import {
  Plus, Check, X, Trash2, Pencil, FileText, AlertCircle, ArrowRight, RotateCcw,
  Send, Loader, ScanLine, FileSpreadsheet, ClipboardType, Paperclip, KeyRound, Download,
  Smartphone, ShieldAlert, FolderCheck, FolderPlus, Upload,
} from "lucide-react";
import {
  seed, uid, money, showDate, normalizeDate, parseWorkbook, fileToBase64,
  fromApiItem, matchPerson, stageClaims, tierMath, EOB_PROMPT,
} from "./lib/core.js";
import { callClaude, getKey, setKey } from "./lib/read-eob.js";
import { loadState, saveState, putDocument, openDocument, deleteDocument, documentSummary, wipeEverything } from "./db.js";
import {
  isStandalone, detectPlatform, ensurePersisted, storageUsed, watchInstallPrompt, installSteps,
} from "./lib/install.js";
import {
  canAutoBackup, chooseFolder, folderStatus, reconnectFolder, writeBackup,
  readBackupFile, restoreDocumentsFrom, forgetFolder, daysSince,
} from "./lib/backup.js";

function Ruler({ m }) {
  const segs = [
    { size: m.hsaZone, fill: m.hsaSpent, color: "var(--hsa)" },
    { size: m.hraZone, fill: m.hraEarned, color: "var(--hra)" },
    { size: m.ownZone, fill: m.ownSpent, color: "var(--own)" },
  ].filter((s) => s.size > 0);
  const grand = segs.reduce((s, x) => s + x.size, 0) || 1;
  let running = 0;
  const bounds = [0, ...segs.map((s) => (running += s.size))];
  return (
    <div>
      <div className="lg-ruler" role="img"
        aria-label={`${money(m.total)} of ${money(grand)} deductible met. HSA deposit ${money(m.hsaSpent)} of ${money(m.hsaZone)}, HRA ${money(m.hraEarned)} of ${money(m.hraZone)}, your share ${money(m.ownSpent)} of ${money(m.ownZone)}.`}>
        {segs.map((s, i) => (
          <div key={i} className="lg-seg" style={{ flexGrow: s.size }}>
            <div className="lg-fill" style={{ width: `${Math.min(100, (s.fill / s.size) * 100)}%`, background: s.color }} />
          </div>
        ))}
      </div>
      <div className="lg-ticks">
        {bounds.map((b, i) => (
          <div key={i} className="lg-tick"
            style={{
              flexGrow: i < segs.length ? segs[i].size : 0,
              textAlign: i === bounds.length - 1 ? "right" : "left",
              flexBasis: 0,
            }}>
            <span>{money(b)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Hero({ m, year, onSubmitClick }) {
  let kicker, fig, sub, cta = null;
  if (m.total === 0) {
    kicker = "Nothing logged yet";
    fig = money(m.hsaZone);
    sub = `Your employer puts ${money(m.hsaZone)} into the HSA for ${year.year}. Spend that down first — the HRA turns on after it.`;
  } else if (m.untilHra > 0) {
    kicker = "Not yet — keep logging";
    fig = money(m.untilHra);
    sub = `${money(m.untilHra)} more in claims before the HRA turns on. Until then you're spending the employer's HSA deposit.`;
  } else if (m.hraOwed > 0) {
    kicker = "Ready to submit to the HRA";
    fig = money(m.hraOwed);
    sub = `You've passed the ${money(m.hsaZone)} HSA deposit. The HRA can reimburse this now${m.hraRemaining > 0 ? `, with ${money(m.hraRemaining)} of the cap still in reserve` : ""}.`;
    cta = "Start a submission";
  } else if (m.inFlight > 0) {
    kicker = "Waiting on the HRA";
    fig = money(m.inFlight);
    sub = "Submitted and not yet reimbursed. Mark it paid once the money lands.";
  } else if (m.hraEarned >= m.hraZone) {
    kicker = "HRA cap reached";
    fig = money(Math.max(m.ownZone - m.ownSpent, 0));
    sub = `The HRA has paid its full ${money(m.hraZone)}. This is what's left of your own ${money(m.ownZone)} before the deductible is met.`;
  } else {
    kicker = "All caught up";
    fig = money(m.reimbursed);
    sub = "Every eligible claim has been reimbursed. Log the next expense and this updates.";
  }
  return (
    <div className="lg-hero">
      <p className="lg-kicker">{kicker}</p>
      <div className="lg-heroflex">
        <div>
          <p className="lg-fig lg-herofig">{fig}</p>
          <p className="lg-herosub" style={{ marginTop: "0.5rem" }}>{sub}</p>
        </div>
        {cta && (
          <button className="lg-btn" onClick={onSubmitClick}>
            {cta} <ArrowRight size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

const blankDraft = (year, people) => ({
  id: null,
  serviceDate: "",
  eobDate: "",
  claimNo: "",
  provider: "",
  purpose: "",
  personId: people[0]?.id || "",
  cost: "",
  pharmacy: false,
  paid: false,
  hasEob: false,
  planYear: year,
  notes: "",
});

function ExpenseForm({ draft, setDraft, people, years, onSave, onCancel }) {
  const [errs, setErrs] = useState({});
  const set = (k) => (ev) => {
    const v = ev.target.type === "checkbox" ? ev.target.checked : ev.target.value;
    setDraft({ ...draft, [k]: v });
    if (errs[k]) setErrs({ ...errs, [k]: null });
  };
  const onServiceDate = (ev) => {
    const v = ev.target.value;
    const y = Number(v.slice(0, 4));
    const known = years.some((x) => x.year === y);
    setDraft({ ...draft, serviceDate: v, planYear: known ? y : draft.planYear });
    if (errs.serviceDate) setErrs({ ...errs, serviceDate: null });
  };
  const save = () => {
    const e = {};
    if (!draft.serviceDate) e.serviceDate = "Add the date of service";
    if (!draft.personId) e.personId = "Pick who this was for";
    const c = Number(draft.cost);
    if (!draft.cost || Number.isNaN(c) || c <= 0) e.cost = "Enter an amount over zero";
    setErrs(e);
    if (Object.keys(e).length) return;
    onSave({ ...draft, cost: Math.round(c * 100) / 100, planYear: Number(draft.planYear) });
  };
  return (
    <div className="lg-form">
      <div className="lg-grid">
        <div className="lg-field">
          <label className="lg-label" htmlFor="f-sd">Date of service</label>
          <input id="f-sd" type="date" value={draft.serviceDate} onChange={onServiceDate} />
          {errs.serviceDate && <span className="lg-err"><AlertCircle size={12} />{errs.serviceDate}</span>}
        </div>
        <div className="lg-field">
          <label className="lg-label" htmlFor="f-ed">EOB date</label>
          <input id="f-ed" type="date" value={draft.eobDate} onChange={set("eobDate")} />
        </div>
        <div className="lg-field">
          <label className="lg-label" htmlFor="f-py">Counts toward</label>
          <select id="f-py" value={draft.planYear} onChange={set("planYear")}>
            {years.map((y) => <option key={y.year} value={y.year}>{y.year} plan year</option>)}
          </select>
        </div>
        <div className="lg-field">
          <label className="lg-label" htmlFor="f-pe">Patient</label>
          <select id="f-pe" value={draft.personId} onChange={set("personId")}>
            <option value="">Select…</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {errs.personId && <span className="lg-err"><AlertCircle size={12} />{errs.personId}</span>}
        </div>
        <div className="lg-field">
          <label className="lg-label" htmlFor="f-co">Amount you owe</label>
          <input id="f-co" type="number" step="0.01" min="0" placeholder="867.00" value={draft.cost} onChange={set("cost")} />
          {errs.cost && <span className="lg-err"><AlertCircle size={12} />{errs.cost}</span>}
        </div>
        <div className="lg-field">
          <label className="lg-label" htmlFor="f-pu">Purpose</label>
          <input id="f-pu" type="text" placeholder="Office visit" value={draft.purpose} onChange={set("purpose")} />
        </div>
        <div className="lg-field">
          <label className="lg-label" htmlFor="f-pr">Provider</label>
          <input id="f-pr" type="text" placeholder="Riverside Family Medicine" value={draft.provider} onChange={set("provider")} />
        </div>
        <div className="lg-field">
          <label className="lg-label" htmlFor="f-cl">Claim number</label>
          <input id="f-cl" type="text" placeholder="1234" value={draft.claimNo} onChange={set("claimNo")} />
        </div>
      </div>
      <div className="lg-field" style={{ marginTop: "0.85rem" }}>
        <label className="lg-label" htmlFor="f-no">Notes</label>
        <textarea id="f-no" rows={2} value={draft.notes} onChange={set("notes")}
          placeholder="Where the EOB is filed, what the provider said, anything you'll forget by April." />
      </div>
      <div className="lg-checks">
        <label className="lg-check"><input type="checkbox" checked={draft.pharmacy} onChange={set("pharmacy")} />Pharmacy</label>
        <label className="lg-check"><input type="checkbox" checked={draft.paid} onChange={set("paid")} />I've paid the provider</label>
        <label className="lg-check"><input type="checkbox" checked={draft.hasEob} onChange={set("hasEob")} />EOB on file</label>
      </div>
      <div className="lg-formacts">
        <button className="lg-btn" onClick={save}>{draft.id ? "Save changes" : "Add to ledger"}</button>
        <button className="lg-btn" data-v="ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function Tags({ e, claimed }) {
  return (
    <>
      {e.paid
        ? <span className="lg-tag" data-t="paid"><Check size={11} />Paid</span>
        : <span className="lg-tag" data-t="unpaid">Unpaid</span>}
      {!e.hasEob && <span className="lg-tag" data-t="noeob">No EOB</span>}
      {e.pharmacy && <span className="lg-tag" data-t="sub">Pharmacy</span>}
      {claimed && <span className="lg-tag" data-t="sub"><Send size={11} />Submitted</span>}
    </>
  );
}

export default function HsaLedger() {
  const [data, setData] = useState(null);
  const [note, setNote] = useState("");
  const [view, setView] = useState("overview");
  const [yearSel, setYearSel] = useState(2026);
  const [filter, setFilter] = useState("all");
  const [personFilter, setPersonFilter] = useState("all");
  const [draft, setDraft] = useState(null);
  const [builder, setBuilder] = useState(null);
  const [payInput, setPayInput] = useState({});
  const [busy, setBusy] = useState("");
  const [fail, setFail] = useState("");
  const [stage, setStage] = useState(null);
  const [pasted, setPasted] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const eobRef = useRef(null);
  const bookRef = useRef(null);
  const attachRef = useRef(null);
  const [docs, setDocs] = useState({ count: 0, bytes: 0 });
  const [apiKey, setApiKeyState] = useState(getKey());
  const [attachTarget, setAttachTarget] = useState(null);
  const [installed] = useState(isStandalone);
  const [platform] = useState(detectPlatform);
  const [persisted, setPersisted] = useState(null);
  const [promptEvent, setPromptEvent] = useState(null);
  const [hideInstall, setHideInstall] = useState(false);
  const [backup, setBackup] = useState({ state: "none" });
  const [backupMsg, setBackupMsg] = useState("");
  const restoreRef = useRef(null);

  useEffect(() => {
    let live = true;
    (async () => {
      let loaded = null;
      try {
        loaded = await loadState();
      } catch (err) {
        loaded = null;
      }
      if (!live) return;
      if (loaded && loaded.expenses) {
        setData(loaded);
        const ys = loaded.planYears.map((y) => y.year);
        setYearSel(ys.includes(2026) ? 2026 : ys[0]);
      } else {
        const s = seed();
        setData(s);
        setNote("Loaded with your 2026 and 2025 numbers as a starting point.");
        try { await saveState(s); } catch (err) { /* private browsing */ }
      }
      try { setDocs(await documentSummary()); } catch (err) { /* ignore */ }
    })();
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!data) return;
    const t = setTimeout(() => { saveState(data).catch(() => {}); }, 250);
    return () => clearTimeout(t);
  }, [data]);

  // Safari resets the persistence grant on every launch, so ask every time.
  useEffect(() => {
    ensurePersisted().then(setPersisted);
    folderStatus().then(setBackup).catch(() => {});
    return watchInstallPrompt(setPromptEvent);
  }, []);

  // Every change is mirrored to the chosen folder a few seconds later. The
  // debounce is longer than the local save so a burst of edits writes once.
  useEffect(() => {
    if (!data || backup.state !== "granted") return;
    const t = setTimeout(() => {
      writeBackup(data)
        .then((r) => { if (r.ok) setBackup((b) => ({ ...b, lastAt: r.at })); })
        .catch(() => {});
    }, 3000);
    return () => clearTimeout(t);
  }, [data, backup.state]);

  const years = useMemo(
    () => (data ? [...data.planYears].sort((a, b) => b.year - a.year) : []),
    [data]
  );
  const year = years.find((y) => y.year === yearSel) || years[0];
  const m = useMemo(
    () => (data && year ? tierMath(year, data.expenses, data.submissions, data.people) : null),
    [data, year]
  );

  if (!data || !m) {
    return (
      <div className="lg-root">
        <div className="lg-loading"><Loader size={17} className="lg-spin" />Opening your ledger…</div>
      </div>
    );
  }

  const personName = (id) => data.people.find((p) => p.id === id)?.name || "Unassigned";

  const saveExpense = (e) => {
    setData((d) => ({
      ...d,
      expenses: e.id
        ? d.expenses.map((x) => (x.id === e.id ? e : x))
        : [...d.expenses, { ...e, id: uid() }],
    }));
    setDraft(null);
    setNote(e.id ? "Changes saved." : `Added ${money(e.cost)} for ${personName(e.personId)}.`);
  };

  const removeExpense = (id) => {
    const target = data.expenses.find((x) => x.id === id);
    (target?.documentIds || []).forEach((docId) => {
      const usedElsewhere = data.expenses.some(
        (e) => e.id !== id && (e.documentIds || []).includes(docId)
      );
      if (!usedElsewhere) deleteDocument(docId).then(() => documentSummary().then(setDocs)).catch(() => {});
    });
    setData((d) => ({
      ...d,
      expenses: d.expenses.filter((x) => x.id !== id),
      submissions: d.submissions.map((s) => ({ ...s, lines: s.lines.filter((l) => l.expenseId !== id) })),
    }));
    setNote("Removed from the ledger.");
  };

  const togglePaid = (id) =>
    setData((d) => ({
      ...d,
      expenses: d.expenses.map((x) => (x.id === id ? { ...x, paid: !x.paid } : x)),
    }));

  const beginStage = (claims, configs, label, docId) => {
    if (!claims.length) {
      setFail("Nothing that looked like a claim line turned up in that file.");
      return;
    }
    setStage({
      rows: stageClaims(claims, data.people, data.expenses, year.year),
      configs: configs || [],
      label,
      docId: docId || null,
    });
    setFail("");
  };

  const readEob = async (file) => {
    if (!file) return;
    setFail("");
    setBusy(`Reading ${file.name}…`);
    try {
      const b64 = await fileToBase64(file);
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      const block = isPdf
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
        : {
            type: "image",
            source: { type: "base64", media_type: file.type || "image/jpeg", data: b64 },
          };
      const items = await callClaude([block, { type: "text", text: EOB_PROMPT }]);

      // Keep the original. Every claim this file produces gets attached to it,
      // so the paperwork travels with the number it justifies.
      const docId = uid();
      await putDocument({ id: docId, name: file.name, type: file.type, blob: file });
      setDocs(await documentSummary());

      beginStage(items.map((it) => fromApiItem(it, file.name)), [], file.name, docId);
    } catch (err) {
      setFail(err.message);
    } finally {
      setBusy("");
      if (eobRef.current) eobRef.current.value = "";
    }
  };

  const readPasted = async () => {
    if (!pasted.trim()) {
      setFail("Paste the claim text first.");
      return;
    }
    setFail("");
    setBusy("Reading what you pasted…");
    try {
      const items = await callClaude([
        { type: "text", text: `${EOB_PROMPT}\n\nHere is the text:\n\n${pasted.slice(0, 12000)}` },
      ]);
      beginStage(items.map((it) => fromApiItem(it, "pasted text")), [], "pasted text");
      setShowPaste(false);
      setPasted("");
    } catch (err) {
      setFail(err.message);
    } finally {
      setBusy("");
    }
  };

  const readBook = async (file) => {
    if (!file) return;
    setFail("");
    setBusy(`Parsing ${file.name}…`);
    try {
      const buf = await file.arrayBuffer();
      const { claims, configs } = await parseWorkbook(buf);
      beginStage(claims, configs, file.name);
    } catch (err) {
      setFail("That file couldn't be parsed. Excel and CSV both work — make sure it isn't password protected.");
    } finally {
      setBusy("");
      if (bookRef.current) bookRef.current.value = "";
    }
  };

  const patchStageRow = (key, patch) =>
    setStage((s) => ({ ...s, rows: s.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) }));

  const commitStage = () => {
    const picked = stage.rows.filter((r) => r.on && r.cost > 0);
    if (!picked.length) return;

    setData((d) => {
      const people = [...d.people];
      const resolve = (pid, fallbackName) => {
        if (pid && pid.startsWith("new:")) {
          const name = pid.slice(4).trim() || fallbackName || "Unnamed";
          const found = people.find((p) => p.name.trim().toLowerCase() === name.toLowerCase());
          if (found) return found.id;
          const created = { id: uid(), name };
          people.push(created);
          return created.id;
        }
        return pid || people[0]?.id || "";
      };

      const planYears = [...d.planYears];
      stage.configs.forEach((c) => {
        const at = planYears.findIndex((p) => p.year === c.year);
        const merged = {
          year: c.year,
          irsMax: c.irsMax ?? (at > -1 ? planYears[at].irsMax : 0),
          employerContribution: c.employerContribution ?? (at > -1 ? planYears[at].employerContribution : 0),
          hraCap: c.hraCap ?? (at > -1 ? planYears[at].hraCap : 0),
          deductible: c.deductible ?? (at > -1 ? planYears[at].deductible : 0),
          payPeriods: at > -1 ? planYears[at].payPeriods : 26,
        };
        if (at > -1) planYears[at] = merged;
        else planYears.push(merged);
      });

      const added = picked.map((r) => ({
        id: uid(),
        serviceDate: r.serviceDate,
        eobDate: r.eobDate,
        claimNo: r.claimNo,
        provider: r.provider,
        purpose: r.purpose,
        personId: resolve(r.personId, r.patientName),
        cost: r.cost,
        pharmacy: r.pharmacy,
        paid: r.paid,
        hasEob: stage.docId ? true : r.hasEob,
        planYear: r.planYear || year.year,
        notes: r.notes,
        documentIds: stage.docId ? [stage.docId] : [],
      }));

      picked.forEach((r) => {
        const y = r.planYear;
        if (y && !planYears.some((p) => p.year === y)) {
          const template = planYears[0] || { irsMax: 0, employerContribution: 0, hraCap: 0, deductible: 0, payPeriods: 26 };
          planYears.push({ ...template, year: y });
        }
      });

      return { ...d, people, planYears, expenses: [...d.expenses, ...added] };
    });

    const yearsTouched = [...new Set(picked.map((r) => r.planYear))].sort();
    setNote(
      `Imported ${picked.length} claim${picked.length > 1 ? "s" : ""} from ${stage.label}${
        yearsTouched.length > 1 ? ` across ${yearsTouched.join(" and ")}` : ""
      }.`
    );
    setStage(null);
    setView("ledger");
  };

  const requestAttach = (expenseId) => {
    setAttachTarget(expenseId);
    setTimeout(() => attachRef.current?.click(), 0);
  };

  const attachToExpense = async (file) => {
    if (!file || !attachTarget) return;
    try {
      const docId = uid();
      await putDocument({ id: docId, name: file.name, type: file.type, blob: file });
      setData((d) => ({
        ...d,
        expenses: d.expenses.map((e) =>
          e.id === attachTarget
            ? { ...e, hasEob: true, documentIds: [...(e.documentIds || []), docId] }
            : e
        ),
      }));
      setDocs(await documentSummary());
      setNote(`Attached ${file.name}.`);
    } catch (err) {
      setNote("That file couldn't be stored.");
    } finally {
      setAttachTarget(null);
      if (attachRef.current) attachRef.current.value = "";
    }
  };

  const download = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const exportBackup = () => {
    download(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      `deductible-ledger-${new Date().toISOString().slice(0, 10)}.json`
    );
    setNote("Backup downloaded. Attached documents aren't in it — they stay in this browser.");
  };

  const exportWorkbook = async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    years.forEach((y) => {
      const rows = data.expenses
        .filter((e) => e.planYear === y.year)
        .sort((a, b) => (a.serviceDate || "").localeCompare(b.serviceDate || ""))
        .map((e) => ({
          "Service Date": e.serviceDate,
          "EOB Date": e.eobDate,
          Claim: e.claimNo,
          Provider: e.provider,
          Purpose: e.purpose,
          Patient: data.people.find((p) => p.id === e.personId)?.name || "",
          "EOB Cost": e.cost,
          Pharmacy: e.pharmacy,
          Paid: e.paid,
          EOB: e.hasEob,
          Notes: e.notes,
        }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), String(y.year));
    });
    const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    download(
      new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `deductible-ledger-${new Date().toISOString().slice(0, 10)}.xlsx`
    );
  };

  const openBuilder = () => {
    const eligible = m.rows.filter((e) => !m.claimedIds.has(e.id));
    setBuilder({
      picks: Object.fromEntries(eligible.map((e) => [e.id, { on: false, amount: String(e.cost) }])),
    });
    setView("submissions");
  };

  const createSubmission = () => {
    const lines = Object.entries(builder.picks)
      .filter(([, v]) => v.on && Number(v.amount) > 0)
      .map(([expenseId, v]) => ({ expenseId, amount: Math.round(Number(v.amount) * 100) / 100 }));
    if (!lines.length) return;
    setData((d) => ({
      ...d,
      submissions: [
        {
          id: uid(),
          type: "HRA",
          planYear: year.year,
          dateCreated: new Date().toISOString().slice(0, 10),
          dateSent: null,
          status: "draft",
          amountReceived: null,
          lines,
        },
        ...d.submissions,
      ],
    }));
    setBuilder(null);
    setNote(`Draft submission created for ${lines.length} claim${lines.length > 1 ? "s" : ""}.`);
  };

  const setSubStatus = (id, patch) =>
    setData((d) => ({
      ...d,
      submissions: d.submissions.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));

  const deleteSub = (id) =>
    setData((d) => ({ ...d, submissions: d.submissions.filter((s) => s.id !== id) }));

  const resetAll = async () => {
    try {
      await wipeEverything();
    } catch (err) {
      /* ignore */
    }
    const s = seed();
    setData(s);
    setYearSel(2026);
    setView("overview");
    setDocs({ count: 0, bytes: 0 });
    setNote("Back to the demo data. Stored documents were cleared too.");
  };

  const yearSubs = data.submissions.filter((s) => s.planYear === year.year);
  const eligibleForSub = m.rows.filter((e) => !m.claimedIds.has(e.id));

  let ledgerRows = [...m.rows].sort((a, b) => (b.serviceDate || "").localeCompare(a.serviceDate || ""));
  if (filter === "unpaid") ledgerRows = ledgerRows.filter((e) => !e.paid);
  if (filter === "noeob") ledgerRows = ledgerRows.filter((e) => !e.hasEob);
  if (filter === "unsubmitted") ledgerRows = ledgerRows.filter((e) => !m.claimedIds.has(e.id));
  if (filter === "pharmacy") ledgerRows = ledgerRows.filter((e) => e.pharmacy);
  if (personFilter !== "all") ledgerRows = ledgerRows.filter((e) => e.personId === personFilter);

  const tiers = [
    { name: "Employer HSA deposit", note: "Their money, spent first", color: "var(--hsa)", spent: m.hsaSpent, size: m.hsaZone },
    { name: "HRA coverage", note: "Reimbursed on request", color: "var(--hra)", spent: m.hraEarned, size: m.hraZone },
    { name: "Your responsibility", note: "Out of pocket", color: "var(--own)", spent: m.ownSpent, size: m.ownZone },
  ];

  return (
    <div className="lg-root">

      <div className="lg-top">
        <div className="lg-wrap">
          <div className="lg-topin">
            <p className="lg-mark">Deductible ledger <span>· household</span></p>
            <div className="lg-years">
              {years.map((y) => (
                <button key={y.year} className="lg-yr" data-on={y.year === yearSel ? "1" : "0"}
                  onClick={() => { setYearSel(y.year); setBuilder(null); setDraft(null); }}>
                  {y.year}
                </button>
              ))}
            </div>
          </div>
          <div className="lg-tabs">
            {[
              ["overview", "Overview"],
              ["ledger", `Ledger (${m.rows.length})`],
              ["import", "Import"],
              ["submissions", `Submissions (${yearSubs.length})`],
              ["setup", "Setup"],
            ].map(([k, label]) => (
              <button key={k} className="lg-tab" data-on={view === k ? "1" : "0"} onClick={() => setView(k)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="lg-wrap">
        {!installed && !hideInstall && (
          <div className="lg-install">
            <span className="lg-installi"><Smartphone size={18} /></span>
            <div style={{ flexGrow: 1 }}>
              <p className="lg-installh">Add this to your {installSteps(platform).label} first</p>
              <p className="lg-installp">
                {platform === "iphone" || platform === "ipad"
                  ? "Right now it's a browser tab, and Safari erases saved data for tabs you haven't opened in a week. Installing it fixes that."
                  : "Installed, it opens in its own window, works offline, and keeps its data safely apart from your browser."}
              </p>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
              {promptEvent ? (
                <button className="lg-btn" onClick={() => { promptEvent.prompt(); setPromptEvent(null); }}>
                  Install
                </button>
              ) : (
                <button className="lg-btn" onClick={() => setView("setup")}>Show me how</button>
              )}
              <button className="lg-btn" data-v="bare" aria-label="Dismiss" onClick={() => setHideInstall(true)}>
                <X size={15} />
              </button>
            </div>
          </div>
        )}

        {installed && backup.state !== "granted" && data.expenses.length > 3 && view !== "setup" && (
          <div className="lg-install">
            <span className="lg-installi"><ShieldAlert size={18} /></span>
            <div style={{ flexGrow: 1 }}>
              <p className="lg-installh">No backup is set up</p>
              <p className="lg-installp">
                Everything is on this computer only. One folder in your cloud drive and it backs itself up.
              </p>
            </div>
            <button className="lg-btn" onClick={() => setView("setup")}>Set it up</button>
          </div>
        )}

        {note && (
          <p style={{ fontSize: "0.8125rem", color: "var(--ink-soft)", paddingTop: "0.85rem" }}>
            {note}{" "}
            <button className="lg-btn" data-v="bare" onClick={() => setNote("")} aria-label="Dismiss">
              <X size={12} />
            </button>
          </p>
        )}

        {view === "overview" && (
          <>
            <Hero m={m} year={year} onSubmitClick={openBuilder} />

            <div className="lg-sec">
              <h2 className="lg-sech">How the {money(year.deductible)} deductible gets funded</h2>
              <p className="lg-secn">
                {money(m.total)} logged for {year.year}. Three tiers, spent in order.
              </p>
              <Ruler m={m} />
              <div className="lg-tiers">
                {tiers.map((t) => (
                  <div className="lg-tier" key={t.name}>
                    <span className="lg-swatch" style={{ background: t.color }} />
                    <span>
                      {t.name}
                      <span className="lg-tiernote" style={{ display: "block" }}>{t.note}</span>
                    </span>
                    <span className="lg-tierval">{money(t.spent)}</span>
                    <span className="lg-tierof">of {money(t.size)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg-sec">
              <div className="lg-stats">
                <div className="lg-stat">
                  <p className="lg-statl">Bills still unpaid</p>
                  <p className="lg-fig lg-statv">{money(m.unpaid)}</p>
                  <p className="lg-statn">{m.rows.filter((e) => !e.paid).length} of {m.rows.length} claims</p>
                </div>
                <div className="lg-stat">
                  <p className="lg-statl">HRA reimbursed to date</p>
                  <p className="lg-fig lg-statv">{money(m.reimbursed)}</p>
                  <p className="lg-statn">{m.inFlight > 0 ? `${money(m.inFlight)} in flight` : `${money(m.hraZone - m.reimbursed)} of cap left`}</p>
                </div>
                <div className="lg-stat">
                  <p className="lg-statl">Your HSA cap per paycheck</p>
                  <p className="lg-fig lg-statv">{money(m.perPay)}</p>
                  <p className="lg-statn">{money(m.maxEmployee)} over {year.payPeriods} periods</p>
                </div>
                <div className="lg-stat">
                  <p className="lg-statl">Missing paperwork</p>
                  <p className="lg-fig lg-statv">{m.missingEob}</p>
                  <p className="lg-statn">claims with no EOB on file</p>
                </div>
              </div>
            </div>

            {m.byPerson.length > 0 && (
              <div className="lg-sec">
                <h2 className="lg-sech">Who the {year.year} spending went to</h2>
                <p className="lg-secn">Pharmacy split out, since the HRA treats it separately.</p>
                <table className="lg-table">
                  <thead>
                    <tr>
                      <th>Patient</th>
                      <th className="lg-r">Claims</th>
                      <th className="lg-r">Medical</th>
                      <th className="lg-r">Pharmacy</th>
                      <th className="lg-r">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.byPerson.map((p) => (
                      <tr key={p.id}>
                        <td>{p.name}</td>
                        <td className="lg-r">{p.count}</td>
                        <td className="lg-r">{money(p.medical)}</td>
                        <td className="lg-r">{money(p.pharmacy)}</td>
                        <td className="lg-r">{money(p.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="lg-cards">
                  {m.byPerson.map((p) => (
                    <div className="lg-card" key={p.id}>
                      <div className="lg-cardtop">
                        <span>{p.name}</span>
                        <span className="lg-fig lg-num">{money(p.total)}</span>
                      </div>
                      <p className="lg-cardmeta">
                        {p.count} claim{p.count > 1 ? "s" : ""} · {money(p.medical)} medical · {money(p.pharmacy)} pharmacy
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {view === "ledger" && (
          <div className="lg-sec">
            <div className="lg-bar">
              {[
                ["all", "All"],
                ["unpaid", "Unpaid"],
                ["noeob", "Missing EOB"],
                ["unsubmitted", "Not submitted"],
                ["pharmacy", "Pharmacy"],
              ].map(([k, label]) => (
                <button key={k} className="lg-chip" data-on={filter === k ? "1" : "0"} onClick={() => setFilter(k)}>
                  {label}
                </button>
              ))}
              <select value={personFilter} onChange={(e) => setPersonFilter(e.target.value)}
                style={{ width: "auto", fontSize: "0.8125rem" }}>
                <option value="all">Everyone</option>
                {data.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <span className="lg-count">
                {ledgerRows.length} shown · {money(ledgerRows.reduce((s, e) => s + e.cost, 0))}
              </span>
            </div>

            {!draft && (
              <button className="lg-btn" style={{ marginBottom: "1.25rem" }}
                onClick={() => setDraft(blankDraft(year.year, data.people))}>
                <Plus size={15} /> Log an expense
              </button>
            )}
            {draft && (
              <ExpenseForm draft={draft} setDraft={setDraft} people={data.people} years={years}
                onSave={saveExpense} onCancel={() => setDraft(null)} />
            )}

            {ledgerRows.length === 0 ? (
              <div className="lg-empty">
                <p>Nothing here for {year.year}</p>
                <p style={{ marginBottom: "0.9rem" }}>
                  Log a bill by hand, or bring in an EOB or your existing spreadsheet.
                </p>
                <button className="lg-btn" data-v="ghost" onClick={() => setView("import")}>
                  <FileSpreadsheet size={15} /> Import instead
                </button>
              </div>
            ) : (
              <>
                <table className="lg-table">
                  <thead>
                    <tr>
                      <th>Service</th>
                      <th>Patient</th>
                      <th>Purpose</th>
                      <th className="lg-r">Amount</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledgerRows.map((e) => (
                      <tr key={e.id}>
                        <td>
                          {showDate(e.serviceDate)}
                          {e.claimNo && <span className="lg-claim" style={{ display: "block" }}>claim {e.claimNo}</span>}
                        </td>
                        <td>{personName(e.personId)}</td>
                        <td>
                          {e.purpose || "—"}
                          {e.provider && <span className="lg-claim" style={{ display: "block" }}>{e.provider}</span>}
                          {(e.documentIds || []).length > 0 && (
                            <button className="lg-doc" onClick={() => openDocument(e.documentIds[0])}>
                              <Paperclip size={11} /> EOB
                            </button>
                          )}
                        </td>
                        <td className="lg-r">{money(e.cost)}</td>
                        <td><div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}><Tags e={e} claimed={m.claimedIds.has(e.id)} /></div></td>
                        <td>
                          <div className="lg-acts">
                            <button className="lg-btn" data-v="bare" title={e.paid ? "Mark unpaid" : "Mark paid"}
                              aria-label={e.paid ? "Mark unpaid" : "Mark paid"} onClick={() => togglePaid(e.id)}>
                              <Check size={15} />
                            </button>
                            <button className="lg-btn" data-v="bare" title="Attach the EOB" aria-label="Attach the EOB"
                              onClick={() => requestAttach(e.id)}>
                              <Paperclip size={15} />
                            </button>
                            <button className="lg-btn" data-v="bare" title="Edit" aria-label="Edit"
                              onClick={() => setDraft({ ...e, cost: String(e.cost) })}>
                              <Pencil size={15} />
                            </button>
                            <button className="lg-btn" data-v="bare" title="Remove" aria-label="Remove"
                              onClick={() => removeExpense(e.id)}>
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="lg-cards">
                  {ledgerRows.map((e) => (
                    <div className="lg-card" key={e.id}>
                      <div className="lg-cardtop">
                        <span>{personName(e.personId)} · {e.purpose || "Expense"}</span>
                        <span className="lg-fig lg-num">{money(e.cost)}</span>
                      </div>
                      <p className="lg-cardmeta">
                        {showDate(e.serviceDate)}{e.claimNo ? ` · claim ${e.claimNo}` : ""}
                      </p>
                      {(e.documentIds || []).length > 0 && (
                        <button className="lg-doc" onClick={() => openDocument(e.documentIds[0])}>
                          <Paperclip size={11} /> Open the EOB
                        </button>
                      )}
                      <div className="lg-cardtags">
                        <Tags e={e} claimed={m.claimedIds.has(e.id)} />
                        <span style={{ marginLeft: "auto", display: "flex", gap: "0.15rem" }}>
                          <button className="lg-btn" data-v="bare" aria-label={e.paid ? "Mark unpaid" : "Mark paid"}
                            onClick={() => togglePaid(e.id)}><Check size={16} /></button>
                          <button className="lg-btn" data-v="bare" aria-label="Attach the EOB"
                            onClick={() => requestAttach(e.id)}><Paperclip size={16} /></button>
                          <button className="lg-btn" data-v="bare" aria-label="Edit"
                            onClick={() => setDraft({ ...e, cost: String(e.cost) })}><Pencil size={16} /></button>
                          <button className="lg-btn" data-v="bare" aria-label="Remove"
                            onClick={() => removeExpense(e.id)}><Trash2 size={16} /></button>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {view === "submissions" && (
          <div className="lg-sec">
            {builder ? (
              <div className="lg-form">
                <h2 className="lg-sech">Build an HRA submission for {year.year}</h2>
                <p className="lg-secn">
                  The HRA can still reimburse {money(m.hraOwed)}. Pick the claims you're sending and adjust
                  amounts if the HRA is only covering part of one.
                </p>
                {eligibleForSub.length === 0 ? (
                  <p style={{ fontSize: "0.875rem", color: "var(--ink-soft)" }}>
                    Every {year.year} claim is already attached to a submission.
                  </p>
                ) : (
                  <>
                    {eligibleForSub.map((e) => {
                      const p = builder.picks[e.id] || { on: false, amount: String(e.cost) };
                      return (
                        <div className="lg-pick" key={e.id}>
                          <input type="checkbox" checked={p.on} aria-label={`Include ${e.purpose || "claim"}`}
                            onChange={(ev) =>
                              setBuilder({ ...builder, picks: { ...builder.picks, [e.id]: { ...p, on: ev.target.checked } } })
                            } />
                          <span style={{ fontSize: "0.875rem" }}>
                            {personName(e.personId)} · {e.purpose || "Expense"}
                            <span className="lg-claim" style={{ display: "block" }}>
                              {showDate(e.serviceDate)}{e.claimNo ? ` · claim ${e.claimNo}` : ""}{e.hasEob ? "" : " · no EOB on file"}
                            </span>
                          </span>
                          <input type="number" step="0.01" min="0" value={p.amount} disabled={!p.on}
                            aria-label="Amount to claim" style={{ width: "7rem", textAlign: "right" }}
                            onChange={(ev) =>
                              setBuilder({ ...builder, picks: { ...builder.picks, [e.id]: { ...p, amount: ev.target.value } } })
                            } />
                        </div>
                      );
                    })}
                    {(() => {
                      const sel = Object.values(builder.picks).filter((v) => v.on);
                      const tot = sel.reduce((s, v) => s + (Number(v.amount) || 0), 0);
                      return (
                        <>
                          <div className="lg-picksum">
                            <span>{sel.length} claim{sel.length === 1 ? "" : "s"} selected</span>
                            <span className="lg-fig" style={{ fontSize: "1.35rem" }}>{money(tot)}</span>
                          </div>
                          {tot > m.hraOwed && (
                            <p className="lg-warn">
                              <AlertCircle size={14} style={{ flexShrink: 0, marginTop: "0.1rem" }} />
                              That's {money(tot - m.hraOwed)} more than the HRA can still reimburse. It'll pay{" "}
                              {money(m.hraOwed)} and the rest stays yours.
                            </p>
                          )}
                          <div className="lg-formacts">
                            <button className="lg-btn" disabled={!sel.length} onClick={createSubmission}>
                              Create draft submission
                            </button>
                            <button className="lg-btn" data-v="ghost" onClick={() => setBuilder(null)}>Cancel</button>
                          </div>
                        </>
                      );
                    })()}
                  </>
                )}
              </div>
            ) : (
              <button className="lg-btn" style={{ marginBottom: "1.25rem" }} onClick={openBuilder}>
                <Plus size={15} /> New HRA submission
              </button>
            )}

            {yearSubs.length === 0 && !builder ? (
              <div className="lg-empty">
                <p>No submissions for {year.year}</p>
                <p>Once your spending passes the employer's HSA deposit, batch up the eligible claims here.</p>
              </div>
            ) : (
              yearSubs.map((s) => {
                const tot = s.lines.reduce((t, l) => t + Number(l.amount), 0);
                return (
                  <div className="lg-sub" key={s.id}>
                    <div className="lg-subtop">
                      <div>
                        <p style={{ fontSize: "0.9375rem" }}>
                          {s.type} submission ·{" "}
                          {s.status === "draft" ? "Draft" : s.status === "submitted" ? "Sent, awaiting payment" : "Reimbursed"}
                        </p>
                        <p className="lg-cardmeta">
                          Built {showDate(s.dateCreated)}
                          {s.dateSent ? ` · sent ${showDate(s.dateSent)}` : ""} · {s.lines.length} claim
                          {s.lines.length > 1 ? "s" : ""}
                        </p>
                      </div>
                      <p className="lg-fig" style={{ fontSize: "1.5rem" }}>
                        {s.status === "paid" && s.amountReceived != null ? money(s.amountReceived) : money(tot)}
                      </p>
                    </div>

                    <div className="lg-lines">
                      {s.lines.map((l) => {
                        const e = data.expenses.find((x) => x.id === l.expenseId);
                        return (
                          <div className="lg-line" key={l.expenseId}>
                            <span>{e ? `${personName(e.personId)} · ${e.purpose || "Expense"}` : "Deleted expense"}</span>
                            <span className="lg-num">{money(l.amount)}</span>
                          </div>
                        );
                      })}
                    </div>

                    <div className="lg-subacts">
                      {s.status === "draft" && (
                        <button className="lg-btn"
                          onClick={() => setSubStatus(s.id, { status: "submitted", dateSent: new Date().toISOString().slice(0, 10) })}>
                          <Send size={14} /> Mark as sent
                        </button>
                      )}
                      {s.status === "submitted" && (
                        <>
                          <input type="number" step="0.01" min="0" placeholder={String(tot)}
                            aria-label="Amount received" style={{ width: "7.5rem" }}
                            value={payInput[s.id] ?? ""} onChange={(ev) => setPayInput({ ...payInput, [s.id]: ev.target.value })} />
                          <button className="lg-btn"
                            onClick={() => {
                              const raw = payInput[s.id];
                              const amt = raw === "" || raw == null ? tot : Number(raw);
                              if (Number.isNaN(amt) || amt < 0) return;
                              setSubStatus(s.id, { status: "paid", amountReceived: Math.round(amt * 100) / 100 });
                              setPayInput({ ...payInput, [s.id]: "" });
                              setNote(`Recorded ${money(amt)} reimbursed.`);
                            }}>
                            Record payment
                          </button>
                          <button className="lg-btn" data-v="ghost" onClick={() => setSubStatus(s.id, { status: "draft", dateSent: null })}>
                            Back to draft
                          </button>
                        </>
                      )}
                      {s.status === "paid" && (
                        <span className="lg-tag" data-t="paid"><Check size={11} />Reimbursed {money(s.amountReceived ?? tot)}</span>
                      )}
                      <button className="lg-btn" data-v="bare" style={{ marginLeft: "auto" }} aria-label="Delete submission"
                        onClick={() => deleteSub(s.id)}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {view === "import" && (
          <div className="lg-sec">
            {stage ? (
              <div className="lg-review">
                <div className="lg-reviewh">
                  <div>
                    <h2 className="lg-sech">Check before it lands</h2>
                    <p className="lg-secn" style={{ marginBottom: 0 }}>
                      {stage.rows.length} line{stage.rows.length > 1 ? "s" : ""} read from {stage.label}. Fix
                      anything that looks off — nothing is saved until you commit.
                    </p>
                  </div>
                  <p className="lg-fig" style={{ fontSize: "1.5rem" }}>
                    {money(stage.rows.filter((r) => r.on).reduce((s, r) => s + r.cost, 0))}
                  </p>
                </div>

                {stage.rows.map((r) => (
                  <div className="lg-srow" key={r.key} data-dim={r.on ? "0" : "1"}>
                    <input type="checkbox" checked={r.on} aria-label="Include this line"
                      onChange={(ev) => patchStageRow(r.key, { on: ev.target.checked })} />
                    <input type="date" value={r.serviceDate} aria-label="Date of service"
                      onChange={(ev) => {
                        const v = ev.target.value;
                        patchStageRow(r.key, {
                          serviceDate: v,
                          planYear: v ? Number(v.slice(0, 4)) : r.planYear,
                        });
                      }} />
                    <div>
                      <span>{r.purpose || "Unlabelled claim"}</span>
                      {(r.provider || r.claimNo) && (
                        <span className="lg-claim" style={{ display: "block" }}>
                          {[r.provider, r.claimNo && `claim ${r.claimNo}`].filter(Boolean).join(" · ")}
                        </span>
                      )}
                      <div className="lg-sflags">
                        {r.dup === "exact" && <span className="lg-tag" data-t="noeob">Already in ledger</span>}
                        {r.dup === "likely" && <span className="lg-tag" data-t="unpaid">Possible duplicate</span>}
                        {r.planYear && r.planYear !== year.year && (
                          <span className="lg-tag" data-t="sub">{r.planYear} plan year</span>
                        )}
                        {r.pharmacy && <span className="lg-tag" data-t="sub">Pharmacy</span>}
                        {r.issues.map((i) => (
                          <span className="lg-tag" data-t="noeob" key={i}>{i}</span>
                        ))}
                      </div>
                    </div>
                    <select value={r.personId} aria-label="Patient"
                      onChange={(ev) => patchStageRow(r.key, { personId: ev.target.value })}>
                      <option value="">Unassigned</option>
                      {data.people.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                      {r.patientName && !data.people.some((p) => p.id === r.personId) && (
                        <option value={`new:${r.patientName}`}>Add “{r.patientName}”</option>
                      )}
                    </select>
                    <input type="number" step="0.01" min="0" value={r.cost} aria-label="Amount"
                      style={{ textAlign: "right" }}
                      onChange={(ev) => patchStageRow(r.key, { cost: Number(ev.target.value) || 0 })} />
                  </div>
                ))}

                {stage.configs.length > 0 && (
                  <>
                    <p className="lg-cfgi" style={{ marginTop: "1rem" }}>
                      Plan settings found in the file — these will overwrite what's in Setup:
                    </p>
                    {stage.configs.map((c) => (
                      <div className="lg-cfg" key={c.year}>
                        <div>
                          <p className="lg-cfgi">{c.year} plan year</p>
                        </div>
                        {c.irsMax != null && (
                          <div><p className="lg-cfgi">IRS max</p><p className="lg-cfgv">{money(c.irsMax)}</p></div>
                        )}
                        {c.employerContribution != null && (
                          <div><p className="lg-cfgi">Employer HSA</p><p className="lg-cfgv">{money(c.employerContribution)}</p></div>
                        )}
                        {c.hraCap != null && (
                          <div><p className="lg-cfgi">HRA cap</p><p className="lg-cfgv">{money(c.hraCap)}</p></div>
                        )}
                        {c.deductible != null && (
                          <div><p className="lg-cfgi">Deductible</p><p className="lg-cfgv">{money(c.deductible)}</p></div>
                        )}
                      </div>
                    ))}
                  </>
                )}

                <div className="lg-formacts">
                  <button className="lg-btn" onClick={commitStage}
                    disabled={!stage.rows.some((r) => r.on && r.cost > 0)}>
                    <Check size={15} /> Add {stage.rows.filter((r) => r.on && r.cost > 0).length} to the ledger
                  </button>
                  <button className="lg-btn" data-v="ghost" onClick={() => setStage(null)}>Discard</button>
                  <button className="lg-btn" data-v="ghost"
                    onClick={() => setStage({ ...stage, rows: stage.rows.map((r) => ({ ...r, on: true })) })}>
                    Select all
                  </button>
                </div>
              </div>
            ) : (
              <>
                <h2 className="lg-sech">Get claims in without typing them</h2>
                <p className="lg-secn">
                  Everything lands in a review step first, so a misread number never reaches your ledger silently.
                </p>

                <div className="lg-lanes">
                  <div className="lg-lane">
                    <span className="lg-lanei"><ScanLine size={20} /></span>
                    <p className="lg-laneh">Drop in an EOB</p>
                    <p className="lg-lanep">
                      A PDF or a photo of the statement. Every claim line comes back with the date, provider and
                      your share pulled out — not the billed amount.
                    </p>
                    <button className="lg-btn" data-v="ghost" disabled={!!busy}
                      onClick={() => eobRef.current?.click()}>
                      Choose a PDF or photo
                    </button>
                    <input ref={eobRef} className="lg-hidefile" type="file"
                      accept="application/pdf,image/png,image/jpeg,image/webp"
                      onChange={(ev) => readEob(ev.target.files?.[0])} />
                    <p className="lg-lanefoot">Sent to Anthropic's API to be read.</p>
                  </div>

                  <div className="lg-lane">
                    <span className="lg-lanei"><FileSpreadsheet size={20} /></span>
                    <p className="lg-laneh">Bring your workbook</p>
                    <p className="lg-lanep">
                      Point it at the spreadsheet you're using now. It finds the header row wherever it sits,
                      reads a sheet per plan year, and picks up your deductible and HRA numbers too.
                    </p>
                    <button className="lg-btn" data-v="ghost" disabled={!!busy}
                      onClick={() => bookRef.current?.click()}>
                      Choose .xlsx or .csv
                    </button>
                    <input ref={bookRef} className="lg-hidefile" type="file"
                      accept=".xlsx,.xlsm,.xls,.csv,.tsv"
                      onChange={(ev) => readBook(ev.target.files?.[0])} />
                    <p className="lg-lanefoot">Parsed here in the browser.</p>
                  </div>

                  <div className="lg-lane">
                    <span className="lg-lanei"><ClipboardType size={20} /></span>
                    <p className="lg-laneh">Paste from the portal</p>
                    <p className="lg-lanep">
                      Select the claims table on your insurer's site and paste it. Ragged columns and wrapped
                      rows are fine.
                    </p>
                    <button className="lg-btn" data-v="ghost" disabled={!!busy}
                      onClick={() => setShowPaste((v) => !v)}>
                      {showPaste ? "Hide the box" : "Paste claim text"}
                    </button>
                    <p className="lg-lanefoot">Sent to Anthropic's API to be read.</p>
                  </div>
                </div>

                {showPaste && (
                  <div className="lg-form" style={{ marginTop: "1.25rem" }}>
                    <div className="lg-field">
                      <label className="lg-label" htmlFor="paste-box">Claim text</label>
                      <textarea id="paste-box" rows={7} value={pasted} onChange={(ev) => setPasted(ev.target.value)}
                        placeholder={"01/09/2026  Riverside Family Medicine  Office visit  Claim 1234  Billed 1,240.00  Plan paid 373.00  You owe 867.00"} />
                    </div>
                    <div className="lg-formacts">
                      <button className="lg-btn" onClick={readPasted} disabled={!!busy}>Read this</button>
                      <button className="lg-btn" data-v="ghost" onClick={() => { setShowPaste(false); setPasted(""); }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {busy && (
                  <p className="lg-busy"><Loader size={16} className="lg-spin" />{busy}</p>
                )}
                {fail && (
                  <p className="lg-fail">
                    <AlertCircle size={14} style={{ flexShrink: 0, marginTop: "0.1rem" }} />
                    {fail}
                  </p>
                )}

                <p className="lg-secn" style={{ marginTop: "1.5rem", marginBottom: 0 }}>
                  Reading an EOB or pasted text sends that content to Anthropic's API. Spreadsheet parsing never
                  leaves your browser. Both are worth knowing about, since these documents carry names and
                  diagnoses.
                </p>
              </>
            )}
          </div>
        )}

        {view === "setup" && (
          <>
            <div className="lg-sec">
              <h2 className="lg-sech">
                {installed ? "Installed on this device" : `Install on ${installSteps(platform).label}`}
              </h2>
              {installed ? (
                <>
                  <p className="lg-secn">
                    You're running the installed app, so it works offline and this device won't clear your ledger.
                  </p>
                  {persisted === false && (
                    <p className="lg-fail">
                      <ShieldAlert size={14} style={{ flexShrink: 0, marginTop: "0.1rem" }} />
                      This browser wouldn't grant durable storage. Download a backup regularly.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="lg-secn">{installSteps(platform).lede}</p>
                  <ol className="lg-steps">
                    {installSteps(platform).steps.map((s) => <li key={s}>{s}</li>)}
                  </ol>
                  <p className="lg-installp" style={{ marginTop: "0.85rem" }}>{installSteps(platform).why}</p>
                  {promptEvent && (
                    <button className="lg-btn" style={{ marginTop: "0.85rem" }}
                      onClick={() => { promptEvent.prompt(); setPromptEvent(null); }}>
                      <Smartphone size={15} /> Install now
                    </button>
                  )}
                </>
              )}
            </div>

            <div className="lg-sec">
              <h2 className="lg-sech">Plan years</h2>
              <p className="lg-secn">
                These are the numbers every calculation reads. Change them here instead of hunting through formulas.
              </p>
              {years.map((y) => (
                <div className="lg-setrow" key={y.year}>
                  {[
                    ["irsMax", "IRS HSA maximum"],
                    ["employerContribution", "Employer HSA deposit"],
                    ["hraCap", "HRA covers up to"],
                    ["deductible", "Family deductible"],
                    ["payPeriods", "Pay periods"],
                  ].map(([k, label]) => (
                    <div className="lg-field" key={k}>
                      <label className="lg-label" htmlFor={`s-${y.year}-${k}`}>
                        {y.year} {label}
                      </label>
                      <input id={`s-${y.year}-${k}`} type="number" min="0" value={y[k]}
                        onChange={(ev) =>
                          setData((d) => ({
                            ...d,
                            planYears: d.planYears.map((py) =>
                              py.year === y.year ? { ...py, [k]: Number(ev.target.value) || 0 } : py
                            ),
                          }))
                        } />
                    </div>
                  ))}
                  <div className="lg-field">
                    <span className="lg-label">Your HSA room</span>
                    <p className="lg-fig lg-num" style={{ fontSize: "1.15rem", paddingTop: "0.2rem" }}>
                      {money(Math.max(y.irsMax - y.employerContribution, 0))}
                    </p>
                  </div>
                </div>
              ))}
              <div style={{ marginTop: "1.1rem" }}>
                <button className="lg-btn" data-v="ghost"
                  onClick={() => {
                    const next = Math.max(...data.planYears.map((y) => y.year)) + 1;
                    const last = years[0];
                    setData((d) => ({ ...d, planYears: [...d.planYears, { ...last, year: next }] }));
                    setYearSel(next);
                    setNote(`Added ${next}, copied from ${last.year}. Update the numbers when open enrollment lands.`);
                  }}>
                  <Plus size={15} /> Add next plan year
                </button>
              </div>
            </div>

            <div className="lg-sec">
              <h2 className="lg-sech">Household</h2>
              <p className="lg-secn">Names show up on every claim. Rename them to match your EOBs.</p>
              {data.people.map((p) => (
                <div className="lg-field" key={p.id} style={{ maxWidth: "18rem", marginBottom: "0.6rem" }}>
                  <input type="text" value={p.name}
                    onChange={(ev) =>
                      setData((d) => ({
                        ...d,
                        people: d.people.map((x) => (x.id === p.id ? { ...x, name: ev.target.value } : x)),
                      }))
                    } />
                </div>
              ))}
              <button className="lg-btn" data-v="ghost"
                onClick={() =>
                  setData((d) => ({ ...d, people: [...d.people, { id: uid(), name: `Person ${d.people.length + 1}` }] }))
                }>
                <Plus size={15} /> Add a family member
              </button>
            </div>

            <div className="lg-sec">
              <h2 className="lg-sech">Reading documents</h2>
              <p className="lg-secn">
                An Anthropic API key lets the importer read EOBs and pasted claim text. Spreadsheet import works
                without one. The key is kept in this browser and sent only to Anthropic.
              </p>
              <div className="lg-key">
                <div className="lg-field">
                  <label className="lg-label" htmlFor="api-key">API key</label>
                  <input id="api-key" type="password" value={apiKey} placeholder="sk-ant-…"
                    onChange={(ev) => setApiKeyState(ev.target.value)} />
                </div>
                <button className="lg-btn" onClick={() => { setKey(apiKey); setNote(apiKey ? "Key saved." : "Key removed."); }}>
                  <KeyRound size={15} /> Save key
                </button>
              </div>
            </div>

            <div className="lg-sec">
              <h2 className="lg-sech">Backups</h2>
              <p className="lg-secn">
                This is the only thing that can really go wrong: one computer, one copy. Pick a folder inside
                iCloud Drive, Dropbox or OneDrive and every change is written there within seconds — ledger and
                attached EOBs both — so the backup is offsite without you thinking about it.
              </p>

              {backup.state === "unsupported" ? (
                <>
                  <p className="lg-fail">
                    <ShieldAlert size={14} style={{ flexShrink: 0, marginTop: "0.1rem" }} />
                    This browser can't write to a folder automatically. Chrome or Edge can. For now, download a
                    backup by hand every month or so.
                  </p>
                  <button className="lg-btn" onClick={exportBackup}>
                    <Download size={15} /> Download a backup
                  </button>
                </>
              ) : backup.state === "granted" ? (
                <>
                  <p className="lg-backup">
                    <FolderCheck size={15} style={{ color: "var(--hsa)", flexShrink: 0 }} />
                    Backing up to <strong>{backup.name}</strong>
                    {backup.lastAt
                      ? ` · last written ${daysSince(backup.lastAt) === 0 ? "today" : `${daysSince(backup.lastAt)} days ago`}`
                      : " · waiting for the first change"}
                  </p>
                  <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", marginTop: "0.85rem" }}>
                    <button className="lg-btn" data-v="ghost"
                      onClick={async () => {
                        const r = await writeBackup(data);
                        setBackupMsg(r.ok ? "Written." : "Couldn't write — try reconnecting the folder.");
                        if (r.ok) setBackup((b) => ({ ...b, lastAt: r.at }));
                      }}>
                      Back up now
                    </button>
                    <button className="lg-btn" data-v="ghost"
                      onClick={async () => { await forgetFolder(); setBackup({ state: "none" }); setBackupMsg(""); }}>
                      Stop backing up
                    </button>
                  </div>
                </>
              ) : backup.state === "prompt" || backup.state === "denied" ? (
                <>
                  <p className="lg-backup">
                    <ShieldAlert size={15} style={{ color: "var(--own)", flexShrink: 0 }} />
                    The folder <strong>{backup.name}</strong> needs permission again — browsers drop it on restart.
                  </p>
                  <button className="lg-btn" style={{ marginTop: "0.85rem" }}
                    onClick={async () => {
                      const p = await reconnectFolder();
                      const next = await folderStatus();
                      setBackup(next);
                      setBackupMsg(p === "granted" ? "Reconnected." : "Permission declined.");
                    }}>
                    <FolderCheck size={15} /> Reconnect the folder
                  </button>
                </>
              ) : (
                <button className="lg-btn"
                  onClick={async () => {
                    try {
                      await chooseFolder();
                      const next = await folderStatus();
                      setBackup(next);
                      const r = await writeBackup(data);
                      if (r.ok) {
                        setBackup((b) => ({ ...b, lastAt: r.at }));
                        setBackupMsg("Folder set. First backup written.");
                      }
                    } catch (err) {
                      setBackupMsg("No folder chosen.");
                    }
                  }}>
                  <FolderPlus size={15} /> Choose a backup folder
                </button>
              )}

              {backupMsg && <p className="lg-secn" style={{ marginTop: "0.7rem", marginBottom: 0 }}>{backupMsg}</p>}
            </div>

            <div className="lg-sec">
              <h2 className="lg-sech">Restore or move to a new computer</h2>
              <p className="lg-secn">
                Pick the <code>ledger.json</code> from a backup. This replaces everything currently here. If you
                point it at the whole backup folder instead, attached EOBs come back too.
              </p>
              <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
                <button className="lg-btn" data-v="ghost" onClick={() => restoreRef.current?.click()}>
                  <Upload size={15} /> Restore from a file
                </button>
                {canAutoBackup() && (
                  <button className="lg-btn" data-v="ghost"
                    onClick={async () => {
                      try {
                        const dir = await window.showDirectoryPicker({ mode: "readwrite" });
                        const fh = await dir.getFileHandle("ledger.json");
                        const restored = await readBackupFile(await fh.getFile());
                        const n = await restoreDocumentsFrom(dir);
                        setData(restored);
                        setDocs(await documentSummary());
                        setNote(`Restored ${restored.expenses.length} claims and ${n} document${n === 1 ? "" : "s"}.`);
                        setView("overview");
                      } catch (err) {
                        setBackupMsg("Couldn't read a backup from that folder.");
                      }
                    }}>
                    <FolderCheck size={15} /> Restore from a folder
                  </button>
                )}
              </div>
            </div>

            <div className="lg-sec">
              <h2 className="lg-sech">Your data</h2>
              <p className="lg-secn">
                The ledger and {docs.count} stored document{docs.count === 1 ? "" : "s"} (
                {(docs.bytes / 1048576).toFixed(1)} MB) live in this browser. Nothing is sent anywhere. None of
                this is tax advice; check submissions against your plan documents.
              </p>
              <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
                <button className="lg-btn" data-v="ghost" onClick={exportWorkbook}>
                  <FileSpreadsheet size={15} /> Export to Excel
                </button>
                <button className="lg-btn" data-v="ghost" onClick={resetAll}>
                  <RotateCcw size={15} /> Reset to demo data
                </button>
              </div>
            </div>
          </>
        )}

        <input ref={restoreRef} className="lg-hidefile" type="file" accept=".json,application/json"
          onChange={async (ev) => {
            const f = ev.target.files?.[0];
            if (!f) return;
            try {
              const restored = await readBackupFile(f);
              setData(restored);
              setNote(`Restored ${restored.expenses.length} claims. Attached documents aren't in a .json backup.`);
              setView("overview");
            } catch (err) {
              setBackupMsg(err.message);
            } finally {
              if (restoreRef.current) restoreRef.current.value = "";
            }
          }} />

        <input ref={attachRef} className="lg-hidefile" type="file"
          accept="application/pdf,image/png,image/jpeg,image/webp"
          onChange={(ev) => attachToExpense(ev.target.files?.[0])} />

        <p style={{ fontSize: "0.75rem", color: "var(--ink-faint)", paddingTop: "1.5rem", display: "flex", gap: "0.35rem", alignItems: "center" }}>
          <FileText size={12} /> Saved to this device as you type. Works offline.
        </p>
      </div>
    </div>
  );
}
