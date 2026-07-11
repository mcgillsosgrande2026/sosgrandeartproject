import { getStore } from "@netlify/blobs";

// Wipes all submissions and registrations (and their uploaded artwork files),
// while leaving the editable contest content untouched. Used by the
// "Wipe test data" button in the organizer dashboard so organizers can
// clear out test entries before the real contest opens, without needing
// to touch the Netlify dashboard directly.
const SUBS_KEY = "woc_submissions";
const REGS_KEY = "woc_registrations";
const ADMIN_PASS = "sos!grande2027";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body = {};
  try {
    body = await req.json();
  } catch {
    // allow empty body
  }

  if (body.password !== ADMIN_PASS) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const dataStore = getStore("sosgrande-data");
  const artworkStore = getStore("sosgrande-artwork");

  const submissions = (await dataStore.get(SUBS_KEY, { type: "json" })) || [];
  const registrations = (await dataStore.get(REGS_KEY, { type: "json" })) || [];

  let deletedArtworkFiles = 0;
  for (const s of submissions) {
    if (s.artworkKey) {
      try {
        await artworkStore.delete(s.artworkKey);
        deletedArtworkFiles++;
      } catch {
        // best effort — continue wiping even if one file is already gone
      }
    }
  }

  await dataStore.setJSON(SUBS_KEY, []);
  await dataStore.setJSON(REGS_KEY, []);

  return new Response(
    JSON.stringify({
      ok: true,
      deletedSubmissions: submissions.length,
      deletedRegistrations: registrations.length,
      deletedArtworkFiles,
    }),
    { headers: { "Content-Type": "application/json" } }
  );
};
