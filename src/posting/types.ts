export type Platform = "instagram" | "facebook" | "threads";
export const PLATFORMS: Platform[] = ["instagram", "facebook", "threads"];

export type AccountStatus = "ready" | "not_ready" | "reconnect_needed";

export type AccountRow = {
  id: string;
  platform: Platform;
  handle: string;
  external_id: string;
  status: AccountStatus;
  reason: string | null;
  token_expires_at: string | null;
};

export type PostStatus = "scheduled" | "posting" | "posted" | "failed" | "cancelled";

export type PostRow = {
  id: string;
  source_kind: "draft" | "carousel";
  source_id: string;
  account_id: string;
  platform: Platform;
  caption: string;
  image_paths: string[];
  scheduled_for: string;
  status: PostStatus;
  external_id: string | null;
  permalink: string | null;
  error: string | null;
  attempts: number;
  claimed_at: string | null;
  posted_at: string | null;
  created_at: string;
};

/** A Graph or Threads API call. GET puts params in the query, POST sends them as a form. */
export type Http = (
  url: string,
  opts?: { method?: "GET" | "POST"; params?: Record<string, string> },
) => Promise<Record<string, unknown>>;

export type PublishInput = {
  externalAccountId: string;
  token: string;
  caption: string;
  imageUrls: string[];
};

export type PublishResult = { externalId: string; permalink: string | null };

export type Publisher = (input: PublishInput, http: Http) => Promise<PublishResult>;
