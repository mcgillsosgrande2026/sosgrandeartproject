import { getStore } from "@netlify/blobs";

// Deletes a single submission (and its uploaded artwork file) by id.
// Requires the admin password, checked server-side, so the endpoint itself
// is protected even though the admin UI is already gated behind login.
// Also clears the matching registration's `hasSubmitted` flag, if found,
// so the student isn't permanently locked out of resubmitting.
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
    // allow empty body — will fail validation below
  }

  if (body.password !== ADMIN_PASS) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { id } = body;
  if (!id) {
    return new Response(JSON.stringify({ error: "id is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const dataStore = getStore("sosgrande-data");
  const artworkStore = getStore("sosgrande-artwork");

  const submissions = (await dataStore.get(SUBS_KEY, { type: "json" })) || [];
  const target = submissions.find((s) => s.id === id);

  if (!target) {
    return new Response(JSON.stringify({ error: "not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (target.artworkKey) {
    try {
      await artworkStore.delete(target.artworkKey);
    } catch {
      // best effort — still remove the submission record even if the
      // artwork file was already gone
    }
  }

  const remaining = submissions.filter((s) => s.id !== id);
  await dataStore.setJSON(SUBS_KEY, remaining);

  // Let the student submit again if their registration is still on file.
  if (target.regId) {
    const registrations = (await dataStore.get(REGS_KEY, { type: "json" })) || [];
    const updatedRegs = registrations.map((r) => (r.id === target.regId ? { ...r, hasSubmitted: false } : r));
    await dataStore.setJSON(REGS_KEY, updatedRegs);
  }

  return new Response(JSON.stringify({ ok: true, deletedId: id }), {
    headers: { "Content-Type": "application/json" },
  });
};
