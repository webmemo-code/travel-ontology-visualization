// Explanations for the tiles of the System view (scene 1). Keyed by the
// `sys:*` userData keys set in three/system.ts.

export interface SystemInfo {
  title: string;
  text: string;
  links?: { label: string; url: string }[];
}

const both = (path: string) => [
  { label: `travelmemo.com${path}`, url: `https://travelmemo.com${path}` },
  { label: `reisememo.ch${path}`, url: `https://reisememo.ch${path}` },
];

export const SYSTEM_INFO: Record<string, SystemInfo> = {
  'sys:site:travelmemo': {
    title: 'Travelmemo (English)',
    text: 'The WordPress blog for English-speaking travellers. Each article is tagged with the ontology entities it is about. A script suggests the tags and a human approves them before they are written to the post.',
    links: [{ label: 'travelmemo.com', url: 'https://travelmemo.com' }],
  },
  'sys:site:reisememo': {
    title: 'Reisememo (German)',
    text: 'The German-language sister blog. It uses the same ontology, so "Zürich" on Reisememo and "Zurich" on Travelmemo are provably the same place, with labels in each language.',
    links: [{ label: 'reisememo.ch', url: 'https://reisememo.ch' }],
  },
  'sys:jsonld': {
    title: 'Schema.org JSON-LD',
    text: 'Every article carries a structured-data graph: the article, its author, and every place, topic and company it is about. Each one points to Wikidata, so search engines know exactly which "Swiss" or which "Andaz" we mean. It travels inside each HTML page and is never fetched on its own, so its cylinder stays thin.',
  },
  'sys:taxonomy': {
    title: 'WordPress taxonomies',
    text: 'Ontology entities are mirrored into WordPress as terms, generated from the YAML and never edited by hand. This keeps the CMS and the knowledge map in lock-step.',
  },
  'sys:entitymap': {
    title: 'EntityMap',
    text: 'A machine-readable index of every entity on the site, with typed relations and evidence passages from real articles. It is built for AI systems that look things up by entity rather than by keyword.',
    links: both('/entitymap.json'),
  },
  'sys:llmstxt': {
    title: 'llms.txt',
    text: 'A table of contents for language models: one root file plus one file per destination, each listing the articles in clean Markdown form.',
    links: both('/llms.txt'),
  },
  'sys:okf': {
    title: 'Open Knowledge Format bundle',
    text: 'Each article is also published as a Markdown document, filed in a folder tree by destination and need (for example schweiz/hiking/). Its front matter names the entities, photos and verification events.',
    links: both('/okf/'),
  },
  'sys:google': {
    title: 'Google Search',
    text: 'Reads the JSON-LD for rich results and entity understanding. The Wikidata links let Google tie our articles to its own Knowledge Graph.',
  },
  'sys:ai-training': {
    title: 'AI training',
    text: 'Crawlers that collect text to train language models (GPTBot, ClaudeBot, Common Crawl and others). They send no travelers back, but they read the most: llms.txt, the OKF bundle and the articles. What they learn decides how models describe our destinations later.',
  },
  'sys:ai-search': {
    title: 'AI search',
    text: 'Crawlers from ChatGPT, Perplexity and others fetch llms.txt, the EntityMap and the knowledge bundle. The plugin counts their visits, grouped into training, search and user-triggered fetches.',
  },
  'sys:assistants': {
    title: 'AI assistants',
    text: 'When someone asks an assistant about hiking near Zermatt, clean entities and self-contained passages make our articles easy to cite accurately.',
  },
  'sys:travelers': {
    title: 'Travelers',
    text: 'People planning a trip. The same structure powers what they see: destination pages, related articles, and links between the English and German versions of a story. Sphere sizes compare monthly volume on a log scale: travelers (GA4 users), Google (search clicks) and AI fetches. AI fetches are counted before the cache, every article page included.',
  },
  'sys:html': {
    title: 'HTML pages',
    text: 'The articles themselves, as people and search engines see them. Each output is a cylinder: its height compares item counts, its width how often AI crawlers fetched it in the last 30 days, both on a log scale.',
  },
  'sys:photos': {
    title: 'Photos',
    text: 'The photos in the media library, each counted once: the resized versions WordPress makes of a photo are the same image. Captions, keywords and credits travel with them into the OKF bundle.',
  },
};
