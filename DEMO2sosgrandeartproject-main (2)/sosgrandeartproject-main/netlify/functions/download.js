import { getStore } from "@netlify/blobs";

// Streams a previously uploaded artwork file back to the organizer,
// with the original filename and content type.
export default async (req) => {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  if (!key) {
    return new Response("key is required", { status: 400 });
  }

  const store = getStore("sosgrande-artwork");
  const result = await store.getWithMetadata(key, { type: "arrayBuffer" });

  if (!result) {
    return new Response("Not found", { status: 404 });
  }

  const { data, metadata } = result;
  const filename = metadata?.filename || key;
  const contentType = metadata?.contentType || "application/octet-stream";

  return new Response(data, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
    },
  });
};
