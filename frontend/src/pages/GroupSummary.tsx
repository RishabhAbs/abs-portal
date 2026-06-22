import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Calendar, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  RefreshCw, Search, X, Printer, ChevronRight as ArrowRight,
} from 'lucide-react';
import { vouchersApi } from '../services/api';
import { useToast } from '../components/Toast/Toast';

const fmt = (n: any) =>
  Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const toInputDate = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
const displayDate = (s?: string | null) => {
  if (!s) return '—';
  const d = new Date(s);
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
};
function fyBounds(d: Date) {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return { from: new Date(y, 3, 1), to: new Date(y + 1, 2, 31) };
}

const STORAGE_KEY = 'group-summary-filters';
const PAGE_SIZE = 50;

type BreadcrumbItem = { id: number; name: string };

type Row = {
  type: 'group' | 'ledger';
  id: number;
  name: string;
  ledger_count?: number;
  opening: number;
  debit: number;
  credit: number;
  closing: number;
};

function defaultFilters() {
  const today = new Date();
  const { from } = fyBounds(today);
  return { dateFrom: toInputDate(from), dateTo: toInputDate(today) };
}

export default function GroupSummary() {
  const navigate = useNavigate();
  const { showError } = useToast();

  const initial = (() => {
    try { const s = localStorage.getItem(STORAGE_KEY); if (s) return { ...defaultFilters(), ...JSON.parse(s) }; }
    catch { /* ignore */ }
    return defaultFilters();
  })();

  const [dateFrom, setDateFrom] = useState(initial.dateFrom);
  const [dateTo, setDateTo]     = useState(initial.dateTo);
  const [search, setSearch]     = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [showControls, setShowControls] = useState(false);
  const [hideZero, setHideZero] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [printing, setPrinting] = useState(false);

  // null = root view (parent groups), otherwise drill-down into a group
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([]);
  const [rows, setRows]   = useState<Row[]>([]);
  const [totals, setTotals] = useState({ debit: 0, credit: 0, balance: 0, opening: 0, closing: 0 });
  const [page, setPage]   = useState(1);

  const currentGroupId = breadcrumb.length > 0 ? breadcrumb[breadcrumb.length - 1].id : null;

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ dateFrom, dateTo })); } catch { /* ignore */ }
  }, [dateFrom, dateTo]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => { setPage(1); }, [currentGroupId, debouncedSearch, dateFrom, dateTo, hideZero]);

  useEffect(() => {
    const onAfter = () => setPrinting(false);
    window.addEventListener('afterprint', onAfter);
    return () => window.removeEventListener('afterprint', onAfter);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setRows([]);
    try {
      if (currentGroupId === null) {
        // Root: top-level parent groups
        const res = await vouchersApi.getGroupSummary({
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          search: debouncedSearch || undefined,
        });
        if (res.success) {
          const mapped: Row[] = (res.data.rows || []).map((g: any) => ({
            type: 'group',
            id: g.group_id,
            name: g.group_name,
            ledger_count: g.ledger_count,
            opening: Number(g.opening) || 0,
            debit: Number(g.total_debit) || 0,
            credit: Number(g.total_credit) || 0,
            closing: Number(g.net_balance) || 0,
          }));
          setRows(mapped);
          setTotals({
            debit:   res.data.totals?.debit   || 0,
            credit:  res.data.totals?.credit  || 0,
            balance: res.data.totals?.balance || 0,
            opening: res.data.totals?.opening || 0,
            closing: res.data.totals?.balance || 0,
          });
        }
      } else {
        // Drill-down: children of currentGroupId
        const res = await vouchersApi.getGroupLedgers(currentGroupId, {
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          search: debouncedSearch || undefined,
        });
        if (res.success) {
          const mapped: Row[] = (res.data.rows || []).map((r: any) => ({
            type: r.row_type === 'subgroup' ? 'group' : 'ledger',
            id: r.row_type === 'subgroup' ? r.group_id : r.ledger_id,
            name: r.ledger_name,
            ledger_count: r.ledger_count,
            opening: Number(r.opening_balance) || 0,
            debit: Number(r.debit_total) || 0,
            credit: Number(r.credit_total) || 0,
            closing: Number(r.closing_balance) || 0,
          }));
          setRows(mapped);
          setTotals({
            opening: res.data.totals?.opening || 0,
            debit:   res.data.totals?.debit   || 0,
            credit:  res.data.totals?.credit  || 0,
            closing: res.data.totals?.closing || 0,
            balance: res.data.totals?.closing || 0,
          });
        }
      }
    } catch { showError('Error', 'Failed to load'); }
    finally { setLoading(false); }
  }, [currentGroupId, dateFrom, dateTo, debouncedSearch, showError]);

  useEffect(() => { load(); }, [load]);

  const drillDown = (row: Row) => {
    if (row.type === 'group') {
      setBreadcrumb(prev => [...prev, { id: row.id, name: row.name }]);
      setSearch('');
    } else {
      navigate(`/reports/ledger?ledger_id=${row.id}`);
    }
  };

  const goToBreadcrumb = (idx: number) => {
    // idx = -1 means root
    setBreadcrumb(prev => idx < 0 ? [] : prev.slice(0, idx + 1));
    setSearch('');
  };

  // Filter + paginate
  const filtered = rows
    .filter(r => !debouncedSearch || r.name.toLowerCase().includes(debouncedSearch.toLowerCase()))
    .filter(r => !hideZero ||
      Math.abs(r.opening) > 0.005 || Math.abs(r.debit) > 0.005 ||
      Math.abs(r.credit)  > 0.005 || Math.abs(r.closing) > 0.005);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages);
  const pageRows   = printing ? filtered : filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const handlePrint = () => {
    if (rows.length === 0) return;
    setPrinting(true);
    setTimeout(() => window.print(), 50);
  };

  const cell    = 'border border-slate-300 px-2.5 py-1.5 text-[13px] leading-snug';
  const cellNum = `${cell} text-right tabular-nums whitespace-nowrap`;
  const headTh  = 'border border-slate-400 bg-slate-200 px-2.5 py-1.5 text-[13px] font-bold text-slate-700 uppercase tracking-wide sticky top-0 z-10';

  const isRoot = currentGroupId === null;

  return (
    <div className="flex flex-col w-full fixed left-0 right-0 top-14 bottom-16 sm:static sm:h-full" style={{ overscrollBehavior: 'contain' }}>

      {/* Header */}
      <div className="flex-none bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between print:hidden">
        <div className="flex items-center gap-1 min-w-0 flex-1">
          <button
            onClick={() => isRoot ? navigate(-1) : goToBreadcrumb(breadcrumb.length - 2)}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 -ml-1 flex-shrink-0">
            <ChevronLeft size={20} />
          </button>
          {/* Breadcrumb */}
          <div className="flex items-center gap-1 min-w-0 flex-wrap">
            <button
              onClick={() => goToBreadcrumb(-1)}
              className={`text-[14px] font-bold truncate ${isRoot ? 'text-slate-800' : 'text-blue-600 hover:underline'}`}>
              Group Summary
            </button>
            {breadcrumb.map((b, i) => (
              <span key={b.id} className="flex items-center gap-1 min-w-0">
                <ArrowRight size={13} className="text-slate-400 flex-shrink-0" />
                <button
                  onClick={() => goToBreadcrumb(i)}
                  className={`text-[14px] font-semibold truncate max-w-[150px] ${
                    i === breadcrumb.length - 1 ? 'text-slate-800' : 'text-blue-600 hover:underline'
                  }`}>
                  {b.name}
                </button>
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => setShowControls(v => !v)}
            className={`p-2 rounded-lg transition-colors ${showControls ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
            <Search size={18} />
          </button>
          <button onClick={handlePrint} disabled={rows.length === 0}
            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-40">
            <Printer size={16} />
          </button>
          <button onClick={load} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Filters */}
      {showControls && (
        <div className="flex-none bg-slate-50 border-b border-slate-200 px-3 py-2.5 print:hidden">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[140px]">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Filter by name…" autoFocus
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

      {/* ── Mobile card list ── */}
      <div className="sm:hidden flex-1 min-h-0 overflow-auto bg-white">
        {loading ? (
          <div className="py-16 text-center text-slate-400 text-sm">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-slate-400 text-sm px-8">
            {debouncedSearch ? `No results for "${debouncedSearch}"` : `No data for ${displayDate(dateFrom)} – ${displayDate(dateTo)}`}
          </div>
        ) : pageRows.map((row) => {
          const isGroup = row.type === 'group';
          const positive = row.closing >= 0;
          return (
            <div key={`${row.type}-${row.id}`}
              onClick={() => drillDown(row)}
              className="border-b border-slate-100 px-4 py-3 active:bg-slate-50">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  {isGroup
                    ? <ArrowRight size={14} className="text-blue-400 flex-shrink-0" />
                    : <span className="w-3 h-3 rounded-full border border-slate-300 flex-shrink-0" />}
                  <span className={`text-[15px] leading-snug truncate ${isGroup ? 'font-bold text-slate-900' : 'text-slate-700'}`}>
                    {row.name}
                  </span>
                </div>
                <div className="shrink-0 text-right">
                  <div className={`text-[16px] font-bold tabular-nums leading-tight ${positive ? 'text-emerald-700' : 'text-red-600'}`}>
                    {Math.abs(row.closing) > 0.005 ? fmt(Math.abs(row.closing)) : '—'}
                  </div>
                  {Math.abs(row.closing) > 0.005 && (
                    <div className={`text-[10px] font-bold tracking-wide ${positive ? 'text-emerald-500' : 'text-red-400'}`}>
                      {positive ? 'DEBIT' : 'CREDIT'}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 mt-1.5 text-[11px] text-slate-400">
                <span>Op: {Math.abs(row.opening) > 0.005 ? `${fmt(Math.abs(row.opening))} ${row.opening > 0 ? 'Dr' : 'Cr'}` : '—'}</span>
                <span className="text-emerald-600">Dr: {row.debit > 0 ? fmt(row.debit) : '—'}</span>
                <span className="text-red-500">Cr: {row.credit > 0 ? fmt(row.credit) : '—'}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Desktop table ── */}
      <div className="hidden sm:block flex-1 min-h-0 overflow-auto bg-white">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className={`${headTh} text-left`}>Particulars</th>
              <th className={headTh}>Opening Balance</th>
              <th className={headTh}>Debit</th>
              <th className={headTh}>Credit</th>
              <th className={headTh}>Closing Balance</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="text-center text-slate-400 py-16 text-[14px]">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} className="text-center text-slate-400 py-16 text-[14px]">
                {debouncedSearch ? `No results for "${debouncedSearch}"` : `No data for ${displayDate(dateFrom)} – ${displayDate(dateTo)}`}
              </td></tr>
            ) : pageRows.map((row) => {
              const isGroup = row.type === 'group';
              const openSign  = row.opening > 0 ? ' Dr' : row.opening < 0 ? ' Cr' : '';
              const closeSign = row.closing > 0 ? ' Dr' : row.closing < 0 ? ' Cr' : '';
              return (
                <tr key={`${row.type}-${row.id}`}
                  onClick={() => drillDown(row)}
                  className="hover:bg-blue-50 cursor-pointer transition-colors bg-white">
                  <td className={`${cell} text-left`}>
                    <div className="flex items-center gap-2">
                      {isGroup
                        ? <ArrowRight size={14} className="text-blue-400 flex-shrink-0" />
                        : <span className="w-3 h-3 rounded-full border border-slate-300 flex-shrink-0" />}
                      <span className={isGroup
                        ? 'font-semibold text-slate-800 text-[13px]'
                        : 'text-slate-700 text-[13px]'}>
                        {row.name}
                      </span>
                    </div>
                  </td>
                  <td className={`${cellNum} text-slate-600`}>
                    {Math.abs(row.opening) > 0.005
                      ? <>{fmt(Math.abs(row.opening))}<span className="text-[10px] text-slate-400 ml-1">{openSign}</span></>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className={`${cellNum} text-emerald-700`}>
                    {row.debit > 0 ? fmt(row.debit) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className={`${cellNum} text-red-600`}>
                    {row.credit > 0 ? fmt(row.credit) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className={`${cellNum} font-semibold ${row.closing > 0 ? 'text-emerald-700' : row.closing < 0 ? 'text-red-600' : 'text-slate-400'}`}>
                    {Math.abs(row.closing) > 0.005
                      ? <>{fmt(Math.abs(row.closing))}<span className="text-[10px] ml-1">{closeSign}</span></>
                      : <span className="text-slate-300">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {!loading && filtered.length > 0 && (
            <tfoot>
              <tr className="bg-slate-200 font-bold sticky bottom-0">
                <td className="border border-slate-400 px-2.5 py-1.5 text-[13px] text-slate-700">
                  {isRoot
                    ? `Total (${filtered.length} groups)`
                    : `Total (${filtered.filter(r => r.type === 'group').length} sub-groups, ${filtered.filter(r => r.type === 'ledger').length} ledgers)`}
                </td>
                <td className="border border-slate-400 px-2.5 py-1.5 text-right text-[13px] tabular-nums text-slate-700">
                  {Math.abs(totals.opening) > 0.005
                    ? <>{fmt(Math.abs(totals.opening))}<span className="text-[10px] ml-1">{totals.opening > 0 ? 'Dr' : 'Cr'}</span></>
                    : '—'}
                </td>
                <td className="border border-slate-400 px-2.5 py-1.5 text-right text-[13px] tabular-nums text-emerald-700">{fmt(totals.debit)}</td>
                <td className="border border-slate-400 px-2.5 py-1.5 text-right text-[13px] tabular-nums text-red-600">{fmt(totals.credit)}</td>
                <td className="border border-slate-400 px-2.5 py-1.5 text-right text-[13px] tabular-nums text-slate-800">
                  {fmt(Math.abs(isRoot ? totals.balance : totals.closing))}
                  <span className="text-[10px] ml-1">
                    {(isRoot ? totals.balance : totals.closing) > 0 ? 'Dr' : (isRoot ? totals.balance : totals.closing) < 0 ? 'Cr' : ''}
                  </span>
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* ── Grand Total — mobile only ── */}
      {!loading && filtered.length > 0 && (
        <div className="sm:hidden flex-none border-t border-slate-200 print:hidden">
          <div className="bg-blue-700 text-white px-4 py-2 flex justify-between items-center">
            <span className="font-bold text-[13px] uppercase tracking-widest">
              {isRoot ? `Total (${filtered.length} groups)` : `Total (${filtered.filter(r => r.type === 'group').length} sub-groups, ${filtered.filter(r => r.type === 'ledger').length} ledgers)`}
            </span>
          </div>
          <div className="flex divide-x divide-slate-200 bg-white">
            <div className="flex-1 px-3 py-2.5">
              <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">Opening</div>
              <div className="text-[13px] font-bold text-slate-700 tabular-nums mt-0.5">
                {Math.abs(totals.opening) > 0.005 ? fmt(Math.abs(totals.opening)) : '—'}
              </div>
            </div>
            <div className="flex-1 px-3 py-2.5">
              <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">Debit</div>
              <div className="text-[13px] font-bold text-emerald-700 tabular-nums mt-0.5">{fmt(totals.debit)}</div>
            </div>
            <div className="flex-1 px-3 py-2.5">
              <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">Credit</div>
              <div className="text-[13px] font-bold text-red-600 tabular-nums mt-0.5">{fmt(totals.credit)}</div>
            </div>
            <div className="flex-1 px-3 py-2.5">
              <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">Closing</div>
              <div className="text-[13px] font-bold text-slate-800 tabular-nums mt-0.5">
                {fmt(Math.abs(isRoot ? totals.balance : totals.closing))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pagination */}
      {!printing && filtered.length > PAGE_SIZE && (
        <div className="flex-none flex items-center justify-between px-4 py-2 border-t border-slate-200 bg-slate-50 text-[13px] text-slate-600 print:hidden">
          <span className="tabular-nums">{(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(1)} disabled={safePage === 1}
              className="p-1 border border-slate-300 rounded bg-white hover:bg-slate-50 disabled:opacity-40"><ChevronsLeft size={14} /></button>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}
              className="p-1 border border-slate-300 rounded bg-white hover:bg-slate-50 disabled:opacity-40"><ChevronLeft size={14} /></button>
            <span className="px-2 tabular-nums">Page {safePage} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}
              className="p-1 border border-slate-300 rounded bg-white hover:bg-slate-50 disabled:opacity-40"><ChevronRight size={14} /></button>
            <button onClick={() => setPage(totalPages)} disabled={safePage === totalPages}
              className="p-1 border border-slate-300 rounded bg-white hover:bg-slate-50 disabled:opacity-40"><ChevronsRight size={14} /></button>
          </div>
        </div>
      )}
    </div>
  );
}
