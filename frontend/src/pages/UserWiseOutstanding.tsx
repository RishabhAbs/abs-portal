import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Calendar, ChevronUp, ChevronDown, ChevronsUpDown,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  Filter, RefreshCw, Search, X, Printer, Users as UsersIcon,
} from 'lucide-react';
import { vouchersApi } from '../services/api';
import { useToast } from '../components/Toast/Toast';

const fmt = (n: any) =>
  Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = (n: any) =>
  Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const toInputDate = (d: Date) => d.toISOString().split('T')[0];
const displayDate = (s?: string | null) => {
  if (!s) return 'today';
  const d = new Date(s);
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
};

type Row = {
  user_name: string;
  bill_count: number;
  total_due: number;
  due_0_15: number;
  due_16_30: number;
  due_30_plus: number;
};
type SortKey = 'user_name' | 'bill_count' | 'total_due' | 'due_0_15' | 'due_16_30' | 'due_30_plus';
type SortDir = 'asc' | 'desc';
const STORAGE_KEY = 'user-wise-outstanding-filters';

export default function UserWiseOutstanding() {
  const navigate = useNavigate();
  const { showError } = useToast();
  const initial = (() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch { /* ignore */ }
    return { asOf: toInputDate(new Date()), search: '' };
  })();

  // "as_of" defaults to today — receivables age relative to this date.
  const [asOf, setAsOf]     = useState<string>(initial.asOf || toInputDate(new Date()));
  const [search, setSearch] = useState<string>(initial.search || '');
  const [debouncedSearch, setDebouncedSearch] = useState<string>(initial.search || '');
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState({ bill_count: 0, total_due: 0, due_0_15: 0, due_16_30: 0, due_30_plus: 0 });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ asOf, search })); } catch { /* ignore */ }
  }, [asOf, search]);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const [sortKey, setSortKey] = useState<SortKey>('total_due');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  // 10 rows per page — reset whenever the dataset shape changes so the
  // user never lands on a now-empty page.
  const PAGE_SIZE = 10;
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [debouncedSearch, asOf, sortKey, sortDir]);
  const [showStats, setShowStats] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const onAfter = () => setPrinting(false);
    window.addEventListener('afterprint', onAfter);
    return () => window.removeEventListener('afterprint', onAfter);
  }, []);
  const handlePrint = () => {
    if (rows.length === 0) return;
    setPrinting(true);
    setTimeout(() => window.print(), 50);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await vouchersApi.getUserWiseOutstanding({
        as_of: asOf || undefined,
        search: debouncedSearch || undefined,
      });
      if (res.success) {
        setRows(res.data.rows || []);
        setTotals({
          bill_count:  res.data.totals?.bill_count  || 0,
          total_due:   res.data.totals?.total_due   || 0,
          due_0_15:    res.data.totals?.due_0_15    || 0,
          due_16_30:   res.data.totals?.due_16_30   || 0,
          due_30_plus: res.data.totals?.due_30_plus || 0,
        });
      }
    } catch { showError('Error', 'Failed to load User-wise Outstanding'); }
    finally { setLoading(false); }
  }, [asOf, debouncedSearch, showError]);

  useEffect(() => { load(); }, [load]);

  const sorted = useMemo(() => {
    const arr = [...rows];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      const av = (a as any)[sortKey];
      const bv = (b as any)[sortKey];
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av ?? '').localeCompare(String(bv ?? '')) * dir;
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('desc'); }
  };
  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ChevronsUpDown size={11} className="inline-block ml-1 text-slate-400" />;
    return sortDir === 'asc'
      ? <ChevronUp size={11} className="inline-block ml-1 text-blue-600" />
      : <ChevronDown size={11} className="inline-block ml-1 text-blue-600" />;
  };

  const cell = 'border border-slate-300 px-2.5 py-1.5 text-[14px] leading-snug';
  const cellNum = `${cell} text-right tabular-nums whitespace-nowrap`;
  const headCell = 'border border-slate-400 bg-slate-200 px-2.5 py-1.5 text-[13px] font-bold text-slate-700 uppercase tracking-wide sticky top-0 z-10';
  const headBtn = 'flex items-center select-none cursor-pointer hover:text-blue-700';

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * PAGE_SIZE;
  const endIdx = Math.min(startIdx + PAGE_SIZE, sorted.length);
  const pageRows = printing ? sorted : sorted.slice(startIdx, endIdx);

  return (
    <div className="flex flex-col h-[calc(100vh-56px)] md:h-[calc(100vh-72px)] w-full">
      <div className="print-only mb-3 px-3" aria-hidden>
        <h1 className="text-xl font-bold mb-1">User-wise Pending Payment</h1>
        <div className="text-sm">As of {displayDate(asOf)}</div>
      </div>

      {/* ── Header bar ── */}
      <div className="flex-none bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between print:hidden">
        <div className="flex items-center gap-1">
          <button onClick={() => navigate(-1)} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 -ml-1" title="Back">
            <ChevronLeft size={20} />
          </button>
          <h1 className="text-[17px] font-bold text-slate-800">User-wise Outstanding</h1>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setShowControls(s => !s); setShowFilter(false); }}
            className={`p-2 rounded-lg transition-colors ${showControls ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
            title="Search"
          >
            <Search size={18} />
          </button>
          <button
            onClick={() => { setShowFilter(s => !s); setShowControls(false); }}
            className={`p-2 rounded-lg transition-colors ${showFilter ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
            title="Date Filter"
          >
            <Filter size={18} />
          </button>
          <button onClick={handlePrint} disabled={rows.length === 0}
            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-40"
            title="Print"
          >
            <Printer size={16} />
          </button>
          <button onClick={load}
            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"
            title="Refresh"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ── Stats bar (permanent) ── */}
      <div className="flex-none bg-white border-b border-slate-200 print:hidden">
        <div className="flex divide-x divide-slate-200">
          <div className="flex-1 px-3 py-2.5">
            <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">Total Due</div>
            <div className="text-[14px] font-bold text-blue-700 tabular-nums mt-0.5">{fmt(totals.total_due)}</div>
          </div>
          <div className="flex-1 px-3 py-2.5">
            <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">30d+</div>
            <div className="text-[14px] font-bold text-red-600 tabular-nums mt-0.5">{fmt(totals.due_30_plus)}</div>
          </div>
          <div className="px-3 py-2.5 flex flex-col items-end justify-center">
            <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">Bills</div>
            <div className="text-[14px] font-bold text-slate-700 tabular-nums mt-0.5">{totals.bill_count}</div>
          </div>
        </div>
      </div>

      {/* ── Search bar (slide-down) ── */}
      {showControls && (
        <div className="flex-none bg-slate-50 border-b border-slate-200 px-3 py-2.5 print:hidden">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search user name…"
              autoFocus
              className="w-full pl-8 pr-8 py-2.5 border border-slate-300 rounded-lg text-[14px] outline-none focus:ring-2 focus:ring-blue-300 bg-white" />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Filter panel (slide-down) ── */}
      {showFilter && (
        <div className="flex-none bg-slate-50 border-b border-slate-200 px-3 py-3 print:hidden">
          <div className="flex gap-2">
            <div className="flex-1 flex items-stretch border border-slate-300 rounded-lg bg-white overflow-hidden">
              <div className="flex items-center px-2 border-r border-slate-300 bg-slate-100">
                <Calendar size={12} className="text-slate-400 mr-1" />
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wide">As of</span>
              </div>
              <input type="date" value={asOf} onChange={e => setAsOf(e.target.value)}
                className="flex-1 text-[13px] text-slate-700 outline-none bg-transparent px-2 py-2 min-w-0" />
            </div>
            <button onClick={() => setAsOf(toInputDate(new Date()))}
              className="px-3 py-2 border border-slate-300 rounded-lg bg-white text-[13px] text-slate-600 hover:bg-slate-100">
              Today
            </button>
          </div>
        </div>
      )}

      {/* Desktop print stats (visible on sm+) */}
      <div className="hidden sm:block flex-none border-b border-slate-200 print:hidden">
        <div className="flex items-center gap-4 px-4 py-2 text-[13px] text-slate-600 bg-slate-50">
          <div className="hidden sm:flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="User name…"
                className="pl-7 pr-7 py-1.5 border border-slate-300 rounded text-[13px] w-44 outline-none focus:ring-1 focus:ring-blue-300 bg-white" />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700"><X size={12} /></button>
              )}
            </div>
            <div className="flex items-stretch border border-slate-300 rounded bg-white overflow-hidden">
              <div className="flex items-center gap-1 px-2 border-r border-slate-300 bg-slate-50">
                <Calendar size={12} className="text-slate-400" />
                <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wide">As of</span>
              </div>
              <input type="date" value={asOf} onChange={e => setAsOf(e.target.value)}
                className="text-[13px] text-slate-700 outline-none bg-transparent px-2 py-1.5 w-[125px]" />
            </div>
            <button onClick={() => setAsOf(toInputDate(new Date()))}
              className="px-2 py-1.5 border border-slate-300 rounded hover:bg-slate-50 bg-white text-[12px] text-slate-600">Today</button>
          </div>
        </div>
      </div>

      {/* ── Mobile flat list (hidden on sm+) ── */}
      <div className="sm:hidden flex-1 min-h-0 overflow-auto bg-white">
        {loading ? (
          <div className="text-center text-gray-400 py-8 text-[13px]">Loading…</div>
        ) : pageRows.length === 0 ? (
          <div className="text-center text-gray-400 py-8 text-[13px]">No outstanding receivables as of {displayDate(asOf)}</div>
        ) : (
          <>
            {pageRows.map((u, i) => {
              const rowIdx = printing ? i : startIdx + i;
              return (
                <div key={u.user_name + '-' + rowIdx} className="border-b border-gray-200">
                  <div className="flex items-start justify-between px-4 py-3">
                    <div className="flex-1 min-w-0 pr-3">
                      <div className="font-bold text-gray-900 text-[15px] uppercase leading-snug">{u.user_name}</div>
                      <div className="text-[13px] text-gray-500 mt-0.5">{u.bill_count} bills</div>
                      <div className="text-[13px] text-gray-500 mt-0.5">
                        0-15d: ₹{fmt(u.due_0_15)}&nbsp;&nbsp;16-30d: ₹{fmt(u.due_16_30)}&nbsp;&nbsp;30+d: ₹{fmt(u.due_30_plus)}
                      </div>
                    </div>
                    <div className="text-[15px] font-medium text-gray-900 tabular-nums whitespace-nowrap">
                      ₹{fmt(u.total_due)}
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* ── Desktop table (hidden on mobile) ── */}
      <div className="hidden sm:block flex-1 min-h-0 overflow-auto bg-white border-x border-b border-slate-300 mx-3 mb-3 print:mx-0 print:overflow-visible print:max-h-none print:border-slate-400">
        <table className="border-collapse text-[14px] w-full">
          <thead>
            <tr>
              <th className={`${headCell} text-center w-10`}>#</th>
              <th className={`${headCell} text-left`}>
                <div className={headBtn} onClick={() => toggleSort('user_name')}>User<SortIcon col="user_name" /></div>
              </th>
              <th className={`${headCell} text-right w-20`}>
                <div className={headBtn + ' justify-end'} onClick={() => toggleSort('bill_count')}>Bill<SortIcon col="bill_count" /></div>
              </th>
              <th className={`${headCell} text-right w-36`}>
                <div className={headBtn + ' justify-end'} onClick={() => toggleSort('total_due')}>Total Due<SortIcon col="total_due" /></div>
              </th>
              <th className={`${headCell} text-right w-32`}>
                <div className={headBtn + ' justify-end'} onClick={() => toggleSort('due_0_15')}>Due 0-15<SortIcon col="due_0_15" /></div>
              </th>
              <th className={`${headCell} text-right w-32`}>
                <div className={headBtn + ' justify-end'} onClick={() => toggleSort('due_16_30')}>Due 16-30<SortIcon col="due_16_30" /></div>
              </th>
              <th className={`${headCell} text-right w-32`}>
                <div className={headBtn + ' justify-end'} onClick={() => toggleSort('due_30_plus')}>Due 30+<SortIcon col="due_30_plus" /></div>
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className={`${cell} text-center text-slate-400 py-6`}>Loading…</td></tr>
            ) : sorted.length === 0 ? (
              <tr><td colSpan={7} className={`${cell} text-center text-slate-400 py-6`}>No outstanding receivables as of {displayDate(asOf)}</td></tr>
            ) : (
              pageRows.map((u, i) => {
                const rowIdx = printing ? i : startIdx + i;
                const zebra = rowIdx % 2 === 1 ? 'bg-slate-50' : 'bg-white';
                return (
                  <tr key={u.user_name + '-' + rowIdx} className={`${zebra} hover:bg-blue-50`}>
                    <td className={`${cell} text-center text-slate-400 bg-slate-100 tabular-nums`}>{rowIdx + 1}</td>
                    <td className={`${cell} font-medium text-slate-800`}>{u.user_name}</td>
                    <td className={cellNum + ' text-slate-700'}>{fmt0(u.bill_count)}</td>
                    <td className={cellNum + ' text-blue-700 font-semibold'}>{fmt(u.total_due)}</td>
                    <td className={cellNum + ' text-emerald-700'}>{u.due_0_15 > 0 ? fmt(u.due_0_15) : <span className="text-slate-300">—</span>}</td>
                    <td className={cellNum + ' text-amber-700'}>{u.due_16_30 > 0 ? fmt(u.due_16_30) : <span className="text-slate-300">—</span>}</td>
                    <td className={cellNum + ' text-red-700'}>{u.due_30_plus > 0 ? fmt(u.due_30_plus) : <span className="text-slate-300">—</span>}</td>
                  </tr>
                );
              })
            )}
          </tbody>
          {sorted.length > 0 && (
            <tfoot>
              <tr className="bg-slate-200 font-bold sticky bottom-0">
                <td className={cell + ' text-slate-500'}>—</td>
                <td className={`${cell} text-slate-700`}>Total ({sorted.length} users)</td>
                <td className={cellNum + ' text-slate-700'}>{fmt0(totals.bill_count)}</td>
                <td className={cellNum + ' text-blue-700'}>{fmt(totals.total_due)}</td>
                <td className={cellNum + ' text-emerald-800'}>{fmt(totals.due_0_15)}</td>
                <td className={cellNum + ' text-amber-800'}>{fmt(totals.due_16_30)}</td>
                <td className={cellNum + ' text-red-800'}>{fmt(totals.due_30_plus)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Mobile — Grand Total fixed above pagination */}
      {!printing && sorted.length > 0 && (
        <div className="sm:hidden flex-none border-t border-gray-200 print:hidden">
          <div className="bg-blue-700 text-white px-4 py-2.5 flex justify-between items-center">
            <span className="font-bold text-sm tracking-widest">GRAND TOTAL</span>
            <span className="text-sm tabular-nums font-semibold">{sorted.length} users · {totals.bill_count} bills</span>
          </div>
          <div className="flex divide-x divide-gray-200 bg-white">
            <div className="flex-1 px-3 py-2.5">
              <div className="text-[10px] uppercase text-gray-400 font-bold tracking-wide">Total Due</div>
              <div className="text-[14px] font-bold text-blue-700 tabular-nums mt-0.5">₹{fmt(totals.total_due)}</div>
            </div>
            <div className="flex-1 px-3 py-2.5">
              <div className="text-[10px] uppercase text-gray-400 font-bold tracking-wide">0-15d</div>
              <div className="text-[14px] font-bold text-emerald-700 tabular-nums mt-0.5">₹{fmt(totals.due_0_15)}</div>
            </div>
            <div className="flex-1 px-3 py-2.5">
              <div className="text-[10px] uppercase text-gray-400 font-bold tracking-wide">30d+</div>
              <div className="text-[14px] font-bold text-red-600 tabular-nums mt-0.5">₹{fmt(totals.due_30_plus)}</div>
            </div>
          </div>
        </div>
      )}

      {/* Pagination — flex-none keeps it fixed at bottom on mobile */}
      {!printing && sorted.length > PAGE_SIZE && (
        <div className="flex-none flex items-center justify-between gap-2 px-3 py-1.5 border-t border-slate-200 bg-slate-50 text-[13px] text-slate-700 print:hidden">
          <div className="tabular-nums">{`${startIdx + 1}–${endIdx} of ${sorted.length}`}</div>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(1)} disabled={safePage === 1} className="p-1 border border-slate-300 rounded bg-white hover:bg-slate-50 disabled:opacity-40"><ChevronsLeft size={14} /></button>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1} className="p-1 border border-slate-300 rounded bg-white hover:bg-slate-50 disabled:opacity-40"><ChevronLeft size={14} /></button>
            <span className="px-2 tabular-nums">Page {safePage} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} className="p-1 border border-slate-300 rounded bg-white hover:bg-slate-50 disabled:opacity-40"><ChevronRight size={14} /></button>
            <button onClick={() => setPage(totalPages)} disabled={safePage === totalPages} className="p-1 border border-slate-300 rounded bg-white hover:bg-slate-50 disabled:opacity-40"><ChevronsRight size={14} /></button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value, color, bg, border }: { label: string; value: string; color: string; bg: string; border: boolean }) {
  return (
    <div className={`flex flex-col items-start px-3 py-2.5 ${bg} ${border ? 'border-r border-slate-200' : ''} sm:flex-1`}>
      <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold leading-none">{label}</span>
      <span className={`tabular-nums font-bold text-[15px] mt-1 leading-none ${color}`}>{value}</span>
    </div>
  );
}
