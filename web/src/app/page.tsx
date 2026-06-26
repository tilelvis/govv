'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search, FileText, Building2, Scale, BookOpen, Landmark, Database,
  TrendingUp, Loader2, ExternalLink, ChevronRight, X,
  ArrowLeft, RefreshCw, Sparkles, Send, BarChart3, Hash, Users, MapPin, DollarSign,
  Calendar, Tag, Eye, FileDown, Bot,
} from 'lucide-react';

// ──────────────── Types ────────────────
type Doc = {
  id: number; source: string; title: string; description: string | null;
  pdfUrl: string | null; publishedDate: string | null; fetchedAt: string;
  pageCount: number | null; fileSizeBytes: number | null;
  aiSummary: string | null; aiTopics: string[] | null; aiEntities: any;
  isProcessed: boolean; snippet?: string; rank?: number;
};

// ──────────────── Source config ────────────────
const SOURCES = [
  { key: 'all', label: 'All Sources', icon: Database, color: 'bg-blue-500' },
  { key: 'gazette', label: 'Kenya Gazette', icon: BookOpen, color: 'bg-amber-500' },
  { key: 'court_ruling', label: 'Court Rulings', icon: Scale, color: 'bg-purple-500' },
  { key: 'hansard', label: 'Hansard', icon: Landmark, color: 'bg-green-500' },
  { key: 'cbk_circular', label: 'CBK Circulars', icon: Building2, color: 'bg-cyan-500' },
  { key: 'knbs_report', label: 'KNBS Reports', icon: BarChart3, color: 'bg-orange-500' },
  { key: 'budget', label: 'Budget & Audit', icon: DollarSign, color: 'bg-red-500' },
  { key: 'tender', label: 'Tenders', icon: FileText, color: 'bg-teal-500' },
] as const;

const ENTITY_ICONS: Record<string, any> = {
  person: Users, organization: Building2, location: MapPin,
  amount: DollarSign, date: Calendar, law: Scale, citation: Hash,
};

const ENTITY_COLORS: Record<string, string> = {
  person: 'text-blue-400 bg-blue-500/10', organization: 'text-purple-400 bg-purple-500/10',
  location: 'text-green-400 bg-green-500/10', amount: 'text-amber-400 bg-amber-500/10',
  date: 'text-cyan-400 bg-cyan-500/10', law: 'text-red-400 bg-red-500/10',
  citation: 'text-pink-400 bg-pink-500/10',
};

// ──────────────── Helpers ────────────────
const fmtDate = (iso: string | null) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
};
const fmtSize = (bytes: number | null) => {
  if (!bytes) return '';
  if (bytes > 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
};
const fmtAgo = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

// ──────────────── Source badge color ────────────────
function sourceColor(source: string): string {
  const map: Record<string, string> = {
    gazette: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
    court_ruling: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
    hansard: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    cbk_circular: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300',
    knbs_report: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
    budget: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    tender: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300',
  };
  return map[source] || 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';
}

// ──────────────── Main App ────────────────
export default function Home() {
  const [view, setView] = useState<'overview' | 'browse' | 'search' | 'reader'>('overview');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');

  // Data state
  const [stats, setStats] = useState<any>(null);
  const [documents, setDocuments] = useState<Doc[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [searchResults, setSearchResults] = useState<Doc[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchType, setSearchType] = useState('');

  // Reader state
  const [currentDoc, setCurrentDoc] = useState<any>(null);
  const [docEntities, setDocEntities] = useState<any[]>([]);

  // AI Ask state
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiAnswer, setAiAnswer] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  // Loading
  const [loading, setLoading] = useState(false);
  const [statsLoading, setStatsLoading] = useState(true);

  const LIMIT = 20;

  // ──────────────── Fetch stats ────────────────
  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const res = await fetch('/api/stats');
      const data = await res.json();
      setStats(data);
    } catch (e) { console.error(e); }
    setStatsLoading(false);
  }, []);

  // ──────────────── Fetch documents ────────────────
  const fetchDocuments = useCallback(async (source: string, off: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(LIMIT), offset: String(off) });
      if (source && source !== 'all') params.set('source', source);
      const res = await fetch(`/api/documents/latest?${params}`);
      const data = await res.json();
      setDocuments(data.documents);
      setTotal(data.total);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  // ──────────────── Search ────────────────
  const doSearch = useCallback(async (q: string, off: number = 0) => {
    if (!q.trim() || q.length < 2) return;
    setLoading(true);
    setQuery(q);
    setView('search');
    try {
      const params = new URLSearchParams({ q, limit: String(LIMIT), offset: String(off) });
      if (sourceFilter !== 'all') params.set('source', sourceFilter);
      const res = await fetch(`/api/search?${params}`);
      const data = await res.json();
      setSearchResults(data.results);
      setSearchTotal(data.total);
      setSearchType(data.searchType);
      setOffset(off);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [sourceFilter]);

  // ──────────────── Open reader ────────────────
  const openReader = useCallback(async (docId: number) => {
    setView('reader');
    setCurrentDoc(null);
    try {
      const res = await fetch(`/api/documents/${docId}`);
      const data = await res.json();
      setCurrentDoc(data.document);
      setDocEntities(data.entities);
    } catch (e) { console.error(e); }
  }, []);

  // ──────────────── AI Ask ────────────────
  const askAI = useCallback(async () => {
    if (!aiQuestion.trim() || aiLoading) return;
    setAiLoading(true);
    setAiAnswer('');
    try {
      const res = await fetch('/api/ai/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: aiQuestion, docIds: currentDoc ? [currentDoc.id] : [] }),
      });
      const data = await res.json();
      setAiAnswer(data.answer || data.error || 'No answer.');
    } catch (e: any) { setAiAnswer(`Error: ${e.message}`); }
    setAiLoading(false);
  }, [aiQuestion, currentDoc, aiLoading]);

  // ──────────────── Effects ────────────────
  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => {
    if (view === 'browse') fetchDocuments(sourceFilter, offset);
  }, [view, sourceFilter, offset, fetchDocuments]);

  // ──────────────── Keyboard shortcut ────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        document.getElementById('main-search')?.focus();
      }
      if (e.key === 'Escape' && view === 'reader') {
        setView('browse');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view]);

  // ──────────────── Render: Overview ────────────────
  const renderOverview = () => {
    if (statsLoading) return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin opacity-50" /></div>;
    if (!stats) return null;

    return (
      <div className="space-y-8">
        {/* Hero Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Documents', value: stats.total, icon: FileText, color: 'text-blue-500' },
            { label: 'Pages Extracted', value: stats.totalPages?.toLocaleString(), icon: BookOpen, color: 'text-amber-500' },
            { label: 'Text Archived', value: `${stats.totalTextMb} MB`, icon: Database, color: 'text-green-500' },
            { label: 'AI Processed', value: stats.processed, icon: Sparkles, color: 'text-purple-500' },
          ].map(s => (
            <div key={s.label} className="rounded-xl border border-border/50 bg-card/50 backdrop-blur p-5">
              <div className="flex items-center gap-2 mb-2"><s.icon className={`w-4 h-4 ${s.color}`} /><span className="text-xs text-muted-foreground uppercase tracking-wider">{s.label}</span></div>
              <div className="text-3xl font-bold tracking-tight">{s.value}</div>
            </div>
          ))}
        </div>

        {/* Sources breakdown + Top Entities */}
        <div className="grid md:grid-cols-2 gap-6">
          <div className="rounded-xl border border-border/50 bg-card/50 backdrop-blur p-6">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Documents by Source</h3>
            <div className="space-y-3">
              {stats.bySource?.length > 0 ? stats.bySource.map((s: any) => {
                const pct = stats.total > 0 ? (s.count / stats.total * 100) : 0;
                const src = SOURCES.find(x => x.key === s.source);
                return (
                  <button key={s.source} onClick={() => { setSourceFilter(s.source); setView('browse'); }}
                    className="w-full flex items-center gap-3 text-left group">
                    {src && <src.icon className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-medium truncate">{s.source.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</span>
                        <span className="text-muted-foreground ml-2">{s.count}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full bg-primary/70 transition-all" style={{ width: `${pct}%` }} /></div>
                    </div>
                  </button>
                );
              }) : <p className="text-sm text-muted-foreground">No documents yet. Run the gazette collector to get started.</p>}
            </div>
          </div>

          <div className="rounded-xl border border-border/50 bg-card/50 backdrop-blur p-6">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Top Entities</h3>
            <div className="flex flex-wrap gap-2">
              {stats.topEntities?.length > 0 ? stats.topEntities.map((e: any, i: number) => {
                const Icon = ENTITY_ICONS[e.type] || Hash;
                const color = ENTITY_COLORS[e.type] || 'text-gray-400 bg-gray-500/10';
                return (
                  <span key={i} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${color}`}>
                    <Icon className="w-3 h-3" />{e.name}<span className="opacity-50">({e.docCount})</span>
                  </span>
                );
              }) : <p className="text-sm text-muted-foreground">Entities will appear after AI processing runs.</p>}
            </div>
          </div>
        </div>

        {/* Recent documents */}
        <div className="rounded-xl border border-border/50 bg-card/50 backdrop-blur p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Recent Documents</h3>
            <button onClick={() => setView('browse')} className="text-xs text-primary hover:underline flex items-center gap-1">View all <ChevronRight className="w-3 h-3" /></button>
          </div>
          <div className="divide-y divide-border/50">
            {stats.recentDocs?.length > 0 ? stats.recentDocs.map((d: any) => (
              <button key={d.id} onClick={() => openReader(d.id)}
                className="w-full flex items-start gap-3 py-3 text-left hover:bg-muted/30 rounded-lg px-2 -mx-2 transition">
                <FileText className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{d.title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${sourceColor(d.source)}`}>{d.source}</span>
                    <span className="text-xs text-muted-foreground">{fmtDate(d.publishedDate)}</span>
                    {d.pageCount && <span className="text-xs text-muted-foreground">{d.pageCount}p</span>}
                  </div>
                </div>
              </button>
            )) : <p className="text-sm text-muted-foreground py-4">No documents yet.</p>}
          </div>
        </div>
      </div>
    );
  };

  // ──────────────── Render: Document list ────────────────
  const renderDocList = (docs: Doc[], docTotal: number) => {
    const isSearch = view === 'search';
    return (
      <div className="space-y-3">
        {isSearch && searchType && (
          <div className="text-xs text-muted-foreground">
            {docTotal} result{docTotal !== 1 ? 's' : ''} · {searchType === 'fulltext' ? 'full-text search' : 'keyword match'}
            {query && <span> for &ldquo;{query}&rdquo;</span>}
          </div>
        )}
        {docs.length === 0 && !loading && (
          <div className="text-center py-16 text-muted-foreground">
            <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">{isSearch ? 'No documents match your search.' : 'No documents collected yet.'}</p>
          </div>
        )}
        {docs.map((doc) => (
          <button key={doc.id} onClick={() => openReader(doc.id)}
            className="w-full text-left rounded-xl border border-border/50 bg-card/50 backdrop-blur p-4 hover:border-primary/30 hover:shadow-md transition-all group">
            <div className="flex items-start gap-3">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${sourceColor(doc.source).split(' ')[0]}`}>
                {(() => { const S = SOURCES.find(s => s.key === doc.source); return S ? <S.icon className="w-4 h-4" /> : <FileText className="w-4 h-4" />; })()}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold group-hover:text-primary transition truncate">{doc.title}</h3>
                {doc.snippet ? (
                  <div className="text-xs text-muted-foreground mt-1 line-clamp-2 search-snippet" dangerouslySetInnerHTML={{ __html: doc.snippet }} />
                ) : doc.aiSummary ? (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{doc.aiSummary}</p>
                ) : doc.description ? (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{doc.description}</p>
                ) : null}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${sourceColor(doc.source)}`}>{doc.source.replace(/_/g, ' ')}</span>
                  <span className="text-[11px] text-muted-foreground">{fmtDate(doc.publishedDate)}</span>
                  {doc.pageCount && <span className="text-[11px] text-muted-foreground">{doc.pageCount} pages</span>}
                  {doc.fileSizeBytes && <span className="text-[11px] text-muted-foreground">{fmtSize(doc.fileSizeBytes)}</span>}
                  {doc.aiTopics?.length > 0 && doc.aiTopics.slice(0, 3).map((t, i) => (
                    <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">{t}</span>
                  ))}
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-primary transition mt-1 shrink-0" />
            </div>
          </button>
        ))}
        {/* Pagination */}
        {docTotal > LIMIT && (
          <div className="flex items-center justify-center gap-3 pt-4">
            <button onClick={() => isSearch ? doSearch(query, offset - LIMIT) : setOffset(o => o - LIMIT)}
              disabled={offset === 0} className="px-4 py-2 text-sm rounded-lg border border-border/50 hover:bg-muted/50 disabled:opacity-30 disabled:cursor-not-allowed transition">
              Previous
            </button>
            <span className="text-xs text-muted-foreground">{offset + 1}–{Math.min(offset + LIMIT, docTotal)} of {docTotal}</span>
            <button onClick={() => isSearch ? doSearch(query, offset + LIMIT) : setOffset(o => o + LIMIT)}
              disabled={offset + LIMIT >= docTotal} className="px-4 py-2 text-sm rounded-lg border border-border/50 hover:bg-muted/50 disabled:opacity-30 disabled:cursor-not-allowed transition">
              Next
            </button>
          </div>
        )}
      </div>
    );
  };

  // ──────────────── Render: Reader ────────────────
  const renderReader = () => {
    if (!currentDoc) return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin" /></div>;

    return (
      <div className="space-y-6">
        {/* Back button */}
        <button onClick={() => { setView(query ? 'search' : 'browse'); setCurrentDoc(null); }}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        {/* Document header */}
        <div className="rounded-xl border border-border/50 bg-card/50 backdrop-blur p-6 space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <span className={`inline-block text-[10px] px-2 py-0.5 rounded font-medium mb-2 ${sourceColor(currentDoc.source)}`}>{currentDoc.source.replace(/_/g, ' ')}</span>
              <h1 className="text-xl font-bold leading-tight">{currentDoc.title}</h1>
            </div>
            {currentDoc.pdfUrl && (
              <a href={currentDoc.pdfUrl} target="_blank" rel="noopener noreferrer"
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg border border-border/50 hover:bg-muted/50 transition">
                <FileDown className="w-3.5 h-3.5" /> PDF
              </a>
            )}
          </div>
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span>Published: {fmtDate(currentDoc.publishedDate)}</span>
            {currentDoc.pageCount && <span>{currentDoc.pageCount} pages</span>}
            {currentDoc.fileSizeBytes && <span>{fmtSize(currentDoc.fileSizeBytes)}</span>}
            <span>Collected: {fmtAgo(currentDoc.fetchedAt)}</span>
          </div>
          {currentDoc.aiTopics?.length > 0 && (
            <div className="flex flex-wrap gap-1.5">{currentDoc.aiTopics.map((t: string, i: number) => (
              <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">{t}</span>
            ))}</div>
          )}
          {currentDoc.aiSummary && (
            <div className="rounded-lg bg-primary/5 border border-primary/10 p-4">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-primary mb-1.5"><Sparkles className="w-3.5 h-3.5" /> AI Summary</div>
              <p className="text-sm leading-relaxed">{currentDoc.aiSummary}</p>
            </div>
          )}
        </div>

        <div className="grid md:grid-cols-4 gap-6">
          {/* Full text content */}
          <div className="md:col-span-3 rounded-xl border border-border/50 bg-card/50 backdrop-blur p-6">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Full Document Text</h3>
            {currentDoc.content ? (
              <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap text-sm leading-relaxed font-mono/80">{currentDoc.content}</div>
            ) : (
              <p className="text-sm text-muted-foreground">No text extracted for this document.</p>
            )}
          </div>

          {/* Sidebar: Entities + AI Ask */}
          <div className="space-y-6">
            {/* Entities */}
            {docEntities.length > 0 && (
              <div className="rounded-xl border border-border/50 bg-card/50 backdrop-blur p-5">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Extracted Entities</h3>
                <div className="space-y-2">
                  {docEntities.slice(0, 30).map((e: any) => {
                    const Icon = ENTITY_ICONS[e.entityType] || Hash;
                    const color = ENTITY_COLORS[e.entityType] || 'text-gray-400 bg-gray-500/10';
                    return (
                      <div key={e.id} className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-medium ${color}`}>
                        <Icon className="w-3 h-3" />{e.name}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* AI Ask */}
            <div className="rounded-xl border border-border/50 bg-card/50 backdrop-blur p-5">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5"><Bot className="w-3.5 h-3.5" /> Ask About This Document</h3>
              <div className="flex gap-2">
                <input value={aiQuestion} onChange={e => setAiQuestion(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && askAI()}
                  placeholder="e.g. What appointments were made?"
                  className="flex-1 px-3 py-2 text-xs rounded-lg border border-border/50 bg-background focus:outline-none focus:ring-1 focus:ring-primary/50" />
                <button onClick={askAI} disabled={aiLoading || !aiQuestion.trim()}
                  className="px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition">
                  {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                </button>
              </div>
              {aiAnswer && (
                <div className="mt-3 text-xs leading-relaxed whitespace-pre-wrap p-3 rounded-lg bg-primary/5 border border-primary/10">{aiAnswer}</div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ──────────────── Main render ────────────────
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <button onClick={() => { setView('overview'); setQuery(''); setSearchInput(''); }} className="flex items-center gap-2.5 hover:opacity-80 transition">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Landmark className="w-4.5 h-4.5 text-primary-foreground" />
            </div>
            <div>
              <div className="text-sm font-bold tracking-tight leading-none">KE GovVault</div>
              <div className="text-[10px] text-muted-foreground leading-none mt-0.5">Kenya Government Document Intelligence</div>
            </div>
          </button>

          {/* Search bar */}
          <div className="flex-1 max-w-md mx-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input id="main-search" value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') doSearch(searchInput); }}
                placeholder="Search full document text... (press / to focus)"
                className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-border/50 bg-muted/30 focus:outline-none focus:ring-1 focus:ring-primary/50 focus:bg-background transition placeholder:text-muted-foreground/60" />
              {searchInput && (
                <button onClick={() => { setSearchInput(''); setQuery(''); if (view === 'search') setView('browse'); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2"><X className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" /></button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => { fetchStats(); if (view === 'browse') fetchDocuments(sourceFilter, 0); }}
              className="p-2 rounded-lg hover:bg-muted/50 text-muted-foreground hover:text-foreground transition" title="Refresh">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Source tabs (hidden in reader view) */}
        {view !== 'reader' && (
          <div className="max-w-7xl mx-auto px-4 pb-0">
            <div className="flex gap-1 overflow-x-auto pb-2 -mb-px scrollbar-none">
              {SOURCES.map(s => (
                <button key={s.key} onClick={() => { setSourceFilter(s.key); setOffset(0); setView('browse'); setQuery(''); setSearchInput(''); }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-t-lg border border-b-0 border-border/50 transition whitespace-nowrap ${sourceFilter === s.key ? 'bg-card text-foreground border-border' : 'text-muted-foreground hover:text-foreground hover:bg-muted/30 border-transparent'}`}>
                  <s.icon className="w-3 h-3" /> {s.label}
                  {stats?.bySource?.find((b: any) => b.source === s.key) && (
                    <span className="text-[10px] opacity-60">{stats.bySource.find((b: any) => b.source === s.key).count}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </header>

      {/* Main content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6">
        {loading && <div className="flex items-center justify-center py-4 mb-4"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}
        {view === 'overview' && renderOverview()}
        {view === 'browse' && renderDocList(documents, total)}
        {view === 'search' && renderDocList(searchResults, searchTotal)}
        {view === 'reader' && renderReader()}
      </main>

      {/* Footer */}
      <footer className="border-t border-border/50 py-4 text-center text-[11px] text-muted-foreground">
        KE GovVault · Kenya Government Document Intelligence · {new Date().getFullYear()}
      </footer>
    </div>
  );
}