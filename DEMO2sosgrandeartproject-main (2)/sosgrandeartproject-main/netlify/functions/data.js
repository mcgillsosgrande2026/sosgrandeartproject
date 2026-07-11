import { getStore } from "@netlify/blobs";

// Generic JSON key-value storage backing the app's content, registrations,
// and submissions. Mirrors the shape of the old `window.storage` helper.
export default async (req) => {
  const store = getStore("sosgrande-data");
  const url = new URL(req.url);

  if (req.method === "GET") {
    const key = url.searchParams.get("key");
    if (!key) {
      return new Response(JSON.stringify({ error: "key is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const value = await store.get(key, { type: "json" });
    return new Response(JSON.stringify({ value: value ?? null }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "invalid JSON body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const { key, value } = body;
    if (!key) {
      return new Response(JSON.stringify({ error: "key is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    await store.setJSON(key, value);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response("Method not allowed", { status: 405 });
};
