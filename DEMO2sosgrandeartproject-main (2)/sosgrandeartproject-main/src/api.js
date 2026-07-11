// ─── Client helpers that talk to the Netlify Functions backend ───────────────
// These replace the Claude-artifact-only `window.storage` API with real,
// persistent storage (Netlify Blobs) so the app works once deployed.

const BASE = "/.netlify/functions";

export async function sGet(key) {
  try {
    const res = await fetch(`${BASE}/data?key=${encodeURIComponent(key)}`);
    if (!res.ok) return null;
    const json = await res.json();
    return json.value ?? null;
  } catch {
    return null;
  }
}

export async function sSet(key, value) {
  try {
    await fetch(`${BASE}/data`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
  } catch {
    // best-effort; UI already reflects optimistic state
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Shrinks large photos (e.g. straight-off-a-phone-camera images, which can
// easily be 5-12MB) down to a manageable size before upload, so submissions
// never silently fail due to upload size limits. Caps the longest edge at
// 2200px and re-encodes as a JPEG at 90% quality — sharp enough for jury
// review, dashboard previews, and even printed use, while keeping file
// sizes safely small. Falls back to the original file untouched if
// anything goes wrong (e.g. unsupported browser), so this can never make
// things worse.
function resizeImageForUpload(file, maxDim = 2200, quality = 0.9) {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/")) return resolve(file);
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width <= maxDim && height <= maxDim) return resolve(file); // already small enough
      if (width > height) {
        height = Math.round((height * maxDim) / width);
        width = maxDim;
      } else {
        width = Math.round((width * maxDim) / height);
        height = maxDim;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob) return resolve(file); // fall back to original on failure
          const newName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
          resolve(new File([blob], newName, { type: "image/jpeg" }));
        },
        "image/jpeg",
        quality
      );
    };
    img.onerror = () => resolve(file); // fall back to original on failure
    img.src = url;
  });
}

// Uploads the actual artwork file to Netlify Blobs and returns a blob key
// that can be stored on the submission record and used to download it later.
export async function uploadArtwork(file) {
  const uploadFile = await resizeImageForUpload(file);
  const data = await fileToBase64(uploadFile);
  const res = await fetch(`${BASE}/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: uploadFile.name,
      contentType: uploadFile.type || "application/octet-stream",
      data,
    }),
  });
  if (!res.ok) throw new Error("Upload failed");
  const json = await res.json();
  return json.key;
}

export function downloadUrl(key) {
  return `${BASE}/download?key=${encodeURIComponent(key)}`;
}

// Wipes all submissions/registrations (and their artwork files) via the
// wipe Netlify Function. Requires the admin password as a second check
// (the UI is already gated behind the admin login, this just guards the
// endpoint itself). Returns counts of what was deleted, or throws.
export async function wipeTestData(password) {
  const res = await fetch(`${BASE}/wipe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) throw new Error("Wipe failed");
  return res.json();
}

// Deletes a single submission (and its uploaded artwork file) via the
// delete-submission Netlify Function. Requires the admin password as a
// second check, the same pattern used by wipeTestData above.
export async function deleteSubmission(id, password) {
  const res = await fetch(`${BASE}/delete-submission`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, password }),
  });
  if (!res.ok) throw new Error("Delete failed");
  return res.json();
}
