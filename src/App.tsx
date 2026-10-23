import { useEffect, useMemo, useRef, useState } from 'react';
import { GraphScene, type View } from './three/GraphScene';
import { SYSTEM_INFO } from './systemInfo';
import { TOUR } from './tour';
import { postKey } from './data/globe';
import { bridgeCounts } from './data/mirror';
import { loadAtlas, type Atlas } from './data/atlas';
import { demoLive, fetchLive, type LiveBySite } from './data/live';
import { READER_COLOR, TIER_COLORS } from './three/live';
import { CLASS_COLORS, CLASS_NAMES, cooccurring, descendants, labelFor, placeTree, postsFor, slugTitle, statsFor } from './data/model';
import type { Graph, GraphNode, GraphPost, Perf, SiteMode } from './data/types';

const PERF_TEXT: Record<Perf, string> = {
  top10: 'Top 10% in search',
  top25: 'Top 25% in search',
  active: 'Gets clicks',
  seen: 'Shown, not yet clicked',
  none: 'No search data',
};
const STATUS_TEXT: Record<string, string> = {
  hub: 'Hub: 5+ articles in its branch',
  covered: 'Covered',
  thin: 'Thin: 1-2 articles',
  orphan: 'Orphan: no article yet',
};
const MODES: { key: SiteMode; label: string }[] = [
  { key: 'both', label: 'Both' },
  { key: 'travelmemo', label: 'Travelmemo EN' },
  { key: 'reisememo', label: 'Reisememo DE' },
];
const VIEWS: { key: View; label: string }[] = [
  { key: 'system', label: '⬡ How it works' },
  { key: 'graph', label: '◍ Globe' },
  { key: 'mirror', label: '⇄ EN ↔ DE' },
];
const SITE_NAME = { travelmemo: 'Travelmemo', reisememo: 'Reisememo' };

interface Credit {
  image: string;
  kind?: string;
  file: string;
  license: string;
  artist: string | null;
  source: string;
}

export default function App() {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch('graph.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`graph.json: HTTP ${r.status}`))))
      .then(setGraph)
      .catch((e: Error) => setError(e.message));
  }, []);
  if (error) return <div className="splash">Could not load the graph: {error}</div>;
  if (!graph) return <div className="splash">Loading the ontology…</div>;
  return <Viewer graph={graph} />;
}

function Viewer({ graph }: { graph: Graph }) {
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<GraphScene | null>(null);
  const [mode, setMode] = useState<SiteMode>('both');
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<{ key: string; x: number; y: number } | null>(null);
  const [query, setQuery] = useState('');
  const [tourStep, setTourStep] = useState<number | null>(null);
  const [view, setView] = useState<View>('graph');
  // Read by the tour effect without re-running it when the stop itself changes the view.
  const viewRef = useRef(view);
  viewRef.current = view;
  const byKey = useMemo(() => new Map(graph.nodes.map((n) => [n.key, n])), [graph]);
  const posts = useMemo(() => new Map(graph.posts.map((p) => [postKey(p), p])), [graph]);
  const bridges = useMemo(() => bridgeCounts(graph), [graph]);
  const [atlas, setAtlas] = useState<Atlas | null>(null);
  const [photoSrc, setPhotoSrc] = useState<Record<string, string>>({});
  const [credits, setCredits] = useState<Record<string, Credit>>({});
  const [showCredits, setShowCredits] = useState(false);
  // ?live turns the layer on at load; ?live=demo feeds it made-up traffic (previews, recordings).
  const liveParam = new URLSearchParams(location.search).get('live');
  const [live, setLive] = useState(liveParam !== null);
  const [liveState, setLiveState] = useState<LiveBySite | null>(null);
  useEffect(() => {
    fetch('atlas/articles.json')
      .then((r) => r.json())
      .then((a) => setPhotoSrc(a.src ?? {}))
      .catch(() => {});
    fetch('identity/credits.json')
      .then((r) => r.json())
      .then(setCredits)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const scene = new GraphScene(host.current!, graph, {
      onHover: (key, x, y) => setHover(key ? { key, x, y } : null),
      onSelect: (key) => {
        setTourStep(null);
        setSelected(key);
      },
    });
    sceneRef.current = scene;
    // Borders are a 750 KB asset: the globe works without them, so load after.
    loadAtlas(graph)
      .then((a) => {
        setAtlas(a);
        scene.setAtlas(a);
      })
      .catch((e) => console.warn('atlas:', e));
    if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { cube: scene, pick: setSelected });
    return () => scene.dispose();
  }, [graph]);

  useEffect(() => {
    sceneRef.current?.setMode(mode);
  }, [mode]);
  useEffect(() => {
    if (!live) {
      sceneRef.current?.setLive(null);
      setLiveState(null);
      return;
    }
    let stop = false;
    const load = async () => {
      const data = liveParam === 'demo' ? demoLive(graph) : await fetchLive();
      if (stop) return;
      setLiveState(data);
      sceneRef.current?.setLive(data);
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [live, graph, liveParam]);
  useEffect(() => {
    sceneRef.current?.setView(view);
  }, [view]);
  useEffect(() => {
    if (tourStep === null) sceneRef.current?.select(selected);
  }, [selected, tourStep]);
  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sceneRef.current?.setFilter(null);
    const hits = graph.nodes.filter((n) => `${n.label.en} ${n.label.de} ${n.id}`.toLowerCase().includes(q));
    sceneRef.current?.setFilter(new Set(hits.map((n) => n.key)));
  }, [query, graph]);

  useEffect(() => {
    if (tourStep === null) return;
    const stop = TOUR[tourStep];
    const scene = sceneRef.current!;
    const stopView = stop.view ?? 'graph';
    const changing = stopView !== viewRef.current;
    setView(stopView);
    scene.setView(stopView);
    setSelected(stop.select ?? null);
    // A view change flies the camera itself; let it land before the stop's own move.
    const id = setTimeout(
      () => {
        scene.select(stop.select ?? null, !stop.camera);
        if (stop.camera) scene.flyTo(stop.camera, 2000);
      },
      changing ? 2300 : 0,
    );
    return () => clearTimeout(id);
  }, [tourStep]);

  const totals = useMemo(() => {
    const nodes = graph.nodes.filter((n) => statsFor(n, mode));
    return {
      entities: nodes.length,
      posts: postsFor(graph, mode).length,
      hubs: nodes.filter((n) => statsFor(n, mode)!.status === 'hub').length,
      orphans: nodes.filter((n) => statsFor(n, mode)!.status === 'orphan').length,
    };
  }, [graph, mode]);

  const node = selected ? byKey.get(selected) ?? null : null;
  const post = selected ? posts.get(selected) ?? null : null;
  const info = selected ? SYSTEM_INFO[selected] : undefined;
  const hoverNode = hover ? byKey.get(hover.key) : undefined;
  const hoverPost = hover ? posts.get(hover.key) : undefined;
  const hoverInfo = hover ? SYSTEM_INFO[hover.key] : undefined;

  return (
    <div className="app">
      <div ref={host} className="stage" />

      <header className="hud top-left">
        <h1>
          Ontology <span>Memo</span>
        </h1>
        <p className="sub">The knowledge map behind Travelmemo &amp; Reisememo</p>
        <div className="stats">
          <Stat n={totals.entities} label="entities" />
          <Stat n={totals.posts} label="articles" />
          <Stat n={totals.hubs} label="hubs" />
          <Stat n={totals.orphans} label="orphans" />
        </div>
        <div className="seg">
          {VIEWS.map((v) => (
            <button key={v.key} className={view === v.key ? 'on' : ''} onClick={() => setView(v.key)}>
              {v.label}
            </button>
          ))}
        </div>
        {view === 'graph' && (
          <div className="seg">
            {MODES.map((m) => (
              <button key={m.key} className={mode === m.key ? 'on' : ''} onClick={() => setMode(m.key)}>
                {m.label}
              </button>
            ))}
          </div>
        )}
        {view === 'graph' && (
          <div className="row live-row">
            <button className={live ? 'on' : ''} onClick={() => setLive(!live)} aria-pressed={live}>
              <span className="live-dot" /> Live
            </button>
            {live && <span className="live-status">{liveLabel(liveState)}</span>}
          </div>
        )}
        <input className="search" placeholder="Search: Zermatt, hiking, Aman…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search entities" />
        <div className="row">
          <button className="primary" onClick={() => setTourStep(0)}>
            ▶ Guided tour
          </button>
          <button
            onClick={() => {
              setTourStep(null);
              setSelected(null);
              setQuery('');
            }}
          >
            Reset view
          </button>
        </div>
      </header>

      <aside className="hud bottom-left legend">
        {view === 'mirror' ? (
          <>
            <div>
              <i className="bar" style={{ background: '#4FC3F7' }} /> {bridges.shared} on both blogs
            </div>
            <div>
              <i className="bar" style={{ background: 'linear-gradient(90deg,#FFB300,#1a1a1a)' }} /> {bridges['only-en']} only in English
            </div>
            <div>
              <i className="bar" style={{ background: 'linear-gradient(90deg,#1a1a1a,#FFB300)' }} /> {bridges['only-de']} only in German
            </div>
            <p>Same slot on both walls. Amber bridges are stories one blog tells and the other does not yet.</p>
          </>
        ) : (
          <>
            {Object.entries(CLASS_NAMES).map(([k, name]) => (
              <div key={k}>
                <i style={{ background: CLASS_COLORS[k] }} /> {name}
              </div>
            ))}
            {view === 'graph' && live && (
              <div className="live-legend">
                <div>
                  <span>
                    <i style={{ background: READER_COLOR, borderRadius: '50%', color: READER_COLOR }} /> Reader now, by country, with a line to the article
                  </span>
                </div>
                <div>
                  {(
                    [
                      ['training', 'AI training'],
                      ['search', 'AI search'],
                      ['user', "AI on a user's behalf"],
                    ] as const
                  ).map(([tier, text]) => (
                    <span key={tier}>
                      <i className="diamond" style={{ borderColor: TIER_COLORS[tier] }} /> {text}
                    </span>
                  ))}
                </div>
                <p>AI agents hover over the company that runs them; a thin line drops to the country the request came from.</p>
              </div>
            )}
            {view === 'graph' ? (
              <p>
                Each tile is an article (<b style={{ color: '#26C6DA' }}>EN</b> / <b style={{ color: '#B388FF' }}>DE</b>). Countries are patches sized by
                our articles, not their area; gold lines trace true borders, brighter where we write. Places hang inside. Halo = top
                search performer · outline = no article yet.
              </p>
            ) : (
              <p>Size = articles · Halo = top search performer · Outline = no article yet</p>
            )}
          </>
        )}
        <button className="linkish credits-link" onClick={() => setShowCredits(!showCredits)}>
          Image credits
        </button>
      </aside>

      {showCredits && (
        <aside className="hud credits">
          <div className="row">
            <h2>Image credits</h2>
            <button onClick={() => setShowCredits(false)} aria-label="Close credits">
              ✕
            </button>
          </div>
          <p>
            Article photos: from the articles on travelmemo.com and reisememo.ch. Flags, coats of arms and logos: Wikimedia Commons via each
            entity's Wikidata record.
          </p>
          <ul>
            {Object.entries(credits)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, c]) => (
                <li key={key}>
                  <img src={c.image} alt="" />
                  <span>
                    <b>{byKey.get(key) ? labelFor(byKey.get(key)!, 'travelmemo') : key}</b>{' '}
                    <a href={c.source} target="_blank" rel="noreferrer">
                      {c.file}
                    </a>
                    {' · '}
                    {c.license}
                    {c.artist ? ` · ${c.artist}` : ''}
                  </span>
                </li>
              ))}
          </ul>
        </aside>
      )}

      {tourStep === null && node && <Details node={node} graph={graph} mode={mode} byKey={byKey} onPick={setSelected} atlas={atlas} />}
      {tourStep === null && post && <Article post={post} byKey={byKey} onPick={setSelected} photo={photoSrc[selected!]} />}
      {tourStep === null && info && (
        <aside className="hud details">
          <small style={{ color: '#FF8F00' }}>System layer</small>
          <h2>{info.title}</h2>
          <p className="lead">{info.text}</p>
          {info.links?.map((l) => (
            <p key={l.url}>
              <a className="ext" href={l.url} target="_blank" rel="noreferrer">
                {l.label} ↗
              </a>
            </p>
          ))}
        </aside>
      )}

      {tourStep !== null && (
        <div className="hud tour">
          <small>
            {tourStep + 1} / {TOUR.length}
          </small>
          <h2>{TOUR[tourStep].title}</h2>
          <p>{TOUR[tourStep].text}</p>
          <div className="row">
            <button disabled={tourStep === 0} onClick={() => setTourStep(tourStep - 1)}>
              ← Back
            </button>
            {tourStep < TOUR.length - 1 ? (
              <button className="primary" onClick={() => setTourStep(tourStep + 1)}>
                Next →
              </button>
            ) : (
              <button className="primary" onClick={() => setTourStep(null)}>
                Explore yourself
              </button>
            )}
            <button onClick={() => setTourStep(null)} aria-label="Close tour">
              ✕
            </button>
          </div>
        </div>
      )}

      {hover && (hoverNode || hoverPost || hoverInfo) && (
        <div className="tip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          {hoverNode && (
            <>
              <b>{labelFor(hoverNode, mode)}</b>
              <span>
                {hoverNode.type} · {statsFor(hoverNode, mode)?.posts ?? 0} articles
              </span>
            </>
          )}
          {hoverPost && (
            <>
              <b>{slugTitle(hoverPost.url)}</b>
              <span>
                {SITE_NAME[hoverPost.site]} · {PERF_TEXT[hoverPost.perf]}
              </span>
            </>
          )}
          {hoverInfo && <b>{hoverInfo.title}</b>}
        </div>
      )}
    </div>
  );
}

/** Which blogs answered; never how many readers (the public view shows no counts). */
function liveLabel(data: LiveBySite | null): string {
  if (!data) return 'connecting…';
  const sites = Object.keys(data);
  if (!sites.length) return 'offline';
  const readers = Object.values(data).some((d) => d?.readers_status === 'ok');
  return `last 30 min · ${sites.length === 2 ? 'both blogs' : sites[0]}${readers ? '' : ' · AI agents only'}`;
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <b>{n.toLocaleString('en')}</b>
      <span>{label}</span>
    </div>
  );
}

function chipFor(n: GraphNode, label: string, onPick: (key: string) => void) {
  return (
    <button key={n.key} className="chip" style={{ borderColor: CLASS_COLORS[n.class] }} onClick={() => onPick(n.key)}>
      {label}
    </button>
  );
}

function Article({ post, byKey, onPick, photo }: { post: GraphPost; byKey: Map<string, GraphNode>; onPick: (key: string) => void; photo?: string }) {
  const entities = post.entities.map((k) => byKey.get(k)).filter(Boolean) as GraphNode[];
  return (
    <aside className="hud details">
      {photo && <img className="hero" src={photo} alt="" loading="lazy" />}
      <small style={{ color: post.site === 'reisememo' ? '#B388FF' : '#26C6DA' }}>Article · {SITE_NAME[post.site]}</small>
      <h2>{slugTitle(post.url)}</h2>
      <div className="badges">
        <span className={`perf ${post.perf}`}>{PERF_TEXT[post.perf]}</span>
        {post.cluster !== '_unclustered' && <span>need: {post.cluster}</span>}
      </div>
      <p>
        <a className="ext" href={post.url} target="_blank" rel="noreferrer">
          Read the article ↗
        </a>
      </p>
      <section>
        <h3>Tagged with ({entities.length})</h3>
        {entities.map((n) => chipFor(n, labelFor(n, post.site), onPick))}
      </section>
    </aside>
  );
}

function Details({
  node,
  graph,
  mode,
  byKey,
  onPick,
  atlas,
}: {
  node: GraphNode;
  graph: Graph;
  mode: SiteMode;
  byKey: Map<string, GraphNode>;
  onPick: (key: string) => void;
  atlas: Atlas | null;
}) {
  // Land vs article share is an editorial-skew metric for us, not a story for readers: internal (?debug) only.
  const land = new URLSearchParams(location.search).has('debug') ? atlas?.landShare.get(node.key) : undefined;
  const under = descendants(placeTree(graph), node.key);
  const all = postsFor(graph, mode);
  const share = all.length ? all.filter((p) => p.entities.some((e) => under.has(e))).length / all.length : 0;
  const pct = (x: number) => (x >= 0.1 ? `${Math.round(x * 100)}%` : x >= 0.001 ? `${(x * 100).toFixed(1)}%` : `${(x * 100).toFixed(2)}%`);
  const scoped = postsFor(graph, mode).filter((p) => p.entities.includes(node.key));
  const rank = { top10: 0, top25: 1, active: 2, seen: 3, none: 4 };
  scoped.sort((a, b) => rank[a.perf] - rank[b.perf] || b.id - a.id);
  const parents = graph.edges.filter((e) => e.from === node.key && e.rel === 'parent').map((e) => byKey.get(e.to)!);
  const route = (node.route ?? []).map((k) => byKey.get(k)!).filter(Boolean);
  const children = graph.edges.filter((e) => e.to === node.key && e.rel === 'parent').map((e) => byKey.get(e.from)!);
  const co = cooccurring(postsFor(graph, mode), node.key, 8);
  const chip = (n: GraphNode) => chipFor(n, labelFor(n, mode), onPick);

  return (
    <aside className="hud details">
      <small style={{ color: CLASS_COLORS[node.class] }}>
        {CLASS_NAMES[node.class] ?? node.class} · {node.type}
      </small>
      <h2>{labelFor(node, mode)}</h2>
      {node.label.de !== node.label.en && <p className="alt">{mode === 'reisememo' ? node.label.en : node.label.de}</p>}
      <div className="badges">
        {node.wikidata && (
          <a href={`https://www.wikidata.org/wiki/${node.wikidata}`} target="_blank" rel="noreferrer">
            Wikidata {node.wikidata}
          </a>
        )}
        <span>source: ontology/{node.source}/</span>
      </div>

      {land !== undefined && (
        <div className="ratio">
          <div>
            <b>{pct(land)}</b>
            <span>of the world's land</span>
          </div>
          <div>
            <b>{pct(share)}</b>
            <span>of our articles</span>
          </div>
        </div>
      )}

      <table>
        <tbody>
          {graph.sites.map((s) => {
            const st = node.sites[s.key];
            return (
              <tr key={s.key}>
                <th>{s.name}</th>
                <td>{st ? `${st.posts} articles` : 'n/a'}</td>
                <td>{st ? STATUS_TEXT[st.status] : ''}</td>
                <td>{st ? PERF_TEXT[st.perf] : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {parents.length > 0 && (
        <section>
          <h3>Part of</h3>
          {parents.map(chip)}
        </section>
      )}
      {route.length > 0 && (
        <section>
          <h3>Route</h3>
          {route.map(chip)}
        </section>
      )}
      {children.length > 0 && (
        <section>
          <h3>Contains ({children.length})</h3>
          {children.slice(0, 24).map(chip)}
        </section>
      )}
      {co.length > 0 && (
        <section>
          <h3>Often written about together</h3>
          {co.map(([k]) => chip(byKey.get(k)!))}
        </section>
      )}
      <section>
        <h3>Articles ({scoped.length})</h3>
        <ul className="posts">
          {scoped.slice(0, 30).map((p) => (
            <li key={`${p.site}-${p.id}`}>
              <button className="linkish" onClick={() => onPick(postKey(p))}>
                {slugTitle(p.url)}
              </button>
              <span className={`perf ${p.perf}`}>{p.site === 'reisememo' ? 'DE' : 'EN'}</span>
              {p.cluster !== '_unclustered' && <span className="cluster">{p.cluster}</span>}
            </li>
          ))}
        </ul>
        {scoped.length > 30 && <p className="more">+ {scoped.length - 30} more</p>}
      </section>
    </aside>
  );
}
