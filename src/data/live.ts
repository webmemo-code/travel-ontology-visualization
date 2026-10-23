// Live layer data: who is reading what right now, from each blog's public
// /wp-json/webmemo-schema/v1/live route.
// Presence only: the route never sends counts, and neither does this module.
import { alpha2ToNumeric } from 'i18n-iso-countries';
import { geoCentroid } from 'd3-geo';
import type { Atlas } from './atlas';
import type { Graph, SiteKey as Site } from './types';

export type BotTier = 'training' | 'search' | 'user' | 'other';

// Crawler tiers: training, search, or fetching on a user's behalf.
const TIERS: Record<string, BotTier> = {
  gptbot: 'training',
  claudebot: 'training',
  ccbot: 'training',
  bytespider: 'training',
  'google-extended': 'training',
  'applebot-extended': 'training',
  'meta-externalagent': 'training',
  'cohere-ai': 'training',
  'oai-searchbot': 'search',
  'claude-searchbot': 'search',
  perplexitybot: 'search',
  amazonbot: 'search',
  duckassistbot: 'search',
  diffbot: 'search',
  'chatgpt-user': 'user',
  'claude-user': 'user',
  'perplexity-user': 'user',
  'meta-externalfetcher': 'user',
  'mistralai-user': 'user',
};
export const tierOf = (bot: string): BotTier => TIERS[bot] ?? 'other';

const BOT_NAMES: Record<string, string> = {
  gptbot: 'GPTBot',
  'chatgpt-user': 'ChatGPT',
  'oai-searchbot': 'OAI-SearchBot',
  claudebot: 'ClaudeBot',
  'claude-user': 'Claude',
  'claude-searchbot': 'Claude-SearchBot',
  perplexitybot: 'PerplexityBot',
  'perplexity-user': 'Perplexity',
  'google-extended': 'Google-Extended',
  'applebot-extended': 'Applebot-Extended',
  'meta-externalagent': 'Meta',
  'meta-externalfetcher': 'Meta',
  ccbot: 'Common Crawl',
  bytespider: 'Bytespider',
  amazonbot: 'Amazonbot',
  duckassistbot: 'DuckAssistBot',
  diffbot: 'Diffbot',
  'cohere-ai': 'Cohere',
  'mistralai-user': 'Mistral',
};
export const botName = (bot: string) => BOT_NAMES[bot] ?? bot;

export interface Operator {
  name: string;
  /** Headquarters, [lat, lon]. */
  hq: [number, number];
}

// Who runs each crawler, and where that company is headquartered. Bots whose
// operator we cannot state with confidence (Common Crawl, Diffbot) are left
// out: they keep orbiting rather than sit over a guessed city.
const OPERATORS: Record<string, Operator> = {
  openai: { name: 'OpenAI', hq: [37.77, -122.42] }, // San Francisco
  anthropic: { name: 'Anthropic', hq: [37.79, -122.4] }, // San Francisco
  perplexity: { name: 'Perplexity', hq: [37.78, -122.39] }, // San Francisco
  google: { name: 'Google', hq: [37.42, -122.08] }, // Mountain View
  apple: { name: 'Apple', hq: [37.33, -122.03] }, // Cupertino
  meta: { name: 'Meta', hq: [37.48, -122.15] }, // Menlo Park
  amazon: { name: 'Amazon', hq: [47.62, -122.34] }, // Seattle
  bytedance: { name: 'ByteDance', hq: [39.98, 116.31] }, // Beijing
  mistral: { name: 'Mistral AI', hq: [48.87, 2.33] }, // Paris
  cohere: { name: 'Cohere', hq: [43.65, -79.38] }, // Toronto
  duckduckgo: { name: 'DuckDuckGo', hq: [40.04, -75.49] }, // Paoli, Pennsylvania
};
const BOT_OPERATOR: Record<string, keyof typeof OPERATORS> = {
  gptbot: 'openai',
  'chatgpt-user': 'openai',
  'oai-searchbot': 'openai',
  claudebot: 'anthropic',
  'claude-user': 'anthropic',
  'claude-searchbot': 'anthropic',
  perplexitybot: 'perplexity',
  'perplexity-user': 'perplexity',
  'google-extended': 'google',
  'applebot-extended': 'apple',
  'meta-externalagent': 'meta',
  'meta-externalfetcher': 'meta',
  amazonbot: 'amazon',
  bytespider: 'bytedance',
  'mistralai-user': 'mistral',
  'cohere-ai': 'cohere',
  duckassistbot: 'duckduckgo',
};
/** Operator key and record, or null when unknown. */
export function operatorOf(bot: string): [string, Operator] | null {
  const key = BOT_OPERATOR[bot];
  return key ? [key, OPERATORS[key]] : null;
}


export interface LiveReader {
  country: string; // ISO 3166-1 alpha-2
  city: string;
  post: number | null;
}

export interface LiveBot {
  bot: string;
  route: string;
  kind: 'post' | 'entity' | 'index';
  post?: number | null;
  entity?: string;
  seconds_ago: number;
  /** ISO alpha-2 of where the request came from, when the blog knows (plugin >= 1.22.0). */
  country?: string;
}

export interface LiveSnapshot {
  generated: string;
  window_minutes: number;
  readers_status: 'ok' | 'not-configured' | 'error';
  readers: LiveReader[];
  bots: LiveBot[];
}

export type LiveBySite = Partial<Record<Site, LiveSnapshot>>;

const HOSTS: Record<Site, string> = { travelmemo: 'https://travelmemo.com', reisememo: 'https://reisememo.ch' };

/** Both blogs' snapshots; a blog whose route is missing or down is simply absent. */
export async function fetchLive(): Promise<LiveBySite> {
  const out: LiveBySite = {};
  await Promise.all(
    (Object.keys(HOSTS) as Site[]).map(async (site) => {
      try {
        const r = await fetch(`${HOSTS[site]}/wp-json/webmemo-schema/v1/live`, { cache: 'no-store' });
        if (r.ok) out[site] = (await r.json()) as LiveSnapshot;
      } catch {
        // offline or not deployed yet: the layer just shows nothing for this blog
      }
    }),
  );
  return out;
}

/**
 * Made-up but plausible traffic for previews and recordings (?live=demo):
 * readers mostly from the DACH region on reisememo, more spread on travelmemo.
 */
export function demoLive(graph: Graph, seed = Date.now()): LiveBySite {
  let s = seed % 2147483647 || 1;
  const rnd = () => (s = (s * 48271) % 2147483647) / 2147483647;
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const countries: Record<Site, [string, string][]> = {
    reisememo: [['CH', 'Zurich'], ['CH', 'Bern'], ['CH', 'Basel'], ['DE', 'Munich'], ['DE', 'Berlin'], ['AT', 'Vienna'], ['CH', 'Lucerne']],
    travelmemo: [['US', 'New York'], ['US', 'San Francisco'], ['GB', 'London'], ['CA', 'Toronto'], ['AU', 'Sydney'], ['IN', 'Mumbai'], ['DE', 'Hamburg'], ['SG', 'Singapore']],
  };
  const entities = graph.nodes.filter((n) => n.class === 'places' || n.class === 'topics').map((n) => n.key);
  const out: LiveBySite = {};
  for (const site of ['travelmemo', 'reisememo'] as Site[]) {
    const posts = graph.posts.filter((p) => p.site === site);
    out[site] = {
      generated: new Date().toISOString(),
      window_minutes: 30,
      readers_status: 'ok',
      readers: Array.from({ length: site === 'reisememo' ? 14 : 10 }, () => {
        const [country, city] = pick(countries[site]);
        return { country, city, post: rnd() < 0.9 ? pick(posts).id : null };
      }),
      bots: Array.from({ length: 4 }, () => {
        const bot = pick(Object.keys(TIERS));
        const entity = rnd() < 0.3;
        // Crawlers mostly run in US cloud regions, some in Europe and Asia.
        const country = pick(['US', 'US', 'US', 'IE', 'DE', 'SG', 'NL']);
        return entity
          ? { bot, route: 'ontology', kind: 'entity' as const, entity: pick(entities), seconds_ago: Math.floor(rnd() * 1800), country }
          : { bot, route: 'okf', kind: 'post' as const, post: pick(posts).id, seconds_ago: Math.floor(rnd() * 1800), country };
      }),
    };
  }
  return out;
}

/** [lat, lon] of a country's centroid, by ISO alpha-2 code; null when the atlas lacks it. */
export function countryCentre(atlas: Atlas, alpha2: string): [number, number] | null {
  const numeric = alpha2ToNumeric(alpha2);
  const f = numeric ? atlas.features.find((x) => String(x.id) === numeric) : undefined;
  if (!f) return null;
  const [lon, lat] = geoCentroid(f);
  return [lat, lon];
}
