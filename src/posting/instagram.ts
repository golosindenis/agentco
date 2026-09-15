import { GRAPH_BASE } from "./graph.js";
import type { Http, Publisher } from "./types.js";

async function waitFinished(http: Http, id: string, token: string, sleep: (ms: number) => Promise<void>, tries: number) {
  for (let i = 0; i < tries; i++) {
    const r = await http(`${GRAPH_BASE}/${id}`, { params: { fields: "status_code,status", access_token: token } });
    if (r.status_code === "FINISHED") return;
    if (r.status_code === "ERROR" || r.status_code === "EXPIRED") {
      throw new Error(`Instagram could not process the media: ${String(r.status ?? r.status_code)}`);
    }
    await sleep(3000);
  }
  throw new Error(`Instagram was still processing the media after ${tries} checks`);
}

export function makeInstagramPublisher(
  opts: { sleep?: (ms: number) => Promise<void>; tries?: number } = {},
): Publisher {
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const tries = opts.tries ?? 20;
  return async ({ externalAccountId: ig, token, caption, imageUrls }, http) => {
    if (imageUrls.length === 0) throw new Error("Instagram needs an image");
    let container: string;
    if (imageUrls.length === 1) {
      const r = await http(`${GRAPH_BASE}/${ig}/media`, { method: "POST", params: { image_url: imageUrls[0]!, caption, access_token: token } });
      container = String(r.id);
    } else {
      const children: string[] = [];
      for (const url of imageUrls) {
        const r = await http(`${GRAPH_BASE}/${ig}/media`, { method: "POST", params: { image_url: url, is_carousel_item: "true", access_token: token } });
        children.push(String(r.id));
      }
      const r = await http(`${GRAPH_BASE}/${ig}/media`, {
        method: "POST", params: { media_type: "CAROUSEL", children: children.join(","), caption, access_token: token },
      });
      container = String(r.id);
    }
    await waitFinished(http, container, token, sleep, tries);
    const published = await http(`${GRAPH_BASE}/${ig}/media_publish`, { method: "POST", params: { creation_id: container, access_token: token } });
    const mediaId = String(published.id);
    const link = await http(`${GRAPH_BASE}/${mediaId}`, { params: { fields: "permalink", access_token: token } });
    return { externalId: mediaId, permalink: (link.permalink as string | undefined) ?? null };
  };
}

export const publishInstagram = makeInstagramPublisher();
