# Deductible ledger

A local-first tracker for medical spending against an HSA + HRA deductible. It answers one
question on the front page: can I submit for reimbursement yet, and for how much.

Grown out of a spreadsheet that computed the same thing across a grid of formulas, with the
answer buried in cell X7.

## Who runs npm, and who doesn't

The people using this app never touch a terminal. `npm` is a **publishing** step, done once by
whoever sets it up, not an install step. After that everyone else gets a URL and adds it to
their phone or Dock. Hand them `INSTALL.md` — it's written for non-technical readers.

Three ways to publish, in increasing order of effort:

**1. Drag and drop, no tooling at all.** Take the prebuilt `dist/` folder (or `dist.zip`) and
drop it on [Netlify Drop](https://app.netlify.com/drop) or Cloudflare Pages. You get an HTTPS
URL in about thirty seconds and never install anything. To update later, drop a new build.

**2. GitHub, no local tooling.** Push this repo to GitHub, then Settings → Pages → Source:
"GitHub Actions". `.github/workflows/publish.yml` builds it on GitHub's runners and publishes
to `https://<user>.github.io/<repo>/`. Every push republishes.

**3. Local build.**

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static files in dist/
```

HTTPS is not optional — service workers, install prompts and offline mode all require it.
Netlify, Cloudflare, and GitHub Pages give it to you. `file://` does not, which is why there's
no "double-click this HTML file" option: it would load, then quietly fail to install, fail to
work offline, and on Safari fail to keep its data.

## How the money works

Three funding tiers, spent in order:

| Tier | 2026 | Who pays |
| --- | --- | --- |
| Employer HSA deposit | $4,400 | Them, deposited up front |
| HRA coverage | $3,200 | Them, on request after you submit |
| Your responsibility | $2,400 | You, out of pocket |
| **Family deductible** | **$10,000** | |

The HRA turns on once cumulative spend passes the employer's HSA deposit. From there:

```
overage        = max(total spend − employer deposit, 0)
hra earned     = min(overage, hra cap)
hra owes you   = hra earned − already reimbursed − in flight
```

All of it lives in one function, `tierMath` in `src/lib/core.js`, so two plan years can't
silently disagree with each other the way two spreadsheet tabs can.

## Getting data in

Three paths, all landing in the same review step before anything is written:

**Spreadsheet** — `src/lib/core.js`. Scans the first 30 rows of each sheet for a header row,
matching cells against `HEADERS` regexes, so the table can start anywhere and columns can be in
any order or shift between years. Sheet names that look like a year become the plan year. It
also sniffs plan settings by finding labels like `SimV HSA Deposit` or `HRA Reimburses/d` and
taking the first number within six cells to the right, which survives merged cells. Runs
entirely in the browser.

**EOB document** — `src/lib/read-eob.js`. Sends a PDF or photo to the Anthropic API and gets
back one row per claim line. The prompt is emphatic that the extracted amount must be patient
responsibility, never the billed or allowed amount. The source file is stored as a Blob and
attached to every claim it produced.

**Pasted text** — same reader, for insurer portals with no downloadable EOB.

The review step flags exact duplicates by claim number (unchecked by default, so re-importing
is safe), likely duplicates by amount and date, missing fields, and rows belonging to a
different plan year. Patient names are fuzzy-matched against the household.

## Storage

`src/db.js`, two Dexie stores:

- `state` — the entire ledger as one JSON document. A household produces a few hundred claims a
  year and always reads them together, so normalising into tables would buy queries nobody runs.
- `documents` — EOB files as real Blobs. This is the part a key-value store can't do, and the
  reason this app exists outside a sandbox.

Nothing syncs. Use **Download a backup** in Setup; note that it captures the ledger, not the
attached files, which stay in this browser's IndexedDB. Clearing site data deletes both.

### Two platform facts the app has to work around

`src/lib/install.js` exists because of these, and both are handled in the UI rather than left
as documentation nobody reads:

**iOS erases uninstalled sites.** Safari deletes IndexedDB, localStorage and service worker
registrations after seven days without user interaction. Home Screen web apps are exempt —
they get their own days-of-use counter. So on iPhone, installing isn't a nicety, it's what
keeps the ledger from vanishing over a quiet fortnight. The app shows a banner until it detects
it's running standalone, and calls `navigator.storage.persist()` on every mount, since Safari
resets that grant each launch.

**macOS web apps have separate storage.** "Add to Dock" creates a container that shares no data
with Safari. Install first, import second, or the import lands in the browser tab and the app
opens empty. `INSTALL.md` says this in bold.

## The API key

Reading documents needs an Anthropic API key. Two options:

1. **Paste it in Setup.** It goes to `localStorage` and is sent only to Anthropic, using the
   `anthropic-dangerous-direct-browser-access` header. Fine on a personal device. Not fine on a
   shared machine, and it means anyone with access to the browser has your key.
2. **Proxy it.** Set `VITE_API_PROXY` to a URL that holds the key server-side and forwards to
   `https://api.anthropic.com/v1/messages`. A single serverless function is enough. The client
   then sends no credentials at all.

Spreadsheet import and every calculation work with no key and no network.

## Privacy

EOBs carry names, providers, and procedure descriptions. Reading one sends that content to
Anthropic's API; the UI says so under the button rather than burying it. Spreadsheet parsing
and all stored data never leave the device. If sending claim documents to a third party isn't
acceptable to you, use the spreadsheet path and attach the PDFs manually with the paperclip —
storage and reading are separate features on purpose.

None of this is tax or benefits advice. Check submissions against your plan documents.

## Layout

```
src/
  App.jsx            shell, state, all five views
  db.js              Dexie: ledger document + blob store
  lib/core.js        seed data, money/date helpers, workbook parser, tierMath
  lib/read-eob.js    Anthropic client, key handling, proxy support
  styles.css         one stylesheet, custom properties at the top
```

SheetJS is dynamically imported so it only loads when you import or export.

## Why there is no server

One person enters the data, on one computer. That removes sync, auth, multi-user permissions
and a hosted database from the problem entirely — and with them the recurring bill, the
row-level-security policies that fail silently, and the remote attack surface on a file full of
family medical history.

What it leaves is a single failure mode: this computer, or its browser storage, going away. So
that is the one thing engineered properly, in `src/lib/backup.js`. Point Setup at a folder
inside iCloud Drive, Dropbox or OneDrive and every change is mirrored there within seconds —
`ledger.json`, a `documents/` directory of the original EOB files, and a manifest tying them
together. Offsite, versioned by whatever cloud drive you already pay for, no infrastructure.

Requires the File System Access API, so Chrome or Edge on desktop. Safari has no
`showDirectoryPicker`, and falls back to manual downloads with a reminder. Directory handles
persist in IndexedDB but the permission grant can drop to `prompt` after a browser restart and
needs a user gesture to restore, which is what the reconnect button is for.

Restoring, or moving to a new machine, reads the same folder back including the documents.

## Worth doing next

- Per-claim HRA/HSA source tagging, for plans where pharmacy is reimbursed differently.
- A December service date sometimes belongs to the previous plan year's deductible. The `Counts
  toward` field on each claim handles it manually; a run-out-period rule would automate it.
- If a second person ever needs to enter claims, the write path is one function (`saveState` in
  `db.js`). Encrypt the ledger document client-side and push it as an opaque blob rather than
  modelling it in someone else's Postgres.
