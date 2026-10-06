import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { apiPost } from './api';
import { detectWithTmr } from './tmrDetector';
import './upgrade.css';
import {
  ArrowRight,
  Activity,
  BarChart3,
  BookOpen,
  BrainCircuit,
  CheckCircle2,
  Copy,
  Gauge,
  GitCompareArrows,
  Home,
  Info,
  Menu,
  Quote,
  ShieldCheck,
  Sparkles,
  Target,
  WandSparkles,
  X,
  Zap,
} from 'lucide-react';
import {
  Profile,
  REFERENCE_PROFILE,
  localStylometryScore,
  profile,
  referenceStatus,
  reliability,
  wordList,
} from './textAnalysis';

type Page = 'home' | 'detect' | 'naturalize' | 'compare' | 'method';

type Detection = {
  score: number;
  classification: string;
  confidence: string;
  summary: string;
  mode: string;
  components: { tmr?: number | null; context: number | null; style: number | null; stylometry: number; patternScore?: number | null };
  agreement: number | null;
  uncertainty: number;
  reasons: string[];
};

type NaturalizeResult = {
  text: string;
  passes: number;
  beforeDistance: number;
  afterDistance: number;
  lexicalRetention: number;
  meaningCheck: string;
  anchorPreservation: number;
  voiceMatched: boolean;
  variationMode: string;
  microImperfections: string[];
  critique: string;
  changes: string[];
  register: string;
  strategy: string;
  candidateCount: number;
  patternsBefore: string[];
  patternsAfter: string[];
  neuralBefore?: number;
  neuralAfter?: number;
};

const creators = 'Muzammil Mohammed · Zayed Asif Shaikh · Arsalan Mohammed · Sahib Singh';

const nav: { id: Page; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'detect', label: 'Detect', icon: Gauge },
  { id: 'naturalize', label: 'Naturalize', icon: WandSparkles },
  { id: 'compare', label: 'Compare', icon: GitCompareArrows },
  { id: 'method', label: 'Method', icon: BookOpen },
];

function classLabel(score: number) {
  if (score >= 60) return 'Likely AI-generated';
  if (score <= 40) return 'Likely human-written';
  return 'Mixed / uncertain';
}

function humanGuide(count: number, avg: number) {
  const multipliers = [0.62, 1.18, 0.78, 1.36, 0.7, 1.05, 1.48, 0.82, 1.22, 0.67, 1.1, 1.4];
  const center = avg || 18;
  return Array.from({ length: Math.max(3, count) }, (_, index) => Math.max(4, center * multipliers[index % multipliers.length]));
}

function App() {
  const [page, setPage] = useState<Page>('home');
  const [menu, setMenu] = useState(false);
  const [text, setText] = useState('');
  const [detection, setDetection] = useState<Detection | null>(null);
  const [detectLoading, setDetectLoading] = useState(false);
  const [detectError, setDetectError] = useState('');
  const [modelStatus, setModelStatus] = useState('');

  const [rewriteInput, setRewriteInput] = useState('');
  const [voiceSample, setVoiceSample] = useState('');
  const [rewriteStyle, setRewriteStyle] = useState('Auto');
  const [rewriteStrength, setRewriteStrength] = useState('Balanced');
  const [variationMode, setVariationMode] = useState('Subtle');
  const [naturalized, setNaturalized] = useState<NaturalizeResult | null>(null);
  const [rewriteLoading, setRewriteLoading] = useState(false);
  const [rewriteError, setRewriteError] = useState('');

  const [compareA, setCompareA] = useState('');
  const [compareB, setCompareB] = useState('');
  const [remoteCompareA, setRemoteCompareA] = useState<Profile | null>(null);
  const [remoteCompareB, setRemoteCompareB] = useState<Profile | null>(null);

  const detectProfile = useMemo(() => profile(text), [text]);
  const rewriteBefore = useMemo(() => profile(rewriteInput), [rewriteInput]);
  const rewriteAfter = useMemo(() => profile(naturalized?.text || ''), [naturalized]);
  const compareProfileA = useMemo(() => profile(compareA), [compareA]);
  const compareProfileB = useMemo(() => profile(compareB), [compareB]);
  const displayCompareA = remoteCompareA || compareProfileA;
  const displayCompareB = remoteCompareB || compareProfileB;

  useEffect(() => {
    if (!compareA.trim()) { setRemoteCompareA(null); return; }
    const timer = window.setTimeout(() => {
      apiPost<Profile>('/api/profile', { text: compareA }).then(setRemoteCompareA).catch(() => setRemoteCompareA(null));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [compareA]);

  useEffect(() => {
    if (!compareB.trim()) { setRemoteCompareB(null); return; }
    const timer = window.setTimeout(() => {
      apiPost<Profile>('/api/profile', { text: compareB }).then(setRemoteCompareB).catch(() => setRemoteCompareB(null));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [compareB]);

  const go = (next: Page) => {
    setPage(next);
    setMenu(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  async function runDetect() {
    const value = text.trim();
    const p = profile(value);
    if (p.words < 35) {
      setDetectError('Please provide at least 35 words. For a reliable result, use about 150+ words and preferably 10+ sentences.');
      return;
    }
    setDetectError('');
    setDetectLoading(true);
    setDetection(null);
    setModelStatus('Loading the TMR neural detector, then running the Python NLP cross-check…');

    try {
      let tmr: Awaited<ReturnType<typeof detectWithTmr>> | null = null;
      try {
        tmr = await detectWithTmr(value);
      } catch {
        tmr = null;
      }
      const backend = await apiPost<Detection>('/api/detect', {
        text: value,
        tmrScore: tmr?.score,
        chunkStdDev: tmr?.chunkStdDev,
        minChunkScore: tmr?.minChunkScore,
        maxChunkScore: tmr?.maxChunkScore,
      });
      const result: Detection = {
        ...backend,
        components: {
          ...backend.components,
          tmr: tmr?.score ?? backend.components?.tmr ?? null,
          stylometry: backend.components?.stylometry ?? localStylometryScore(p),
        },
        reasons: [
          ...(backend.reasons || []),
          ...(tmr ? [`TMR chunk range ${tmr.minChunkScore.toFixed(0)}–${tmr.maxChunkScore.toFixed(0)}`, `TMR chunk variation ${tmr.chunkStdDev.toFixed(1)}`] : []),
        ].slice(0, 7),
      };
      setDetection(result);
      setModelStatus(tmr
        ? 'TMR neural model active. Python NLTK sentence analysis and linguistic cross-check are active.'
        : 'TMR model could not load; Python linguistic fallback is active with reduced confidence.');
    } catch (error) {
      setDetectError(error instanceof Error ? error.message : 'The detector could not complete this analysis.');
    } finally {
      setDetectLoading(false);
    }
  }

  async function runNaturalize() {
    const value = rewriteInput.trim();
    if (wordList(value).length < 35) {
      setRewriteError('Please provide at least 35 words so the rewrite and meaning checks are meaningful.');
      return;
    }
    setRewriteError('');
    setRewriteLoading(true);
    setNaturalized(null);
    try {
      const result = await apiPost<NaturalizeResult>('/api/naturalize', {
        text: value,
        style: rewriteStyle,
        strength: rewriteStrength,
        voiceSample: voiceSample.trim(),
        variationMode,
      });
      if (!result.text?.trim()) throw new Error('Empty rewrite');
      try {
        const [beforeNeural, afterNeural] = await Promise.all([detectWithTmr(value), detectWithTmr(result.text)]);
        result.neuralBefore = beforeNeural.score;
        result.neuralAfter = afterNeural.score;
      } catch {
        result.neuralBefore = undefined;
        result.neuralAfter = undefined;
      }
      setNaturalized(result);
    } catch {
      setRewriteError('Naturalize could not complete the rewrite. Please try again; your original text has not been changed.');
    } finally {
      setRewriteLoading(false);
    }
  }

  return (
    <div className={`shell page-${page}`}>
      <Cosmos />
      <header className='topbar'>
        <button className='brand' onClick={() => go('home')}><span className='mark'>A</span><span>AuthentiWrite <b>AI</b><em>v3</em></span></button>
        <nav className='desktop-nav'>
          {nav.map((item) => <button key={item.id} onClick={() => go(item.id)} className={page === item.id ? 'active' : ''}><item.icon size={16} />{item.label}</button>)}
        </nav>
        <button className='mobile-menu' onClick={() => setMenu(!menu)} aria-label='Toggle navigation'>{menu ? <X /> : <Menu />}</button>
      </header>
      {menu && <div className='mobile-nav'>{nav.map((item) => <button key={item.id} onClick={() => go(item.id)}><item.icon size={17} />{item.label}</button>)}</div>}

      <main key={page} className='page'>
        {page === 'home' && <GalaxyHome go={go} />}

        {page === 'detect' && (
          <section>
            <Hero planet='detect' eyebrow='Core detector' title='A stronger detector with evidence you can inspect.' subtitle='The neural detector is primary. A smaller hosted cross-check, sentence-aware chunking, lexical analysis and transparent writing-pattern evidence help explain the result without pretending the score proves authorship.' />
            <div className='work-grid'>
              <div className='panel'>
                <Label title='Text to analyze' hint={`${detectProfile.words} words · ${detectProfile.sentences} sentences`} />
                <textarea value={text} onChange={(event: { target: { value: string } }) => { setText(event.target.value); setDetection(null); }} placeholder='Paste an essay, report, article excerpt, or paragraph…' />
                {detectProfile.words > 0 && detectProfile.sentences < 10 && <WarningBox text='Fewer than 10 sentences: sentence-rhythm and lexical evidence are less stable, so confidence will be reduced.' />}
                {detectError && <ErrorBox text={detectError} />}
                <button className='primary' disabled={detectLoading} onClick={runDetect}>{detectLoading ? <Activity className='spin' size={18} /> : <Zap size={18} />}{detectLoading ? 'Analyzing…' : 'Analyze writing'}</button>
                <p className='micro'>Best results: 150+ words and about 10+ sentences. The final value is an AI-likeness index, not proof of authorship.</p>
                {modelStatus && <p className='model-status'>{modelStatus}</p>}
              </div>
              <div>{detection ? <ScoreCard detection={detection} profile={detectProfile} /> : <EmptyResult />}</div>
            </div>
            {detection && (
              <>
                <Section kicker='Evidence 01' title='Writing rhythm graph' subtitle='Sentence length is plotted using the improved sentence parser, including terminal punctuation followed by quotes or brackets.' />
                <RhythmChart primary={detectProfile} primaryLabel='Your text' showGuide />
                <Section kicker='Evidence 02' title='Feature profile' subtitle='Lexical diversity now uses both MATTR and MTLD. Reference bands are descriptive project bands, not universal authorship rules.' />
                <ProfilePanel profile={detectProfile} />
                <Section kicker='Evidence 03' title='Ensemble breakdown' subtitle='The trained browser neural model is intentionally weighted much more heavily than the generic cross-check.' />
                <EnsemblePanel detection={detection} />
              </>
            )}
          </section>
        )}

        {page === 'naturalize' && (
          <section>
            <Hero planet='naturalize' eyebrow='Core rewriting engine' title='Rewrite for a real reader, not for a detector.' subtitle='Naturalize now scans a much larger set of formulaic AI-writing patterns, protects names/numbers/quotes/citations, generates several candidates, critiques the best draft, repairs meaning drift, and can match a sample of your own voice.' />
            <div className='control-row'>
              <div><small>Register / voice</small><div className='style-tabs'>{['Auto', 'Student', 'Conversational', 'Natural', 'Academic', 'Professional'].map((item) => <button key={item} className={rewriteStyle === item ? 'active' : ''} onClick={() => setRewriteStyle(item)}>{item}</button>)}</div></div>
              <div><small>Edit strength</small><div className='style-tabs'>{['Minimal', 'Balanced', 'Strong'].map((item) => <button key={item} className={rewriteStrength === item ? 'active' : ''} onClick={() => setRewriteStrength(item)}>{item}</button>)}</div></div>
            </div>
            <div className='variation-control panel'>
              <div>
                <small>Natural variation</small>
                <h3>Controlled roughness</h3>
                <p>Subtle mode allows one or two low-impact quirks on longer passages: a small continuity pivot and, when safe, one capitalization or punctuation inconsistency. Protected names, numbers, quotes, citations, URLs and factual claims are never intentionally damaged.</p>
              </div>
              <div className='style-tabs'>{['Subtle', 'Off'].map((item) => <button key={item} className={variationMode === item ? 'active' : ''} onClick={() => setVariationMode(item)}>{item}</button>)}</div>
            </div>
            <div className='voice-sample panel'>
              <Label title='Optional writing sample for voice matching' hint={`${wordList(voiceSample).length} words`} />
              <textarea className='compact-textarea' value={voiceSample} onChange={(event: { target: { value: string } }) => setVoiceSample(event.target.value)} placeholder='Optional: paste 2–3 paragraphs you genuinely wrote. Naturalize will imitate rhythm, punctuation and word-choice tendencies, but will not copy facts from this sample.' />
            </div>
            <div className='work-grid'>
              <div className='panel'>
                <Label title='Original text' hint={`${rewriteBefore.words} words · ${rewriteBefore.sentences} sentences`} />
                <textarea value={rewriteInput} onChange={(event: { target: { value: string } }) => { setRewriteInput(event.target.value); setNaturalized(null); }} placeholder='Paste text to rewrite while preserving its claims and details…' />
                {rewriteError && <ErrorBox text={rewriteError} />}
                <button className='primary' disabled={rewriteLoading} onClick={runNaturalize}>{rewriteLoading ? <Activity className='spin' size={18} /> : <WandSparkles size={18} />}{rewriteLoading ? 'Rewriting, critiquing and checking…' : `Naturalize · ${rewriteStrength}`}</button>
                <p className='micro'>The rewrite is selected for clarity, source fidelity, reduced formulaic patterns and natural rhythm. With Subtle variation enabled, longer passages may receive one or two tiny guarded rough edges after the meaning check. Detector scores are shown afterward only as an observation.</p>
              </div>
              <div className='panel'>
                <Label title='Naturalized text' hint={naturalized ? `${rewriteAfter.words} words · ${naturalized.passes} pass${naturalized.passes === 1 ? '' : 'es'}` : 'Waiting for input'} />
                {naturalized ? (
                  <>
                    <div className='output'>{naturalized.text}</div>
                    <div className='dual-actions'>
                      <button className='secondary' onClick={() => navigator.clipboard.writeText(naturalized.text)}><Copy size={16} />Copy</button>
                      <button className='secondary' onClick={() => { setText(naturalized.text); setDetection(null); go('detect'); }}><Gauge size={16} />Open in Detect</button>
                    </div>
                  </>
                ) : <div className='empty-inline'><Target /><p>The meaning-checked rewrite will appear here.</p></div>}
              </div>
            </div>
            {naturalized && (
              <>
                <Section kicker='Before / after' title='What actually changed?' subtitle='The graph and audit show the structural effect, source preservation and remaining formulaic patterns.' />
                <RhythmChart primary={rewriteBefore} primaryLabel='Before' secondary={rewriteAfter} secondaryLabel='After' showGuide />
                <div className='metric-grid four'>
                  <MetricCard title='Reference distance' before={naturalized.beforeDistance} after={naturalized.afterDistance} lowerBetter />
                  <MetricCard title='Lexical retention' before={100} after={naturalized.lexicalRetention} suffix='%' />
                  <MetricCard title='Protected details kept' before={100} after={naturalized.anchorPreservation} suffix='%' />
                  <MetricCard title='Meaning check' text={naturalized.meaningCheck} />
                </div>
                <div className='naturalize-audit'>
                  <div><span>Detected register</span><b>{naturalized.register}</b></div>
                  <div><span>Selected strategy</span><b>{naturalized.strategy}</b></div>
                  <div><span>Candidates compared</span><b>{naturalized.candidateCount}</b></div>
                  <div><span>Voice sample</span><b>{naturalized.voiceMatched ? 'Matched' : 'Not used'}</b></div>
                  <div><span>Natural variation</span><b>{naturalized.variationMode || 'Off'}</b></div>
                </div>
                <div className='note'><Info size={18} /><div><b>Controlled roughness</b><p>{naturalized.microImperfections?.length ? naturalized.microImperfections.join(' · ') : 'No safe micro-imperfection was added to this passage.'}</p></div></div>
                <div className='pattern-audit'>
                  <div><b>Before: flagged patterns</b><p>{naturalized.patternsBefore.length ? naturalized.patternsBefore.join(' · ') : 'No strong surface-pattern flags.'}</p></div>
                  <div><b>After: remaining patterns</b><p>{naturalized.patternsAfter.length ? naturalized.patternsAfter.join(' · ') : 'No strong surface-pattern flags remain.'}</p></div>
                </div>
                <div className='note success'><CheckCircle2 size={18} /><div><b>Editor critique</b><p>{naturalized.critique || 'The selected draft passed the final source-fidelity and style audit.'}</p></div></div>
                <div className='note'><Info size={18} /><div><b>Observed detector movement</b><p>{naturalized.neuralBefore == null || naturalized.neuralAfter == null ? 'Neural before/after comparison was unavailable.' : `TMR index moved from ${naturalized.neuralBefore.toFixed(0)} to ${naturalized.neuralAfter.toFixed(0)}. This is not used to choose the rewrite.`}</p></div></div>
              </>
            )}
          </section>
        )}

        {page === 'compare' && (
          <section>
            <Hero planet='compare' eyebrow='Deep comparison' title='Compare two drafts with a proper sentence parser.' subtitle='Compare now handles punctuation followed by quotation marks or brackets, protects common abbreviations such as Mr., Dr., e.g. and i.e., uses broader multi-word connector detection, and reports both MATTR and MTLD lexical diversity.' />
            <div className='work-grid'>
              <div className='panel'>
                <Label title='Text A' hint={`${displayCompareA.words} words · ${displayCompareA.sentences} sentences`} />
                <textarea value={compareA} onChange={(event: { target: { value: string } }) => setCompareA(event.target.value)} placeholder='Paste the first draft…' />
                <CompareWarnings profile={displayCompareA} label='Text A' />
              </div>
              <div className='panel'>
                <Label title='Text B' hint={`${displayCompareB.words} words · ${displayCompareB.sentences} sentences`} />
                <textarea value={compareB} onChange={(event: { target: { value: string } }) => setCompareB(event.target.value)} placeholder='Paste the second draft…' />
                <CompareWarnings profile={displayCompareB} label='Text B' />
              </div>
            </div>
            {(displayCompareA.words > 0 || displayCompareB.words > 0) && (
              <>
                <Section kicker='Sentence recognition' title='Verify exactly what the parser counted' subtitle='This preview makes sentence-boundary errors visible instead of hiding them inside a metric.' />
                <SentencePreview a={displayCompareA} b={displayCompareB} />
                <Section kicker='Overlay' title='Sentence-rhythm comparison' subtitle='Sentence length is plotted across both drafts using the same parser shown above.' />
                <RhythmChart primary={displayCompareA} primaryLabel='Text A' secondary={displayCompareB} secondaryLabel='Text B' showGuide={false} />
                <Section kicker='Reference profile' title='A, B and the project reference band' subtitle='These broad bands help interpret style metrics. They are descriptive comparison ranges, not universal human-vs-AI thresholds.' />
                <ReferenceProfileTable a={displayCompareA} b={displayCompareB} />
                <div className='comparison-grid'>
                  <ProfileMini title='Text A' profile={displayCompareA} />
                  <ProfileMini title='Text B' profile={displayCompareB} />
                </div>
                <Section kicker='Connector analysis' title='Multi-word formal connectors detected' subtitle='Phrases are counted longest-first to reduce double-counting of overlapping connectors.' />
                <ConnectorPanel a={displayCompareA} b={displayCompareB} />
              </>
            )}
          </section>
        )}

        {page === 'method' && <Methodology />}
      </main>

      <footer>
        <div><div className='brand small'><span className='mark'>A</span><span>AuthentiWrite AI <em>v3</em></span></div><div className='made-by'>Made by <b>{creators}</b></div></div>
        <p>Transparent AI-likeness analysis · source-preserving writing enhancement · not proof of authorship.</p>
      </footer>
    </div>
  );
}

function Cosmos() {
  return <div className='cosmos' aria-hidden='true'><div className='stars stars-one' /><div className='stars stars-two' /><div className='nebula nebula-one' /><div className='nebula nebula-two' /><div className='meteor meteor-one' /><div className='meteor meteor-two' /></div>;
}

function GalaxyHome({ go }: { go: (page: Page) => void }) {
  const planets = [
    { id: 'detect' as Page, label: 'Detect', sub: 'Neural score + explainable evidence', cls: 'planet-detect', icon: <Gauge /> },
    { id: 'naturalize' as Page, label: 'Naturalize', sub: 'Source-safe multi-pass rewriting', cls: 'planet-naturalize', icon: <WandSparkles /> },
    { id: 'compare' as Page, label: 'Compare', sub: 'Sentence + lexical profile comparison', cls: 'planet-compare', icon: <GitCompareArrows /> },
    { id: 'method' as Page, label: 'Method', sub: 'Research + examiner answers', cls: 'planet-method', icon: <BookOpen /> },
  ];
  return (
    <section className='galaxy-home'>
      <div className='galaxy-copy'>
        <div className='eyebrow'><Sparkles size={14} /> AuthentiWrite v3</div>
        <h1>Detect better.<br />Rewrite better.</h1>
        <p>The project now concentrates on its two core jobs: detecting AI-like writing patterns with visible evidence, and rewriting text naturally while preserving its actual meaning.</p>
        <div className='home-badges'><span>Neural-first detection</span><span>Voice matching</span><span>Improved sentence parser</span><span>Meaning guardrails</span></div>
        <div className='signature'>Made by <b>{creators}</b></div>
      </div>
      <div className='solar-system'>
        <div className='orbit orbit-1' /><div className='orbit orbit-2' /><div className='orbit orbit-3' />
        <div className='core'><span className='core-aura' /><strong>AW</strong><small>CORE ENGINE</small></div>
        {planets.map((planet) => <button key={planet.id} className={`planet ${planet.cls}`} onClick={() => go(planet.id)}><span className='planet-globe'>{planet.icon}</span><span className='planet-copy'><b>{planet.label}</b><small>{planet.sub}</small></span></button>)}
      </div>
      <div className='unique-strip'><BrainCircuit size={18} /><div><b>Core project focus</b><span>Detect and Naturalize now share the same improved sentence, lexical and style analysis so the evidence shown to the user matches the structure the rewrite engine is actually editing.</span></div></div>
    </section>
  );
}

function Hero({ planet, eyebrow, title, subtitle }: { planet: string; eyebrow: string; title: string; subtitle: string }) {
  return <div className={`hero hero-${planet}`}><div className='hero-planet' aria-hidden='true' /><div className='eyebrow'><Sparkles size={14} />{eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div>;
}

function Label({ title, hint }: { title: string; hint: string }) {
  return <div className='label'><span>{title}</span><small>{hint}</small></div>;
}

function ErrorBox({ text }: { text: string }) {
  return <div className='error'><X size={16} />{text}</div>;
}

function WarningBox({ text }: { text: string }) {
  return <div className='warning'><Info size={16} />{text}</div>;
}

function Section({ kicker, title, subtitle }: { kicker: string; title: string; subtitle?: string }) {
  return <div className='section-title'><span>{kicker}</span><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>;
}

function EmptyResult() {
  return <div className='empty-card'><Gauge /><h3>Your evidence panel will appear here</h3><p>Run Detect to see the neural score, chunk consistency, rhythm graph, lexical profile, style-pattern evidence and uncertainty.</p></div>;
}

function ScoreCard({ detection, profile: p }: { detection: Detection; profile: Profile }) {
  const color = detection.score >= 60 ? 'var(--red)' : detection.score <= 40 ? 'var(--green)' : 'var(--amber)';
  return (
    <div className='score-card'>
      <div className='score-ring' style={{ '--score': detection.score, '--ring': color } as CSSProperties}><div><strong>{Math.round(detection.score)}</strong><span>/ 100 index</span></div></div>
      <div className='score-copy'>
        <span className='kicker'>AI-likeness index</span>
        <h2>{detection.classification || classLabel(detection.score)}</h2>
        <p>{detection.summary}</p>
        <div className='pills'><span>{detection.confidence} confidence</span><span>{reliability(p)} sample reliability</span><span>±{detection.uncertainty} uncertainty</span><span>{detection.mode}</span></div>
      </div>
    </div>
  );
}

function RhythmChart({ primary, primaryLabel, secondary, secondaryLabel, showGuide }: { primary: Profile; primaryLabel: string; secondary?: Profile; secondaryLabel?: string; showGuide: boolean }) {
  const first = primary.sentenceLengths.length ? primary.sentenceLengths : [0];
  const second = secondary?.sentenceLengths.length ? secondary.sentenceLengths : [];
  const count = Math.max(first.length, second.length, showGuide ? 3 : 1);
  const guide = showGuide ? humanGuide(count, secondary?.avgSentence || primary.avgSentence || 18) : [];
  const maxValue = Math.max(10, ...first, ...second, ...guide) * 1.12;
  const width = 900; const height = 300; const left = 52; const right = 20; const top = 24; const bottom = 42;
  const x = (index: number, length: number) => left + (index * (width - left - right)) / Math.max(1, length - 1);
  const y = (value: number) => top + (height - top - bottom) * (1 - value / maxValue);
  const points = (series: number[]) => series.map((value, index) => `${x(index, series.length)},${y(value)}`).join(' ');
  return (
    <div className='chart-card'>
      <div className='chart-legend'><span className='legend primary-dot'>{primaryLabel}</span>{secondary && <span className='legend secondary-dot'>{secondaryLabel}</span>}{showGuide && <span className='legend guide-dot'>Illustrative cadence guide</span>}</div>
      <svg viewBox={`0 0 ${width} ${height}`} role='img' aria-label='Sentence rhythm chart'>
        {[0.25, 0.5, 0.75, 1].map((level) => <line key={level} x1={left} x2={width - right} y1={top + (height - top - bottom) * level} y2={top + (height - top - bottom) * level} className='grid-line' />)}
        <line x1={left} x2={left} y1={top} y2={height - bottom} className='axis-line' /><line x1={left} x2={width - right} y1={height - bottom} y2={height - bottom} className='axis-line' />
        {showGuide && <polyline points={points(guide)} className='chart-line guide-line' fill='none' />}
        <polyline points={points(first)} className='chart-line primary-line' fill='none' />
        {secondary && second.length > 0 && <polyline points={points(second)} className='chart-line secondary-line' fill='none' />}
        <text x='12' y='22' className='axis-label'>words</text><text x={width - 120} y={height - 10} className='axis-label'>sentence →</text>
      </svg>
      <p className='chart-caption'>Text-derived cadence trace: words per recognized sentence. Quotation marks and closing brackets after terminal punctuation stay attached to the sentence.</p>
    </div>
  );
}

function ProfilePanel({ profile: p }: { profile: Profile }) {
  const metrics = [
    ['Sentence variation', p.sentenceCv.toFixed(2), '0.35–0.85'],
    ['MATTR-50', p.mattr.toFixed(2), '0.55–0.82'],
    ['MTLD', p.mtld.toFixed(0), '45–120'],
    ['Punctuation variation', p.punctuationCv.toFixed(2), '0.38–1.25'],
    ['Formal connectors', `${p.formalConnectorDensity.toFixed(2)}/100w`, '0–1.8/100w'],
    ['Repeated bigrams', `${p.repetitionRate.toFixed(2)}%`, '0–1.8%'],
  ];
  return (
    <div className='profile-card'>
      <div className='distance-card'><span>Reference distance</span><strong>{p.humanDistance.toFixed(0)}</strong><small>Lower means closer to the project’s broad reference bands. It is not an authorship probability.</small></div>
      <div className='feature-bars'>
        {metrics.map(([label, value, target]) => <div className='profile-metric' key={label}><div><b>{label}</b><small>reference {target}</small></div><strong>{value}</strong></div>)}
      </div>
      <div className='descriptor-grid'><span>Words <b>{p.words}</b></span><span>Sentences <b>{p.sentences}</b></span><span>Median sentence <b>{p.medianSentence.toFixed(0)} words</b></span><span>Lexical reliability <b>{p.lexicalReliability}</b></span><span>Connector hits <b>{p.formalConnectorHits}</b></span><span>Micro-irregularity <b>{p.microIrregularity.toFixed(0)}/100</b></span></div>
    </div>
  );
}

function EnsemblePanel({ detection }: { detection: Detection }) {
  const rows = [
    ['TMR RoBERTa neural detector', detection.components.tmr ?? null],
    ['Hosted context cross-check', detection.components.context],
    ['Hosted style cross-check', detection.components.style],
    ['Transparent stylometry', detection.components.stylometry],
    ['Formulaic-pattern index', detection.components.patternScore ?? null],
  ] as const;
  return (
    <div className='ensemble-card'>
      <div className='ensemble-bars'>{rows.map(([label, value]) => <div className='ensemble-row' key={label}><span>{label}</span><div className='ensemble-track'><i style={{ width: `${value ?? 0}%` }} /></div><strong>{value == null ? 'offline' : Math.round(value)}</strong></div>)}</div>
      <div className='evidence-box'><b>Top evidence considered</b><div>{detection.reasons.map((reason) => <span key={reason}>{reason}</span>)}</div></div>
      <div className='agreement'><Info size={16} /><span>{detection.agreement == null ? 'Only one neural evidence path was available.' : `Cross-model agreement: ${Math.round(detection.agreement)}%. Strong disagreement automatically lowers confidence.`}</span></div>
    </div>
  );
}

function CompareWarnings({ profile: p, label }: { profile: Profile; label: string }) {
  if (!p.words) return null;
  const warnings: string[] = [];
  if (p.sentences < 10) warnings.push(`${label} has only ${p.sentences} recognized sentence${p.sentences === 1 ? '' : 's'}; rhythm statistics are less stable below about 10.`);
  if (p.words < 100) warnings.push(`${label} has ${p.words} words; lexical diversity is length-sensitive at this size, so MATTR/MTLD should be interpreted cautiously.`);
  return warnings.length ? <div className='compare-warnings'>{warnings.map((item) => <WarningBox key={item} text={item} />)}</div> : null;
}

function SentencePreview({ a, b }: { a: Profile; b: Profile }) {
  const render = (title: string, p: Profile) => <div className='sentence-list'><h3>{title} · {p.sentences} sentences</h3>{p.sentenceTexts.slice(0, 12).map((sentence, index) => <div key={`${title}-${index}`}><span>{index + 1}</span><p>{sentence}</p><b>{wordList(sentence).length}w</b></div>)}{p.sentences > 12 && <small>Showing first 12 of {p.sentences} sentences.</small>}</div>;
  return <div className='sentence-preview'>{render('Text A', a)}{render('Text B', b)}</div>;
}

function ReferenceProfileTable({ a, b }: { a: Profile; b: Profile }) {
  const formatValue = (value: number, decimals = 2, unit = '') => `${value.toFixed(decimals)}${unit}`;
  return (
    <div className='reference-table-wrap'>
      <table className='reference-table'>
        <thead><tr><th>Metric</th><th>Text A</th><th>Text B</th><th>Reference band</th></tr></thead>
        <tbody>{REFERENCE_PROFILE.map((metric) => {
          const aValue = Number(a[metric.key] || 0);
          const bValue = Number(b[metric.key] || 0);
          return <tr key={metric.label}><td>{metric.label}</td><td><b>{formatValue(aValue, metric.decimals, metric.unit)}</b><small>{referenceStatus(aValue, metric.low, metric.high)}</small></td><td><b>{formatValue(bValue, metric.decimals, metric.unit)}</b><small>{referenceStatus(bValue, metric.low, metric.high)}</small></td><td>{formatValue(metric.low, metric.decimals, metric.unit)} – {formatValue(metric.high, metric.decimals, metric.unit)}</td></tr>;
        })}</tbody>
      </table>
      <p className='table-note'>Reference band = a deliberately broad project comparison band for general English prose. Genre, age, purpose and sample length can move genuine human writing outside these ranges.</p>
    </div>
  );
}

function ConnectorPanel({ a, b }: { a: Profile; b: Profile }) {
  const card = (title: string, p: Profile) => <div className='connector-card'><h3>{title}</h3><strong>{p.formalConnectorHits} hits · {p.formalConnectorDensity.toFixed(2)}/100 words</strong><div>{p.formalConnectorPhrases.length ? p.formalConnectorPhrases.map((phrase) => <span key={phrase}>{phrase}</span>) : <small>No listed formal connectors detected.</small>}</div></div>;
  return <div className='connector-grid'>{card('Text A', a)}{card('Text B', b)}</div>;
}

function MetricCard({ title, before, after, suffix = '', lowerBetter, text }: { title: string; before?: number; after?: number; suffix?: string; lowerBetter?: boolean; text?: string }) {
  if (text) return <div className='quality metric-text'><span>{title}</span><strong>{text}</strong></div>;
  const improved = before != null && after != null ? (lowerBetter ? after < before : after > before) : false;
  return <div className='quality'><span>{title}</span><div className='quality-values'><b>{before?.toFixed(0)}{suffix}</b><ArrowRight size={15} /><strong className={improved ? 'improved' : ''}>{after?.toFixed(0)}{suffix}</strong></div></div>;
}

function ProfileMini({ title, profile: p }: { title: string; profile: Profile }) {
  return <div className='profile-mini'><h3>{title}</h3><div><span>Reference distance</span><b>{p.humanDistance.toFixed(0)}</b></div><div><span>Sentence variation</span><b>{p.sentenceCv.toFixed(2)}</b></div><div><span>MATTR-50</span><b>{p.mattr.toFixed(2)}</b></div><div><span>MTLD</span><b>{p.mtld.toFixed(0)}</b></div><div><span>Formal connectors</span><b>{p.formalConnectorDensity.toFixed(2)}/100w</b></div></div>;
}

function Methodology() {
  return (
    <section>
      <Hero planet='method' eyebrow='Methodology & viva' title='Know exactly what the core project does.' subtitle='AuthentiWrite v3 uses a browser neural detector plus a Python FastAPI NLP backend for sentence segmentation, comparison and Naturalize orchestration.' />
      <Section kicker='Core improvements' title='What changed in this version?' />
      <div className='method-grid'>
        <MethodCard icon={<Gauge />} title='1. Neural-first Detect' text='The trained TMR RoBERTa browser model is the primary score. Hosted LLM classification is only a smaller cross-check, while stylometry and formulaic-pattern scans explain the result.' />
        <MethodCard icon={<WandSparkles />} title='2. Multi-pass Naturalize' text='The rewrite pipeline protects source details, scans many common AI-writing patterns, creates several candidate rewrites, critiques the best draft, repairs meaning drift, optionally matches a genuine writing sample, and can add tightly limited low-impact roughness after the meaning check.' />
        <MethodCard icon={<Quote />} title='3. Better sentence recognition' text='The sentence parser keeps closing quotes and brackets attached to terminal punctuation and protects common abbreviations, initials, decimals, URLs and emails before splitting.' />
        <MethodCard icon={<BarChart3 />} title='4. Better lexical comparison' text='Compare reports both MATTR and MTLD instead of relying on a single length-sensitive type-token measure, and warns when the sample is too short for stable interpretation.' />
      </div>
      <Section kicker='Humanizer research' title='What we borrowed from strong open-source humanizer design' />
      <div className='research-list'>
        <article><b>Pattern-first editing</b><p>Good humanizers do not just swap synonyms. They look for staging phrases, forced symmetry, repeated openings, inflated significance, stock vocabulary, unnecessary signposting and chatbot residue.</p></article>
        <article><b>Rewrite → critique → final pass</b><p>The strongest workflow is iterative: draft a rewrite, inspect what still sounds formulaic, then make a final source-preserving edit rather than treating the first model answer as finished.</p></article>
        <article><b>Voice matching</b><p>A real writing sample is more useful than random “human mistakes.” AuthentiWrite can now use a user-provided sample to match rhythm, punctuation and word-choice tendencies without importing facts from it.</p></article>
        <article><b>Fact guardrails</b><p>Names, numbers, dates, URLs, quoted text, citations and technical details are treated as protected anchors. Naturalize measures whether those anchors survived and repairs the text when meaning drifts.</p></article>
      </div>
      <Section kicker='Examiner questions' title='Short answers you can defend' />
      <div className='qa-list'>
        <details open><summary>Why is the sentence count more reliable now?</summary><p>The parser protects common abbreviations and decimal points before splitting, and it recognizes sentence endings even when punctuation is followed by quotation marks or closing brackets. Compare also shows the parsed sentences so mistakes are visible.</p></details>
        <details><summary>Why use MATTR and MTLD together?</summary><p>Simple type-token ratio changes strongly with text length. MATTR averages lexical diversity across moving windows, while MTLD estimates how long lexical variety can be maintained before the type-token ratio falls below a threshold. Showing both is more informative.</p></details>
        <details><summary>Does Naturalize deliberately add small imperfections?</summary><p>Optionally. Subtle variation can add a tiny amount of ordinary roughness on longer passages, such as one source-grounded continuity pivot and one harmless capitalization or punctuation inconsistency when a safe opportunity exists. It never intentionally changes names, numbers, quotations, citations, URLs, technical facts or the topic.</p></details>
        <details><summary>Does a detector score prove who wrote the text?</summary><p>No. Human and AI writing overlap, and edited AI text can look human while polished human text can look AI-like. The score is an index with uncertainty and evidence, not proof of authorship.</p></details>
      </div>
      <div className='note'><ShieldCheck size={18} /><div><b>Design principle</b><p>Detector output never decides which Naturalize candidate wins. Rewrites are selected for readability, source fidelity, pattern reduction and edit quality; detector movement is shown only after the rewrite.</p></div></div>
    </section>
  );
}

function MethodCard({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return <article className='method-card'><div>{icon}</div><h3>{title}</h3><p>{text}</p></article>;
}

export default App;
