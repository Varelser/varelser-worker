// Museum lane: fetch art/museum RSS/Atom feeds, pick up to 2 unposted
// candidates (same rules as the Muse-side collector), build Discord
// embeds, and post them IF a webhook URL is configured.
// - Feed list mirrors ~/workspace/goals/discord-museum collector (2026-11-09 verified set).
// - Item id = sha256(link) hex, first 20 chars (same scheme as collect.py),
//   so results can be cross-checked against the Muse-side seen.json.
// - Posting: only when env DISCORD_MUSEUM_WEBHOOK_URL is set. Otherwise the
//   run is a dry run and the would-be payloads are returned in the response.
// - Translation/summary by an LLM (which the Muse-side job does) is NOT
//   included here: titles/descriptions are the feeds' own text.

const crypto = require('crypto');

const FEEDS = [
  ["ART iT", "https://www.art-it.asia/feed", "ja", "news"],
  ["アートスケープ", "https://artscape.jp/feed/", "ja", "exhibition"],
  ["ARTnews Japan", "https://artnewsjapan.com/feed/", "ja", "news"],
  ["CINRA", "https://www.cinra.net/feed", "ja", "event"],
  ["IMA ONLINE", "https://imaonline.jp/feed/", "ja", "artist"],
  ["岡山芸術交流", "https://www.okayamaartsummit.jp/feed", "ja", "event"],
  ["大阪中之島美術館", "https://nakka-art.jp/feed", "ja", "museum"],
  ["京都市京セラ美術館", "https://kyotocity-kyocera.museum/feed", "ja", "museum"],
  ["Spoon & Tamago", "https://spoon-tamago.com/feed/", "en", "artist"],
  ["Hyperallergic", "https://hyperallergic.com/feed/", "en", "news"],
  ["Artnet News", "https://news.artnet.com/feed", "en", "news"],
  ["Artnet Market", "https://news.artnet.com/market/feed", "en", "news"],
  ["The Art Newspaper", "https://www.theartnewspaper.com/rss.xml", "en", "news"],
  ["ARTnews", "https://www.artnews.com/feed/", "en", "news"],
  ["Artsy News", "https://www.artsy.net/rss/news", "en", "news"],
  ["Art Asia Pacific", "https://artasiapacific.com/feed", "en", "news"],
  ["FAD Magazine", "https://fadmagazine.com/feed/", "en", "news"],
  ["Art History News", "https://arthistorynewsreport.blogspot.com/feeds/posts/default", "en", "news"],
  ["NYT Art and Design", "https://rss.nytimes.com/services/xml/rss/nyt/ArtandDesign.xml", "en", "news"],
  ["Guardian Art and Design", "https://www.theguardian.com/artanddesign/rss", "en", "news"],
  ["Dezeen", "https://www.dezeen.com/feed/", "en", "news"],
  ["Contemporary Art Daily", "https://contemporaryartdaily.com/feed/", "en", "exhibition"],
  ["Art Viewer", "https://artviewer.org/feed/", "en", "exhibition"],
  ["ArtPlugged", "https://artplugged.co.uk/feed/", "en", "exhibition"],
  ["Whitewall", "https://www.whitewall.art/feed", "en", "exhibition"],
  ["Designboom Art", "https://www.designboom.com/art/feed/", "en", "exhibition"],
  ["Colossal", "https://www.thisiscolossal.com/feed/", "en", "artist"],
  ["My Modern Met Art", "https://mymodernmet.com/category/art/feed/", "en", "artist"],
  ["BOOOOOOOM", "https://www.booooooom.com/feed/", "en", "artist"],
  ["IGNANT Art", "https://www.ignant.com/category/art/feed/", "en", "artist"],
  ["Juxtapoz", "https://www.juxtapoz.com/feed/", "en", "artist"],
  ["Hi-Fructose", "https://hifructose.com/feed/", "en", "artist"],
  ["DailyArt Magazine", "https://www.dailyartmagazine.com/feed/", "en", "artist"],
  ["Cultured Magazine", "https://www.culturedmag.com/feed/", "en", "artist"],
  ["Elephant Magazine", "https://elephant.art/feed/", "en", "artist"],
  ["Art People Gallery", "https://www.artpeoplegallery.com/feed/", "en", "artist"],
  ["The Art Post Blog", "https://theartpostblog.com/feed/", "en", "artist"],
  ["Sleek Magazine", "https://www.sleek-mag.com/feed/", "en", "artist"],
  ["1854 Photography", "https://www.1854.photography/feed/", "en", "artist"],
  ["Feature Shoot", "https://www.featureshoot.com/feed/", "en", "artist"],
  ["Guggenheim", "https://www.guggenheim.org/feed", "en", "museum"],
  ["LACMA Unframed", "https://unframed.lacma.org/feed", "en", "museum"],
  ["V&A Blog", "https://www.vam.ac.uk/blog/feed", "en", "museum"],
  ["Guardian Museums", "https://www.theguardian.com/culture/museums/rss", "en", "museum"],
  ["American Alliance of Museums", "https://www.aam-us.org/feed/", "en", "museum"],
  ["MuseumNext", "https://www.museumnext.com/feed/", "en", "museum"],
  ["Artforum", "https://www.artforum.com/feed", "en", "review"],
  ["ArtReview", "https://artreview.com/rss.xml", "en", "review"],
  ["Art in America", "https://www.artnews.com/art-in-america/feed/", "en", "review"],
  ["Mousse Magazine", "https://www.moussemagazine.it/feed/", "en", "review"],
  ["Flash Art", "https://flash---art.com/feed/", "en", "review"],
  ["Two Coats of Paint", "https://www.twocoatsofpaint.com/feed/", "en", "review"],
  ["Momus", "https://momus.ca/feed/", "en", "review"],
  ["LEAP Magazine", "https://www.leapleapleap.com/feed", "en", "review"],
  ["Venice Biennale", "https://www.labiennale.org/en/rss.xml", "en", "event"],
];

const CATEGORY_JA = {
  news: "ニュース", exhibition: "展覧会", museum: "美術館",
  artist: "作家・作品", event: "イベント", review: "批評・レビュー",
};
const CATEGORY_COLOR = {
  news: 0x3498DB, exhibition: 0x9B59B6, museum: 0xE67E22,
  artist: 0xE91E63, event: 0x27AE60, review: 0x95A5A6,
};

const POSTS_PER_RUN = 2;
const UA = { "user-agent": "Mozilla/5.0 (VarelserWorker/1.0)" };

// ---------- tiny XML helpers (RSS/Atom, tolerant) ----------
function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&");
}
function cleanText(raw, limit) {
  const t = decodeEntities(raw || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return t.slice(0, limit);
}
function tagText(block, names) {
  let best = "";
  for (const name of names) {
    const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i");
    const m = block.match(re);
    if (m && m[1].trim().length > best.length) best = m[1].trim();
  }
  return best;
}
function atomLink(block) {
  const links = [...block.matchAll(/<link(?:\s[^>]*)?>/gi)].map((m) => m[0]);
  for (const l of links) {
    const href = (l.match(/href="([^"]+)"/i) || [])[1];
    const rel = (l.match(/rel="([^"]+)"/i) || [])[1] || "alternate";
    if (href && rel === "alternate") return href;
  }
  const any = block.match(/<link(?:\s[^>]*)?href="([^"]+)"/i);
  return any ? any[1] : "";
}
function findImage(block, descHtml) {
  const thumb = block.match(/<(?:media:)?thumbnail[^>]*url="([^"]+)"/i);
  if (thumb) return thumb[1];
  const content = block.match(/<media:content[^>]*url="([^"]+)"/i);
  if (content) return content[1];
  const enc = block.match(/<enclosure[^>]*url="([^"]+)"/i);
  if (enc) return enc[1];
  const img = (descHtml || "").match(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/i);
  return img ? img[1] : "";
}

async function fetchFeed([name, url, lang, cat]) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { headers: UA, signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) return { name, items: [], error: `HTTP ${res.status}` };
    const xml = await res.text();
    const blocks = [
      ...(xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || []),
      ...(xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || []),
    ];
    const items = [];
    for (const b of blocks) {
      const title = cleanText(tagText(b, ["title"]), 300);
      let link = cleanText(tagText(b, ["link"]), 1000);
      if (!link.startsWith("http")) link = atomLink(b);
      const descRaw = tagText(b, ["content:encoded", "description", "summary", "content"]);
      const dateS = tagText(b, ["pubDate", "published", "updated", "dc:date"]);
      const ts = dateS ? Date.parse(decodeEntities(dateS)) : NaN;
      if (!title || !link) continue;
      items.push({
        id: crypto.createHash("sha256").update(link).digest("hex").slice(0, 20),
        title,
        link,
        desc: cleanText(descRaw, 900),
        date: Number.isNaN(ts) ? "" : new Date(ts).toISOString(),
        image: findImage(b, decodeEntities(descRaw)),
        source: name, lang, category: cat,
        category_ja: CATEGORY_JA[cat] || cat,
      });
    }
    return { name, items, error: null };
  } catch (e) {
    return { name, items: [], error: String(e && e.message ? e.message : e) };
  } finally {
    clearTimeout(timer);
  }
}

function pickCandidates(allItems, excludeIds, n) {
  const pool = allItems.filter((it) => !excludeIds.has(it.id));
  const now = Date.now();
  const FRESH_MS = 45 * 24 * 3600 * 1000;
  const ts = (it) => (it.date ? Date.parse(it.date) : 0);
  const fresh = pool.filter((it) => !it.date || ts(it) >= now - FRESH_MS).sort((a, b) => ts(b) - ts(a));
  const freshSet = new Set(fresh);
  const backlog = pool.filter((it) => !freshSet.has(it)).sort((a, b) => ts(b) - ts(a));
  const ordered = [...fresh, ...backlog];
  const picked = [], usedSources = new Set(), usedIds = new Set();
  for (const it of ordered) {
    if (picked.length >= n) break;
    if (!usedSources.has(it.source) && !usedIds.has(it.id)) {
      picked.push(it); usedSources.add(it.source); usedIds.add(it.id);
    }
  }
  for (const it of ordered) {
    if (picked.length >= n) break;
    if (!usedIds.has(it.id)) { picked.push(it); usedIds.add(it.id); }
  }
  return picked;
}

function buildEmbed(item) {
  const embed = {
    title: item.title.slice(0, 256),
    url: item.link,
    description: item.desc ? item.desc.slice(0, 400) : undefined,
    color: CATEGORY_COLOR[item.category] || 0x95A5A6,
    footer: { text: `${item.source} ・ ${item.category_ja}` },
  };
  if (item.date) embed.timestamp = item.date;
  if (item.image) embed.image = { url: item.image };
  return embed;
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// postedIds: in-memory set owned by server.js (per-process dedupe when posting)
// excludeIds: ids the caller already posted elsewhere (e.g. the Muse-side
// cron passes its recent seen ids in the /run request body, so this worker
// never re-picks something the existing job already posted).
async function runMuseum(postedIds, excludeIds = []) {
  const t0 = Date.now();
  const results = await mapPool(FEEDS, 8, fetchFeed);
  const feedErrors = results.filter((r) => r.error).map((r) => ({ source: r.name, error: r.error }));
  const allItems = results.flatMap((r) => r.items);
  const exclude = new Set([...postedIds, ...excludeIds]);
  const picked = pickCandidates(allItems, exclude, POSTS_PER_RUN);
  const webhook = process.env.DISCORD_MUSEUM_WEBHOOK_URL || "";
  const payloads = picked.map((item) => ({
    id: item.id,
    item: { title: item.title, link: item.link, source: item.source, category_ja: item.category_ja, date: item.date },
    payload: { username: "Auto Museum", embeds: [buildEmbed(item)] },
  }));

  let posted = 0;
  if (webhook && payloads.length) {
    for (const p of payloads) {
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(p.payload),
      });
      if (res.status === 200 || res.status === 204) {
        posted++;
        postedIds.add(p.id);
      } else {
        p.postError = `HTTP ${res.status}`;
      }
    }
  }

  return {
    job: "museum",
    mode: webhook ? "post" : "dry-run",
    note: webhook
      ? "posted to Discord via webhook"
      : "DISCORD_MUSEUM_WEBHOOK_URL is not set: nothing was posted; payloads are returned for review",
    feedsTotal: FEEDS.length,
    feedsFailed: feedErrors.length,
    feedErrors: feedErrors.slice(0, 10),
    itemsFetched: allItems.length,
    picked: payloads.length,
    posted,
    payloads,
    durationMs: Date.now() - t0,
  };
}

module.exports = { runMuseum, FEEDS };
