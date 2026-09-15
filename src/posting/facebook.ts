import { GRAPH_BASE } from "./graph.js";
import type { Publisher } from "./types.js";

export const publishFacebook: Publisher = async ({ externalAccountId: page, token, caption, imageUrls }, http) => {
  let postId: string;
  if (imageUrls.length === 0) {
    const r = await http(`${GRAPH_BASE}/${page}/feed`, { method: "POST", params: { message: caption, access_token: token } });
    postId = String(r.id);
  } else if (imageUrls.length === 1) {
    const r = await http(`${GRAPH_BASE}/${page}/photos`, { method: "POST", params: { url: imageUrls[0]!, caption, access_token: token } });
    postId = String(r.post_id ?? r.id);
  } else {
    const ids: string[] = [];
    for (const url of imageUrls) {
      const r = await http(`${GRAPH_BASE}/${page}/photos`, { method: "POST", params: { url, published: "false", access_token: token } });
      ids.push(String(r.id));
    }
    const params: Record<string, string> = { message: caption, access_token: token };
    ids.forEach((id, i) => { params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id }); });
    const r = await http(`${GRAPH_BASE}/${page}/feed`, { method: "POST", params });
    postId = String(r.id);
  }
  const link = await http(`${GRAPH_BASE}/${postId}`, { params: { fields: "permalink_url", access_token: token } });
  return { externalId: postId, permalink: (link.permalink_url as string | undefined) ?? null };
};
