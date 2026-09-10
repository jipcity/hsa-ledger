export const seed = () => ({
  version: 1,
  people: [
    { id: "p1", name: "Person 1" },
    { id: "p2", name: "Person 2" },
    { id: "p3", name: "Person 3" },
  ],
  planYears: [
    {
      year: 2026,
      irsMax: 8750,
      employerContribution: 4400,
      deductible: 10000,
      hraCap: 3200,
      payPeriods: 26,
    },
    {
      year: 2025,
      irsMax: 8550,
      employerContribution: 4200,
      deductible: 10000,
      hraCap: 3400,
      payPeriods: 26,
    },
  ],
  expenses: [
    {
      id: "e1",
      serviceDate: "2026-01-09",
      eobDate: "2026-01-16",
      claimNo: "1234",
      provider: "",
      purpose: "Doctor",
      personId: "p1",
      cost: 867,
      pharmacy: false,
      paid: false,
      hasEob: false,
      planYear: 2026,
      notes: "",
    },
    {
      id: "e2",
      serviceDate: "2026-01-16",
      eobDate: "2026-01-23",
      claimNo: "5678",
      provider: "",
      purpose: "Something",
      personId: "p2",
      cost: 5309,
      pharmacy: false,
      paid: false,
      hasEob: true,
      planYear: 2026,
      notes: "",
    },
    {
      id: "e3",
      serviceDate: "2026-01-22",
      eobDate: "2026-01-29",
      claimNo: "91011",
      provider: "",
      purpose: "Else",
      personId: "p3",
      cost: 10,
      pharmacy: false,
      paid: true,
      hasEob: false,
      planYear: 2026,
      notes: "",
    },
    {
      id: "e4",
      serviceDate: "2025-03-04",
      eobDate: "2025-03-14",
      claimNo: "4421",
      provider: "",
      purpose: "Office visit",
      personId: "p1",
      cost: 100,
      pharmacy: false,
      paid: true,
      hasEob: true,
      planYear: 2025,
      notes: "",
    },
    {
      id: "e5",
      serviceDate: "2025-06-18",
      eobDate: "2025-06-27",
      claimNo: "5530",
      provider: "",
      purpose: "Lab work",
      personId: "p2",
      cost: 500,
      pharmacy: false,
      paid: true,
      hasEob: true,
      planYear: 2025,
      notes: "",
    },
    {
      id: "e6",
      serviceDate: "2025-11-02",
      eobDate: "2025-11-12",
      claimNo: "6688",
      provider: "",
      purpose: "Specialist",
      personId: "p3",
      cost: 4000,
      pharmacy: false,
      paid: false,
      hasEob: true,
      planYear: 2025,
      notes: "",
    },
  ],
  submissions: [],
});

export const uid = () => Math.random().toString(36).slice(2, 10);

export const money = (n) => {
  const v = Math.round((n || 0) * 100) / 100;
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
    maximumFractionDigits: 2,
  });
};

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const showDate = (s) => {
  if (!s) return "—";
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return s;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};

export const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function normalizeDate(v) {
  if (v == null || v === "") return "";
  if (v instanceof Date && !Number.isNaN(v.getTime())) return iso(v);
  if (typeof v === "number" && v > 20000 && v < 60000) {
    return iso(new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000));
  }
  const s = String(v).trim();
  let mm = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (mm) return `${mm[1]}-${mm[2].padStart(2, "0")}-${mm[3].padStart(2, "0")}`;
  mm = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (mm) {
    const y = mm[3].length === 2 ? `20${mm[3]}` : mm[3];
    return `${y}-${mm[1].padStart(2, "0")}-${mm[2].padStart(2, "0")}`;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? "" : iso(new Date(t));
}

export const truthy = (v) =>
  v === true || v === 1 || (typeof v === "string" && /^(true|yes|y|x|1|paid|done|✓)$/i.test(v.trim()));

export const num = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const n = Number(v.replace(/[$,\s]/g, ""));
  return v.trim() && Number.isFinite(n) ? n : null;
};

export const HEADERS = [
  ["serviceDate", /service\s*date|date of service|^dos$|^svc/i],
  ["eobDate", /eob\s*date|process(ed)?\s*date|statement\s*date/i],
  ["cost", /eob\s*cost|patient\s*resp|you\s*owe|your\s*resp|amount\s*owed|^amount$|^cost$|^total$|^charge/i],
  ["hraReimb", /hra\s*reimb/i],
  ["claimNo", /claim/i],
  ["provider", /provider|facility|physician|doctor|clinic/i],
  ["purpose", /purpose|description|service\s*type|reason|treatment/i],
  ["patientName", /patient|member|person|^who$|^name$/i],
  ["pharmacy", /pharmacy|^rx$|prescription/i],
  ["paid", /^paid/i],
  ["hasEob", /^eob$|eob on file|eob rec/i],
  ["notes", /note|comment|memo/i],
];

export function mapHeaderRow(row) {
  const map = {};
  row.forEach((cell, i) => {
    if (typeof cell !== "string" || !cell.trim()) return;
    for (const [field, re] of HEADERS) {
      if (map[field] == null && re.test(cell.trim())) {
        map[field] = i;
        return;
      }
    }
  });
  return map;
}

export const CONFIG_LABELS = [
  ["employerContribution", /employer\s*hsa\s*deposit|simv\s*hsa\s*deposit/i],
  ["employerContribution", /^(simv|employer)\s*contribution$/i],
  ["hraCap", /hra\s*reimburse/i],
  ["irsMax", /irs\s*hsa\s*max/i],
  ["deductible", /^deductible$|family\s*deductible/i],
];

export function sniffConfig(rows) {
  const found = {};
  rows.forEach((row) => {
    if (!row) return;
    row.forEach((cell, i) => {
      if (typeof cell !== "string" || !cell.trim()) return;
      for (const [field, re] of CONFIG_LABELS) {
        if (found[field] != null || !re.test(cell.trim())) continue;
        for (let j = i + 1; j <= i + 6 && j < row.length + 6; j++) {
          const n = num(row[j]);
          if (n != null && n > 0) {
            found[field] = Math.round(n);
            break;
          }
        }
      }
    });
  });
  return found;
}

export async function parseWorkbook(buffer) {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buffer, { cellDates: true });
  const claims = [];
  const configs = [];
  wb.SheetNames.forEach((name) => {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], {
      header: 1,
      defval: null,
      blankrows: true,
    });
    if (!rows.length) return;

    const sheetYear = /^\d{4}$/.test(name.trim()) ? Number(name.trim()) : null;
    const cfg = sniffConfig(rows.slice(0, 12));
    if (sheetYear && Object.keys(cfg).length >= 2) {
      configs.push({ year: sheetYear, ...cfg });
    }

    let hi = -1;
    let map = {};
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const candidate = mapHeaderRow(rows[i] || []);
      const hits = Object.keys(candidate).length;
      if (hits >= 3 && (candidate.cost != null || candidate.patientName != null)) {
        hi = i;
        map = candidate;
        break;
      }
    }
    if (hi === -1) return;

    let blanks = 0;
    for (let i = hi + 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const at = (f) => (map[f] != null ? row[map[f]] : null);
      const cost = num(at("cost"));
      const patient = at("patientName");
      const sd = normalizeDate(at("serviceDate"));
      if (cost == null && !patient && !sd) {
        if (++blanks > 10) break;
        continue;
      }
      blanks = 0;
      if (cost == null || cost <= 0) continue;
      const planYear = sheetYear || (sd ? Number(sd.slice(0, 4)) : null);
      claims.push({
        serviceDate: sd,
        eobDate: normalizeDate(at("eobDate")),
        claimNo: at("claimNo") == null ? "" : String(at("claimNo")).trim(),
        provider: at("provider") == null ? "" : String(at("provider")).trim(),
        purpose: at("purpose") == null ? "" : String(at("purpose")).trim(),
        patientName: patient == null ? "" : String(patient).trim(),
        cost: Math.round(cost * 100) / 100,
        pharmacy: truthy(at("pharmacy")),
        paid: truthy(at("paid")),
        hasEob: truthy(at("hasEob")),
        planYear,
        notes: at("notes") == null ? "" : String(at("notes")).trim(),
        source: `${name} sheet, row ${i + 1}`,
      });
    }
  });
  return { claims, configs };
}

export const EOB_PROMPT = `You read explanation-of-benefits documents and pull out the claim lines.

Return ONLY a JSON array. No prose, no markdown fences. Each element:
{"sd":"YYYY-MM-DD date of service","ed":"YYYY-MM-DD date the EOB was processed or null","cl":"claim number or null","pr":"provider name or null","pu":"short service description, 4 words max","pt":"patient name or null","amt":number,"rx":boolean}

"amt" must be the PATIENT RESPONSIBILITY — what the member owes after the plan pays. Never the billed amount, the allowed amount, or the plan's payment. If the document labels a column "patient responsibility", "you owe", "your share", or "amount you may be billed", use that.
"rx" is true only for prescription or pharmacy claims.
Use null for anything not stated. Do not invent values. One element per claim line, at most 25.`;

export const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(new Error("That file couldn't be read."));
    r.readAsDataURL(file);
  });

export function fromApiItem(it, sourceLabel) {
  const sd = normalizeDate(it.sd);
  const amt = num(it.amt);
  return {
    serviceDate: sd,
    eobDate: normalizeDate(it.ed),
    claimNo: it.cl ? String(it.cl).trim() : "",
    provider: it.pr ? String(it.pr).trim() : "",
    purpose: it.pu ? String(it.pu).trim() : "",
    patientName: it.pt ? String(it.pt).trim() : "",
    cost: amt == null ? 0 : Math.round(amt * 100) / 100,
    pharmacy: it.rx === true,
    paid: false,
    hasEob: true,
    planYear: sd ? Number(sd.slice(0, 4)) : null,
    notes: "",
    source: sourceLabel,
  };
}

export function matchPerson(name, people) {
  if (!name) return "";
  const n = name.trim().toLowerCase();
  const exact = people.find((p) => p.name.trim().toLowerCase() === n);
  if (exact) return exact.id;
  const first = n.split(/[\s,]+/)[0];
  const partial = people.find((p) => {
    const pn = p.name.trim().toLowerCase();
    return pn.split(/[\s,]+/)[0] === first || pn.startsWith(first) || n.startsWith(pn.split(/\s+/)[0]);
  });
  return partial ? partial.id : "";
}

export function stageClaims(raw, people, expenses, fallbackYear) {
  return raw.map((c, i) => {
    const planYear = c.planYear || fallbackYear;
    const personId = matchPerson(c.patientName, people);
    const dupExact = c.claimNo
      ? expenses.find((e) => e.claimNo && e.claimNo === c.claimNo && e.planYear === planYear)
      : null;
    const dupLikely =
      !dupExact &&
      expenses.find(
        (e) =>
          Math.abs(e.cost - c.cost) < 0.01 &&
          e.planYear === planYear &&
          (!c.serviceDate || !e.serviceDate || e.serviceDate === c.serviceDate)
      );
    const issues = [];
    if (!c.serviceDate) issues.push("no date");
    if (!c.cost) issues.push("no amount");
    if (c.patientName && !personId) issues.push("new patient");
    if (!c.patientName) issues.push("no patient");
    return {
      key: `s${i}`,
      ...c,
      planYear,
      personId: personId || (c.patientName ? `new:${c.patientName}` : ""),
      dup: dupExact ? "exact" : dupLikely ? "likely" : null,
      issues,
      on: !dupExact && c.cost > 0,
    };
  });
}

export function tierMath(year, expenses, submissions, people) {
  const rows = expenses.filter((e) => e.planYear === year.year);
  const total = rows.reduce((s, e) => s + e.cost, 0);
  const pharmacy = rows.filter((e) => e.pharmacy).reduce((s, e) => s + e.cost, 0);
  const unpaid = rows.filter((e) => !e.paid).reduce((s, e) => s + e.cost, 0);
  const missingEob = rows.filter((e) => !e.hasEob).length;

  const hsaZone = year.employerContribution;
  const hraZone = year.hraCap;
  const ownZone = Math.max(year.deductible - hsaZone - hraZone, 0);

  const hsaSpent = Math.min(total, hsaZone);
  const overHsa = Math.max(total - hsaZone, 0);
  const hraEarned = Math.min(overHsa, hraZone);
  const ownSpent = Math.max(total - hsaZone - hraZone, 0);

  const subs = submissions.filter((s) => s.planYear === year.year && s.type === "HRA");
  const linesOf = (s) => s.lines.reduce((t, l) => t + (Number(l.amount) || 0), 0);
  const reimbursed = subs
    .filter((s) => s.status === "paid")
    .reduce((t, s) => t + (s.amountReceived != null ? Number(s.amountReceived) : linesOf(s)), 0);
  const inFlight = subs.filter((s) => s.status === "submitted").reduce((t, s) => t + linesOf(s), 0);

  const claimedIds = new Set(
    subs.flatMap((s) => (s.status === "void" ? [] : s.lines.map((l) => l.expenseId)))
  );

  const hraOwed = Math.max(hraEarned - reimbursed - inFlight, 0);
  const untilHra = Math.max(hsaZone - total, 0);

  const byPerson = people
    .map((p) => {
      const own = rows.filter((e) => e.personId === p.id);
      const t = own.reduce((s, e) => s + e.cost, 0);
      const rx = own.filter((e) => e.pharmacy).reduce((s, e) => s + e.cost, 0);
      return { ...p, total: t, pharmacy: rx, medical: t - rx, count: own.length };
    })
    .filter((p) => p.count > 0)
    .sort((a, b) => b.total - a.total);

  const maxEmployee = Math.max(year.irsMax - year.employerContribution, 0);

  return {
    rows, total, pharmacy, medical: total - pharmacy, unpaid, missingEob,
    hsaZone, hraZone, ownZone, hsaSpent, hraEarned, ownSpent,
    reimbursed, inFlight, hraOwed, untilHra, claimedIds, byPerson,
    maxEmployee, perPay: year.payPeriods > 0 ? maxEmployee / year.payPeriods : 0,
    hraRemaining: Math.max(hraZone - hraEarned, 0),
  };
}
