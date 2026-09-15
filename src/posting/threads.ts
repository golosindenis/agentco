import { THREADS_BASE } from "./graph.js";
import type { Publisher } from "./types.js";

export const publishThreads: Publisher = async ({ externalAccountId: user, token, caption, imageUrls }, http) => {
  let container: string;
  if (imageUrls.length === 0) {
    const r = await http(`${THREADS_BASE}/${user}/threads`, { method: "POST", params: { media_type: "TEXT", text: caption, access_token: token } });
    container = String(r.id);
  } else if (imageUrls.length === 1) {
    const r = await http(`${THREADS_BASE}/${user}/threads`, {
      method: "POST", params: { media_type: "IMAGE", image_url: imageUrls[0]!, text: caption, access_token: token },
    });
    container = String(r.id);
  } else {
    const children: string[] = [];
    for (const url of imageUrls) {
      const r = await http(`${THREADS_BASE}/${user}/threads`, {
        method: "POST", params: { media_type: "IMAGE", image_url: url, is_carousel_item: "true", access_token: token },
      });
      children.push(String(r.id));
    }
    const r = await http(`${THREADS_BASE}/${user}/threads`, {
      method: "POST", params: { media_type: "CAROUSEL", children: children.join(","), text: caption, access_token: token },
    });
    container = String(r.id);
  }
  const published = await http(`${THREADS_BASE}/${user}/threads_publish`, { method: "POST", params: { creation_id: container, access_token: token } });
  const id = String(published.id);
  const link = await http(`${THREADS_BASE}/${id}`, { params: { fields: "permalink", access_token: token } });
  return { externalId: id, permalink: (link.permalink as string | null | undefined) ?? null };
};
