# Ontology Cube

Interactive 3D map of the knowledge graph behind
[travelmemo.com](https://travelmemo.com) and [reisememo.ch](https://reisememo.ch).
Every box is one entity from the ontology both blogs share: a place, a topic,
an organization, a trip or an author.

**Live:** https://webmemo-code.github.io/travel-ontology-visualization/

![Inside the globe](docs/globe-inside.jpg)

## Three views

**⬡ How it works.** The entities pack into a literal cube: the ontology, the
single source of truth. Stacked above it are the two WordPress sites, the five
generated outputs (JSON-LD, taxonomies, EntityMap, llms.txt, OKF) and the
groups that read them. Click any tile for a plain-language explanation.

![How it works](docs/how-it-works.jpg)

**◍ Globe.** The cube unfolds into a wireframe globe. It opens from outside,
with Switzerland facing you; fly inside to see the places hanging on their shells.

| Encoding | Meaning |
|---|---|
| Tile on the skin | One article (turquoise EN, violet DE); brightness = relative search tier |
| Country patch | A country's articles as one patch of tiles, **sized by article count, not area**; gold lines trace true borders |
| Gold lines | True country borders (Natural Earth) on the same globe, so you can see how far the article-sized patches stretch Switzerland |
| Boxes inside | Places on shells by level: continents nearest you, sights nearest the skin |
| Directions | Patches grow around each country's real direction from Switzerland; neighbours settle on Switzerland's rim |
| Sky / floor | Topics form the ceiling, organizations the floor, the authors' faces the zenith |
| Purple tubes | Trips, drawn stop by stop in itinerary order |
| Halo / outline | Top 10% or top 25% search performer / orphan with no article yet |
| Select | An entity lights its articles in gold (dim amber where filed under another country), with rays out to each; an article draws rays to its entities |

![The globe from outside](docs/globe-outside.jpg)

**⇄ EN ↔ DE.** Travelmemo and Reisememo as facing walls, with each entity in
the same slot on both. Cyan bridges mark subjects both blogs cover. Amber
bridges fade toward the blog that has not written about the subject yet: the
translation and content backlog.

![Mirror](docs/mirror.jpg)

**● Live** (globe view, or `?live` in the URL) polls each blog's
`/wp-json/webmemo-schema/v1/live` route every minute. Readers of the last 30 minutes glow at their country, with a
flowing arc to the article they read (GA4 Realtime). AI agents are
satellites coloured by purpose (training, search, on a user's behalf): each
hovers over its operator's headquarters, drops a thin line to the country its
request came from (Cloudflare on travelmemo, IPinfo Lite on reisememo), and beams to the article or entity it fetched. Bots whose operator
is not known for certain keep orbiting. Agents on article pages are not
seen, because the page cache serves those without PHP. `?live=demo` feeds
made-up traffic for previews and recordings.

The data is **relative by design**: no raw clicks, impressions or search queries
are shipped, so the build is safe to publish. The live layer shows presence
only: the route sends no counts.

## Run locally

Only needed to develop it; the live site needs nothing installed.

```bash
pnpm install
pnpm dev            # http://localhost:5173
pnpm build          # static site in dist/ (relative paths, host anywhere)
```

`?debug` exposes `window.cube` (the scene) and `window.pick(key)` for scripting
camera positions; `cube.getCamera()` prints a keyframe for [src/tour.ts](src/tour.ts).

## Data sources

- `public/graph.json`: a snapshot of the ontology and each article's entities,
  with search performance as relative tiers only (top 10% / top 25% / active /
  seen). The schema is in [src/data/types.ts](src/data/types.ts).
- Country borders: [world-atlas](https://github.com/topojson/world-atlas) 50m, from Natural Earth (public domain)
- Portraits in `public/faces/`: the authors' Reisememo profile photos
- `public/atlas/articles.jpg` + `.json`: every article's featured-image thumbnail
  in 64 px cells (one ~0.9 MB request). Tiles show the photo only within the
  nearest sixth of the visible depth, so wide views stay calm.
- `public/identity/`: country flags (Wikidata P41), Swiss canton coats of arms
  (P94) and organization logos (P154) from Wikimedia Commons, with licence and
  author in `credits.json` (shown under "Image credits"). The two blog logos
  are the blogs' own.

Images and data are refreshed with the scripts in [scripts/](scripts/), each
documented at the top of its file.

## Lifted from the Periodic Cube of AI

From the [Periodic Cube of AI](https://webmemo.ch/periodic-cube-of-ai):
`src/three/bloomComposer.ts` (verbatim except one `let` → `const` for lint), the camera keyframe shape and cubic
easing, the billboard-label look and the `mj-2.jpg` backdrop. Keep them in sync
by hand until they move into a shared package.
