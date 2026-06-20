import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Calendar, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  ChevronUp, ChevronDown, ChevronsUpDown, Filter, RefreshCw, Search, X, Printer,
} from 'lucide-react';
import { vouchersApi } from '../services/api';
import { useToast } from '../components/Toast/Toast';

const fmt = (n: any) =>
  Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtQty = (n: any) =>
  Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 3 });

const toInputDate = (d: Date) => d.toISOString().split('T')[0];
const displayDate = (s?: string | null) => {
  if (!s) return '—';
  const d = new Date(s);
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
};

type Row = {
  item_id: number;
  item_name: string;
  group_name: string | null;
  gst: number | null;
  opening_qty: number;
  opening_value: number;
  inward_qty: number;
  inward_value: number;
  outward_qty: number;
  outward_value: number;
  closing_qty: number;
  closing_value: number;
};
type SortKey =
  | 'item_name' | 'group_name'
  | 'opening_qty' | 'inward_qty' | 'outward_qty' | 'closing_qty' | 'closing_value';
type SortDir = 'asc' | 'desc';
const PAGE_SIZES = [10, 25, 50, 100];
const STORAGE_KEY = 'stock-summary-filters';

function fyBounds(d: Date) {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return { from: new Date(y, 3, 1), to: new Date(y + 1, 2, 31) };
}
function defaultFilters() {
  const today = new Date();
  const { from } = fyBounds(today);
  return { dateFrom: toInputDate(from), dateTo: toInputDate(today), search: '' };
}

export default function StockSummary() {
  const navigate = useNavigate();
  const { showError } = useToast();
  const initial = (() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return { ...defaultFilters(), ...JSON.parse(saved) };
    } catch { /* ignore */ }
    return defaultFilters();
  })();

  const [dateFrom, setDateFrom] = useState<string>(initial.dateFrom);
  const [dateTo, setDateTo]     = useState<string>(initial.dateTo);
  const [search, setSearch]     = useState<string>(initial.search);
  const [debouncedSearch, setDebouncedSearch] = useState<string>(initial.search);
  // Hide rows that are pure zero (no opening, no movement, no closing) so
  // the report stays focused on items that actually moved.
  const [hideZero, setHideZero] = useState<boolean>(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState({ opening_value: 0, inward_value: 0, outward_value: 0, closing_value: 0 });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ dateFrom, dateTo, search })); } catch { /* ignore */ }
  }, [dateFrom, dateTo, search]);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const [sortKey, setSortKey] = useState<SortKey>('item_name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(10);
  const [showControls, setShowControls] = useState(false);
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
      const res = await vouchersApi.getStockSummary({
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        search: debouncedSearch || undefined,
      });
      if (res.success) {
        setRows(res.data.rows || []);
        setTotals({
          opening_value: res.data.totals?.opening_value || 0,
          inward_value:  res.data.totals?.inward_value  || 0,
          outward_value: res.data.totals?.outward_value || 0,
          closing_value: res.data.totals?.closing_value || 0,
        });
      }
    } catch { showError('Error', 'Failed to load Stock Summary'); }
    finally { setLoading(false); }
  }, [dateFrom, dateTo, debouncedSearch, showError]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [debouncedSearch, dateFrom, dateTo, pageSize, sortKey, sortDir, hideZero]);

  const filtered = useMemo(() => {
    if (!hideZero) return rows;
    return rows.filter(r =>
      Math.abs(r.opening_qty)   > 0.0005
      || Math.abs(r.inward_qty)  > 0.0005
      || Math.abs(r.outward_qty) > 0.0005
      || Math.abs(r.closing_qty) > 0.0005,
    );
  }, [rows, hideZero]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      const av = (a as any)[sortKey];
      const bv = (b as any)[sortKey];
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av ?? '').localeCompare(String(bv ?? '')) * dir;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const totalRows = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, totalRows);
  const pageRows = printing ? sorted : sorted.slice(startIdx, endIdx);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('asc'); }
  };
  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ChevronsUpDown size={11} className="inline-block ml-1 text-slate-400" />;
    return sortDir === 'asc'
      ? <ChevronUp size={11} className="inline-block ml-1 text-blue-600" />
      : <ChevronDown size={11} className="inline-block ml-1 text-blue-600" />;
  };

  const cell = 'border border-slate-300 px-2.5 py-1.5 text-[13px] leading-snug';
  const cellNum = `${cell} text-right tabular-nums whitespace-nowrap`;
  const headCell = 'border border-slate-400 bg-slate-200 px-2 py-1.5 text-[12px] font-bold text-slate-700 uppercase tracking-wide sticky top-0 z-10';
  const headBtn = 'flex items-center select-none cursor-pointer hover:text-blue-700';

  return (
    <div className="flex flex-col w-full fixed left-0 right-0 top-14 bottom-16 sm:static sm:h-full sm:top-auto sm:bottom-auto" style={{ overscrollBehavior: "contain" }}>
      <div className="print-only mb-3 px-3" aria-hidden>
        <h1 className="text-xl font-bold mb-1">Stock Summary</h1>
        <div className="text-sm">From {displayDate(dateFrom)} to {displayDate(dateTo)}</div>
      </div>

      {/* ── Header bar ── */}
      <div className="flex-none bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between print:hidden">
        <div className="flex items-center gap-1">
          <button onClick={() => navigate(-1)} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 -ml-1" title="Back">
            <ChevronLeft size={20} />
          </button>
          <h1 className="text-[17px] font-bold text-slate-800">Stock Summary</h1>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setShowControls(v => !v)}
            className={`p-2 rounded-lg transition-colors ${showControls ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
            title="Search & Filters">
            <Search size={18} />
          </button>
          <button onClick={handlePrint} disabled={rows.length === 0}
            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-40"
            title="Print">
            <Printer size={16} />
          </button>
          <button onClick={load} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100" title="Refresh">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ── Search & filter panel (slide-down) ── */}
      {showControls && (
        <div className="flex-none bg-slate-50 border-b border-slate-200 px-3 py-2.5 print:hidden">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[140px]">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Item / group…"
                autoFocus
                className="pl-9 pr-7 py-2 border border-slate-300 rounded-lg text-[13px] w-full outline-none focus:ring-2 focus:ring-blue-300 bg-white" />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  <X size={12} />
                </button>
              )}
            </div>
            <div className="flex items-stretch border border-slate-300 rounded-lg bg-white overflow-hidden">
              <div className="flex items-center gap-1 px-2 border-r border-slate-300 bg-slate-100">
                <Calendar size={12} className="text-slate-400" />
                <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wide">From</span>
              </div>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="text-[13px] text-slate-700 outline-none bg-transparent px-2 py-1.5 w-[115px]" />
              <div className="flex items-center px-2 border-l border-r border-slate-300 bg-slate-100">
                <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wide">To</span>
              </div>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="text-[13px] text-slate-700 outline-none bg-transparent px-2 py-1.5 w-[115px]" />
            </div>
            <label className="flex items-center gap-1.5 px-3 py-2 border border-slate-300 rounded-lg bg-white text-[13px] text-slate-600 cursor-pointer whitespace-nowrap">
              <input type="checkbox" checked={hideZero} onChange={e => setHideZero(e.target.checked)} className="cursor-pointer" />
              Hide zero
            </label>
          </div>
        </div>
      )}


      {/* ── Mobile flat list (hidden on sm+) ── */}
      <div className="sm:hidden flex-1 min-h-0 overflow-auto bg-white" style={{ overscrollBehavior: "contain" }}>
        {loading ? (
          <div className="text-center text-gray-400 py-8 text-[13px]">Loading…</div>
        ) : pageRows.length === 0 ? (
          <div className="text-center text-gray-400 py-8 text-[13px]">No items match the current filter</div>
        ) : (
          <>
            {pageRows.map((r) => (
              <div key={r.item_id} className="border-b border-gray-100 px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-gray-900 text-[14px] leading-snug">{r.item_name}</div>
                    <div className="text-[11px] text-gray-400 mt-0.5">{r.group_name || '—'}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className={`text-[14px] font-bold tabular-nums ${r.closing_value < 0 ? 'text-red-600' : 'text-blue-700'}`}>
                      ₹{fmt(r.closing_value)}
                    </div>
                    <div className="text-[11px] text-gray-400 tabular-nums mt-0.5">{fmtQty(r.closing_qty)} qty</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-400">
                  <span>Op: {fmtQty(r.opening_qty)}</span>
                  <span className="text-emerald-600">In: {fmtQty(r.inward_qty)}/{fmt(r.inward_value)}</span>
                  <span className="text-red-500">Out: {fmtQty(r.outward_qty)}/{fmt(r.outward_value)}</span>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* ── Desktop table (hidden on mobile) ── */}
      <div className="hidden sm:block flex-1 min-h-0 overflow-auto bg-white border-x border-b border-slate-300 mx-3 mb-3 print:mx-0 print:overflow-visible print:max-h-none print:border-slate-400">
        <table className="border-collapse text-[13px] w-full">
          <thead>
            <tr>
              <th className={`${headCell} text-left`} rowSpan={2}>
                <div className={headBtn} onClick={() => toggleSort('item_name')}>Item<SortIcon col="item_name" /></div>
              </th>
              <th className={`${headCell} text-left w-32`} rowSpan={2}>
                <div className={headBtn} onClick={() => toggleSort('group_name')}>Group<SortIcon col="group_name" /></div>
              </th>
              <th className={`${headCell} text-center`} colSpan={2}>Opening</th>
              <th className={`${headCell} text-center`} colSpan={2}>Inward</th>
              <th className={`${headCell} text-center`} colSpan={2}>Outward</th>
              <th className={`${headCell} text-center`} colSpan={2}>Closing</th>
            </tr>
            <tr>
              <th className={`${headCell} text-right w-24`}>
                <div className={headBtn + ' justify-end'} onClick={() => toggleSort('opening_qty')}>Qty<SortIcon col="opening_qty" /></div>
              </th>
              <th className={`${headCell} text-right w-28`}>Value</th>
              <th className={`${headCell} text-right w-24`}>
                <div className={headBtn + ' justify-end'} onClick={() => toggleSort('inward_qty')}>Qty<SortIcon col="inward_qty" /></div>
              </th>
              <th className={`${headCell} text-right w-28`}>Value</th>
              <th className={`${headCell} text-right w-24`}>
                <div className={headBtn + ' justify-end'} onClick={() => toggleSort('outward_qty')}>Qty<SortIcon col="outward_qty" /></div>
              </th>
              <th className={`${headCell} text-right w-28`}>Value</th>
              <th className={`${headCell} text-right w-24`}>
                <div className={headBtn + ' justify-end'} onClick={() => toggleSort('closing_qty')}>Qty<SortIcon col="closing_qty" /></div>
              </th>
              <th className={`${headCell} text-right w-28`}>
                <div className={headBtn + ' justify-end'} onClick={() => toggleSort('closing_value')}>Value<SortIcon col="closing_value" /></div>
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className={`${cell} text-center text-slate-400 py-6`}>Loading…</td></tr>
            ) : pageRows.length === 0 ? (
              <tr><td colSpan={10} className={`${cell} text-center text-slate-400 py-6`}>No items match the current filter</td></tr>
            ) : (
              pageRows.map((r, i) => {
                const rowIdx = printing ? i : startIdx + i;
                const zebra = rowIdx % 2 === 1 ? 'bg-slate-50' : 'bg-white';
                const negativeStock = r.closing_qty < -0.0005;
                return (
                  <tr key={r.item_id} className={`${zebra} hover:bg-blue-50`}>
                    <td className={`${cell} font-medium text-slate-800`}>{r.item_name}</td>
                    <td className={`${cell} text-slate-600 text-[12px]`}>{r.group_name || '—'}</td>
                    <td className={cellNum + ' text-slate-700'}>{r.opening_qty !== 0 ? fmtQty(r.opening_qty) : <span className="text-slate-300">—</span>}</td>
                    <td className={cellNum + ' text-slate-600'}>{r.opening_value !== 0 ? fmt(r.opening_value) : <span className="text-slate-300">—</span>}</td>
                    <td className={cellNum + ' text-emerald-700'}>{r.inward_qty > 0 ? fmtQty(r.inward_qty) : <span className="text-slate-300">—</span>}</td>
                    <td className={cellNum + ' text-emerald-600'}>{r.inward_value > 0 ? fmt(r.inward_value) : <span className="text-slate-300">—</span>}</td>
                    <td className={cellNum + ' text-red-700'}>{r.outward_qty > 0 ? fmtQty(r.outward_qty) : <span className="text-slate-300">—</span>}</td>
                    <td className={cellNum + ' text-red-600'}>{r.outward_value > 0 ? fmt(r.outward_value) : <span className="text-slate-300">—</span>}</td>
                    <td className={cellNum + ' font-semibold ' + (negativeStock ? 'text-red-700' : 'text-blue-700')}>
                      {r.closing_qty !== 0 ? fmtQty(r.closing_qty) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className={cellNum + ' font-semibold ' + (negativeStock ? 'text-red-700' : 'text-blue-700')}>
                      {r.closing_value !== 0 ? fmt(r.closing_value) : <span className="text-slate-300">—</span>}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {totalRows > 0 && (
            <tfoot>
              <tr className="bg-slate-200 font-bold sticky bottom-0">
                <td colSpan={3} className={`${cell} text-slate-700`}>Total ({totalRows} items)</td>
                <td className={cellNum + ' text-slate-700'}>{fmt(totals.opening_value)}</td>
                <td className={cell} />
                <td className={cellNum + ' text-emerald-700'}>{fmt(totals.inward_value)}</td>
                <td className={cell} />
                <td className={cellNum + ' text-red-700'}>{fmt(totals.outward_value)}</td>
                <td className={cell} />
                <td className={cellNum + ' text-blue-700'}>{fmt(totals.closing_value)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Mobile — Grand Total fixed above pagination */}
      {!printing && totalRows > 0 && (
        <div className="sm:hidden flex-none border-t border-gray-200 print:hidden">
          <div className="bg-blue-700 text-white px-4 py-2.5 flex justify-between items-center">
            <span className="font-bold text-sm tracking-widest">GRAND TOTAL</span>
            <span className="text-sm tabular-nums font-semibold">{totalRows} items</span>
          </div>
          <div className="flex divide-x divide-gray-200 bg-white">
            <div className="flex-1 px-3 py-2.5">
              <div className="text-[10px] uppercase text-gray-400 font-bold tracking-wide">Opening</div>
              <div className="text-[13px] font-bold text-slate-700 tabular-nums mt-0.5">₹{fmt(totals.opening_value)}</div>
            </div>
            <div className="flex-1 px-3 py-2.5">
              <div className="text-[10px] uppercase text-gray-400 font-bold tracking-wide">Inward</div>
              <div className="text-[13px] font-bold text-emerald-700 tabular-nums mt-0.5">₹{fmt(totals.inward_value)}</div>
            </div>
            <div className="flex-1 px-3 py-2.5">
              <div className="text-[10px] uppercase text-gray-400 font-bold tracking-wide">Outward</div>
              <div className="text-[13px] font-bold text-red-600 tabular-nums mt-0.5">₹{fmt(totals.outward_value)}</div>
            </div>
            <div className="flex-1 px-3 py-2.5">
              <div className="text-[10px] uppercase text-gray-400 font-bold tracking-wide">Closing</div>
              <div className="text-[13px] font-bold text-blue-700 tabular-nums mt-0.5">₹{fmt(totals.closing_value)}</div>
            </div>
          </div>
        </div>
      )}

      {/* Pagination — flex-none keeps it at bottom */}
      {!printing && totalRows > pageSize && (
        <div className="flex-none flex items-center justify-between gap-2 px-3 py-1.5 border-t border-slate-200 bg-slate-50 text-[13px] text-slate-700 print:hidden">
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline">Rows per page:</span>
            <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))}
              className="border border-slate-300 rounded px-1.5 py-0.5 bg-white">
              {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="tabular-nums">{`${startIdx + 1}–${endIdx} of ${totalRows}`}</div>
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

function Stat({ label, value, color, bold }: { label: string; value: number; color: string; bold?: boolean }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-r border-slate-300">
      <span className="text-slate-500 uppercase text-[11px] font-bold tracking-wide">{label}</span>
      <span className={`tabular-nums ${bold ? 'font-bold' : 'font-semibold'} ${color}`}>{fmt(value)}</span>
    </div>
  );
}
