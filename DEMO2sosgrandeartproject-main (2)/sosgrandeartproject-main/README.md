# Waves of Change — SOS Grande contest app

A student registration/submission portal + organizer admin dashboard for the
"Waves of Change" mural contest, available in English and Spanish.

## What changed from the original artifact

The original file used `window.storage`, which only works inside a Claude.ai
artifact preview. This version is a real deployable app:

- **Storage** — `window.storage` calls are replaced with Netlify Functions
  (`netlify/functions/data.js`, `upload.js`, `download.js`, `wipe.js`) backed
  by **Netlify Blobs**, Netlify's built-in key-value/file store. No external
  database needed.
- **File uploads** — previously only the filename/size was recorded. Now the
  actual artwork image is uploaded and stored, and organizers can click
  "Download artwork" in the admin panel to get the real file, or view an
  inline preview without leaving the dashboard.
- **Language toggle** — an EN/ES switch appears in the top nav on both the
  student portal and admin panel. All interface text and all
  admin-editable contest content (name, dates, rules, prize copy, etc.) are
  fully translatable. Content is stored as `{ en: {...}, es: {...} }`, and
  the content editor has its own EN/ES tab so organizers can edit either
  language regardless of which language they're currently viewing the site
  in.

## Added on top of that

- **Wipe test data** — a "Settings" tab in the organizer dashboard lets you
  permanently delete all submissions and registrations (and their uploaded
  artwork files) in one click, so you can clear out test entries before the
  real contest opens. It requires the admin password plus typing `DELETE`
  to confirm, and never touches the contest content/settings.
- **CSV export** — "Export CSV" buttons on the Submissions and Registrations
  tabs let a non-technical organizer download the current (filtered) list
  and open it straight in Excel or Google Sheets.
- **Inline artwork preview** — expanding a submission in the admin panel now
  shows the artwork image directly, not just a download link.
- **Student session persistence** — a student's registration is now
  remembered on their device (via `localStorage`), so refreshing the page or
  coming back later doesn't lose their spot and force a duplicate
  registration. The nav bar shows who's signed in with a "Not you?" reset
  link.
- **Duplicate protection** — registering twice with the same email reuses
  the existing registration instead of creating a second one, and a
  "Already registered on another device?" lookup lets a student find their
  registration by email if their session was lost (e.g. different device
  or cleared browser data). Submitting artwork twice for the same
  registration is blocked with a friendly "already submitted" message.

## Project structure

```
├── src/
│   ├── App.jsx           # the whole app (student portal + admin panel)
│   ├── i18n.js            # English/Spanish UI text + default content
│   ├── LangContext.jsx    # language state, persisted to localStorage
│   ├── api.js             # client helpers that call the Netlify Functions
│   └── main.jsx
├── netlify/functions/
│   ├── data.js             # GET/SET for content, registrations, submissions
│   ├── upload.js           # stores an uploaded artwork file
│   ├── download.js         # streams an artwork file back for download
│   └── wipe.js              # deletes all submissions/registrations + artwork
├── netlify.toml
└── package.json
```

## Deploying to Netlify

**Option A — drag & drop (fastest, no git needed)**
1. Run `npm install` then `npm run build` locally (or ask me to hand you the
   built files).
2. Go to [app.netlify.com/drop](https://app.netlify.com/drop) and drag the
   whole project **folder** in — Netlify needs the source + `netlify.toml`
   to build the functions, not just the `dist` folder.

**Option B — connect a Git repo (recommended, gets you auto-deploys)**
1. Push this folder to a new GitHub (or GitLab/Bitbucket) repository.
2. In Netlify: **Add new site → Import an existing project**, pick the repo.
3. Netlify will read `netlify.toml` automatically:
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Functions directory: `netlify/functions`
4. Click **Deploy**. No environment variables or extra setup are required —
   Netlify Blobs works automatically on any Netlify site with functions.

**Option C — Netlify CLI**
```bash
npm install -g netlify-cli
netlify login
netlify init      # links this folder to a new or existing Netlify site
netlify deploy --prod
```

## Local development

```bash
npm install
netlify dev
```
`netlify dev` (not plain `vite dev`) is important — it runs the Netlify
Functions locally alongside the Vite dev server so storage/upload/download
work the same way they will in production.

## To note before launch

- **Admin password** is currently hardcoded as `sos!grande2027` in `App.jsx`
  (`ADMIN_PASS`) and mirrored in `netlify/functions/wipe.js`. 
- **Data reset**: use the "Settings" tab in the organizer dashboard to wipe
  all test submissions/registrations (and their artwork files) before the
  real contest opens — no need to touch the Netlify dashboard directly.
