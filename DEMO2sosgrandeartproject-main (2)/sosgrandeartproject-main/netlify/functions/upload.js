import { getStore } from "@netlify/blobs";

// Stores the actual uploaded artwork file (base64-encoded by the client)
// in Netlify Blobs and returns a key that can be saved on the submission
// record for later retrieval.
export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { filename, contentType, data } = body;
  if (!data) {
    return new Response(JSON.stringify({ error: "data is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const safeName = (filename || "artwork").replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;

  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));

  const store = getStore("sosgrande-artwork");
  await store.set(key, bytes, {
    metadata: {
      filename: filename || key,
      contentType: contentType || "application/octet-stream",
    },
  });

  return new Response(JSON.stringify({ key }), {
    headers: { "Content-Type": "application/json" },
  });
};
