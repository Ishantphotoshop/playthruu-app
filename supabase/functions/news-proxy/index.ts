// NEWS PROXY — merges a handful of gaming-news RSS feeds into one JSON
// feed for the app's News tab.
//
// Why this exists: none of these publishers send CORS headers on their
// RSS feeds, so a browser calling them directly from a live domain (not
// localhost) gets silently blocked. Doing the fetch here, server-side,
// sidesteps that. Unlike igdb-proxy, no secret or API key is needed at
// all — every feed below is public RSS, so there's nothing to sign up
// for and nothing to store as a Supabase secret.
//
// One-time setup: supabase functions deploy news-proxy

import { XMLParser } from "npm:fast-xml-parser@4.3.6";

const FEEDS = [
  { source: "IGN", url: "https://feeds.ign.com/ign/games-all" },
  { source: "GameSpot", url: "https://www.gamespot.com/feeds/news/" },
  { source: "Eurogamer", url: "https://www.eurogamer.net/feed" },
  { source: "PC Gamer", url: "https://www.pcgamer.com/rss/" },
  { source: "Kotaku", url: "https://kotaku.com/rss" },
];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

// These are daily-news outlets, not live tickers — refetching all 5 feeds
// on every single app open would just be wasted work for content that
// hasn't changed. Cached in memory and reused for 10 minutes.
const CACHE_MS = 10 * 60 * 1000;
let cache: { at: number; articles: unknown[] } | null = null;

function stripHtml(html: unknown): string {
  return String(html ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function firstImage(item: any): string {
  const media = item["media:content"] || item["media:thumbnail"];
  const fromMedia = Array.isArray(media) ? media[0] : media;
  if (fromMedia?.["@_url"]) return fromMedia["@_url"];
  const enclosure = item.enclosure;
  if (enclosure?.["@_url"] && String(enclosure["@_type"] || "").startsWith("image")) return enclosure["@_url"];
  const html = String(item["content:encoded"] ?? item.description ?? "");
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : "";
}

async function fetchFeed(source: string, url: string) {
  const res = await fetch(url, { headers: { "User-Agent": "PlayThruuNewsBot/1.0" } });
  if (!res.ok) throw new Error(`${source} feed failed (${res.status})`);
  const xml = await res.text();
  const data = parser.parse(xml);
  const rawItems = data?.rss?.channel?.item ?? data?.feed?.entry ?? [];
  const items = Array.isArray(rawItems) ? rawItems : [rawItems];
  return items
    .map((item: any) => ({
      title: stripHtml(item.title?.["#text"] ?? item.title),
      link: item.link?.["@_href"] ?? item.link ?? "",
      source,
      pubDate: item.pubDate ?? item.published ?? item.updated ?? "",
      summary: stripHtml(item.description ?? item.summary).slice(0, 200),
      image: firstImage(item),
    }))
    .filter((a) => a.title && a.link);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  if (cache && Date.now() - cache.at < CACHE_MS) {
    return new Response(JSON.stringify({ articles: cache.articles }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const results = await Promise.allSettled(FEEDS.map((f) => fetchFeed(f.source, f.url)));
  const articles = results
    .filter((r): r is PromiseFulfilledResult<any[]> => r.status === "fulfilled")
    .flatMap((r) => r.value)
    .sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime())
    .slice(0, 60);

  // Only cache when at least one feed actually came back — a single
  // outlet's blip shouldn't cost the other four their results, but a
  // total outage shouldn't get remembered for 10 minutes either.
  if (articles.length) cache = { at: Date.now(), articles };

  return new Response(JSON.stringify({ articles }), {
    status: articles.length ? 200 : 502,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
