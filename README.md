```markdown
# Waves of Change — SOS Grande contest app

A bilingual (English/Spanish) web app for running SOS Grande's "Waves of
Change" mural art contest for high school students in Playa Grande, Costa
Rica. It has two halves:

- **Student portal** — where students read the contest guidelines, register,
  and submit their artwork.
- **Organizer (admin) dashboard** — where SOS Grande staff review
  submissions, manage registrations, edit all the contest copy, control
  whether the contest is open, and export data — all without touching code.

It's a single-page React app (Vite) with a small serverless backend
(Netlify Functions + Netlify Blobs for storage), designed to be run and
maintained by non-technical staff after handoff.

---

## How it's organized

```
├── src/
│   ├── App.jsx           # the entire UI: student portal + admin panel
│   ├── i18n.js            # all interface text (EN/ES) + default contest content
│   ├── LangContext.jsx    # current-language state, persisted to localStorage
│   ├── api.js             # client-side helpers that call the Netlify Functions
│   └── main.jsx           # React entry point
├── netlify/functions/
│   ├── data.js               # generic get/set for JSON data (content, registrations, submissions)
│   ├── upload.js              # stores an uploaded artwork image
│   ├── download.js            # streams a stored artwork image back
│   ├── delete-submission.js   # deletes one submission (+ its artwork), password-protected
│   └── wipe.js                 # deletes ALL submissions & registrations, password-protected
├── netlify.toml            # build config + SPA redirect rule
└── package.json
```

Everything the student and admin see lives in `App.jsx`. It's one large file
organized top-to-bottom as: shared UI primitives → student portal →
admin login → admin panel (submissions / registrations / content editor /
settings) → root component that ties it together. Look for the `═══` banner
comments to jump between sections.

---

## Data model

There's no traditional database — everything is stored as JSON under a few
keys in **Netlify Blobs** (via `netlify/functions/data.js`), plus a separate
blob store for the actual artwork image files.

| Key | Shape | What it is |
|---|---|---|
| `woc_content` | `{ en: {...}, es: {...} }` | All editable contest copy (name, dates, rules, prize text, etc.), one object per language. Defaults live in `i18n.js` as `DEFAULT_CONTENT`. |
| `woc_registrations` | `[{ id, firstname, lastname, email, school, grade, teammates, registeredAt, hasSubmitted }]` | One entry per student who's signed up. |
| `woc_submissions` | `[{ id, regId, ...student info, statement, filename, artworkKey, status, submittedAt }]` | One entry per submitted artwork. `status` is one of `new / reviewed / shortlisted / rejected`. `artworkKey` points into the artwork blob store. |
| `woc_contest_status` | `{ status: "open" \| "not_open" \| "closed", closedMessage: { en, es } }` | Whether students can currently register, and the message shown to them if not. Defaults live in `i18n.js` as `DEFAULT_STATUS`. |

Artwork image files are stored separately in a `sosgrande-artwork` Blob
store, keyed by an opaque string (`artworkKey`) generated at upload time.
`download.js` streams a file back given that key; `delete-submission.js` and
`wipe.js` clean the file up when a submission is removed.

The client never talks to Netlify Blobs directly — everything goes through
`src/api.js`, which wraps `fetch()` calls to the functions above (`sGet` /
`sSet` for JSON data, `uploadArtwork` / `downloadUrl` for files).

---

## Student portal

Three pages, navigated via local component state (`page`) in `StudentPortal`
— there's no router, since it's a small linear flow:

1. **Contest info (`home`)** — hero, key dates, prize, theme, eligibility,
   and artwork requirements, all pulled from the editable content object.
   The status badge at the top reflects the current contest status.
2. **Sign up (`register`)** — collects name, email, school, grade, and
   optional teammates. Registering with an email that's already on file
   reuses the existing registration instead of duplicating it. A "find me"
   lookup lets a student who registered on a different device retrieve
   their registration by email.
3. **Submit (`submit`)** — artist statement (100–200 words, validated live),
   artwork file upload, and two consent checkboxes. Requires an active
   registration; blocks a second submission per registration with a
   friendly "already submitted" message instead of a hard error.

**Contest status gating:** every entry point that leads to the registration
page (nav tab, hero button, bottom-of-page CTA, and the "sign up first"
prompt on the submit page) routes through a single `goToRegister()` function
in `StudentPortal`. If the admin has set the contest to `not_open` or
`closed`, this shows a popup with the admin-editable message instead of
navigating — so the gating logic only needs to be enforced in one place.

**Session persistence:** once a student registers, their registration is
cached in `localStorage` (`sosg_student_session`) so refreshing the page or
coming back later doesn't lose their spot. This is purely a device-local
convenience — the source of truth is the registration record on the server.

**Image handling:** before upload, `api.js` resizes large photos client-side
(longest edge capped at 2200px, re-encoded as JPEG) so a full-resolution
phone photo doesn't fail on upload size limits. If resizing fails for any
reason, the original file is uploaded unchanged.

---

## Admin dashboard

Reached via the "🔒 Organizer portal" switch at the top of the page, gated
by a single shared password (`ADMIN_PASS`, currently `sos!grande2027`,
hardcoded near the top of `App.jsx`). There's no per-user login — it's one
password for anyone on the SOS Grande team.

Four tabs, all inside `AdminPanel`:

- **Submissions** — search/filter by status, expand a row to see the full
  statement and an inline artwork preview, change status
  (new/reviewed/shortlisted/rejected), download the original artwork file,
  export the filtered list to CSV, or delete a submission entirely (see
  below). Deleting a submission also resets that student's `hasSubmitted`
  flag, so they're able to submit again rather than being permanently
  locked out.
- **Registrations** — read-only list of everyone who's signed up, with CSV
  export.
- **Edit content** — a form for every piece of editable contest copy
  (hero text, dates, prize, theme, rules, contact info), with its own
  independent EN/ES toggle so an organizer can edit both language versions
  regardless of which language they're currently browsing the site in.
  Saving writes the whole `woc_content` object back in one call.
- **Settings** — contest status control (Open / Not open yet / Submissions
  closed, plus the bilingual message shown to students when it isn't open)
  and the "danger zone" wipe tool.

**Deleting a single submission** requires re-entering the admin password in
a confirmation modal, even though the dashboard itself is already
password-gated — this is a deliberate second checkpoint against accidental
clicks, mirroring the pattern already used for the full data wipe. The
password check happens server-side in `delete-submission.js`, not just in
the UI.

**Wiping test data** (Settings tab) permanently deletes *all* submissions
and registrations (and their artwork files) in one action. It requires the
admin password plus typing `DELETE` to confirm, and never touches contest
content or the contest status setting. Useful for clearing out test entries
right before the real contest opens.

---

## Translations & content

All interface strings live in `src/i18n.js` under `UI.en` / `UI.es`, looked
up via the `t(key)` function from `useLang()` (see `LangContext.jsx`).
Editable contest content (as opposed to fixed interface labels) is a
separate object — `DEFAULT_CONTENT` in the same file — since it's meant to
be changed by organizers through the admin UI, not by editing code.

To add a new piece of UI text: add the key to both `UI.en` and `UI.es`, then
reference it with `t("your_key")`. To add a new piece of admin-editable
content: add a field to both `DEFAULT_CONTENT_EN` and `DEFAULT_CONTENT_ES`,
then add a corresponding input to `ContentEditor` in `App.jsx`.

The current language is stored in `localStorage` (`LangContext.jsx`) and
defaults to the browser's language if it's Spanish, English otherwise.

---

## Local development

```bash
npm install
netlify dev
```

Use `netlify dev`, not plain `vite dev` — it runs the Netlify Functions
locally alongside the Vite dev server, so registration, submission, file
upload/download, and the admin actions all work exactly as they will in
production. Plain `vite dev` will load the UI but every backend call will
fail.

## Deploying

The app is designed for Netlify (Netlify Blobs, used for all storage, is a
Netlify-specific feature — porting to another host would mean swapping the
storage layer in `netlify/functions/`).

Simplest path: connect this repo to Netlify (**Add new site → Import an
existing project**). Netlify reads `netlify.toml` automatically:
- Build command: `npm run build`
- Publish directory: `dist`
- Functions directory: `netlify/functions`

No environment variables are required — Netlify Blobs works out of the box
on any Netlify site that has functions enabled.

## Things worth knowing before handing this off

- **The admin password is hardcoded**, not an environment variable. It
  appears in three places and must be changed in all of them together:
  `ADMIN_PASS` in `src/App.jsx`, and the same constant in
  `netlify/functions/wipe.js` and `netlify/functions/delete-submission.js`.
- **There's no per-admin login or audit log** — anyone with the password has
  full access to every destructive action (status changes, deletions, wipe).
  This is intentional for a small, trusted organizing team, but wouldn't
  scale to a larger or less trusted group without adding real auth.
- **All destructive server-side actions re-check the password themselves**
  (delete-submission, wipe) rather than trusting the client — so the admin
  UI being password-gated isn't the only thing standing between a stray
  request and data loss.
```
