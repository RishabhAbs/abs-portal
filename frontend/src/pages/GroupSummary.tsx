import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Calendar, ChevronUp, ChevronDown, ChevronsUpDown,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  RefreshCw, Search, X, Printer, ArrowLeft, ExternalLink,
} from 'lucide-react';
import { vouchersApi } from '../services/api';
import { useToast } from '../components/Toast/Toast';

const fmt = (n: any) =>
  Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Local YYYY-MM-DD — toISOString shifts to UTC, which silently turns
// April 1 IST midnight into "2026-03-31".
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

type GroupRow = {
  group_id: number | null;
  group_name: string;
  ledger_count: number;
  voucher_count: number;
  total_debit: number;
  total_credit: number;
  net_balance: number;
};
type LedgerRow = {
  ledger_id: number;
  ledger_name: string;
  opening_balance: number;
  debit_total: number;
  credit_total: number;
  closing_balance: number;
};
type GroupSortKey = 'group_name' | 'ledger_count' | 'voucher_count' | 'total_debit' | 'total_credit' | 'net_balance';
type LedgerSortKey = 'ledger_name' | 'opening_balance' | 'debit_total' | 'credit_total' | 'closing_balance';
type SortDir = 'asc' | 'desc';
const STORAGE_KEY = 'group-summary-filters';

function fyBounds(d: Date) {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return { from: new Date(y, 3, 1), to: new Date(y + 1, 2, 31) };
}
function defaultFilters() {
  const today = new Date();
  const { from } = fyBounds(today);
  return { dateFrom: toInputDate(from), dateTo: toInputDate(today), search: '' };
}

export default function GroupSummary() {
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
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<GroupRow[]>([]);
  const [totals, setTotals] = useState({ debit: 0, credit: 0, balance: 0 });

  // Drill-down state. When a group is selected, the page swaps from the
  // group list into the per-ledger view (Tally-style).
  const [drilledGroup, setDrilledGroup] = useState<GroupRow | null>(null);
  const [ledgerRows, setLedgerRows] = useState<LedgerRow[]>([]);
  const [ledgerTotals, setLedgerTotals] = useState({ opening: 0, debit: 0, credit: 0, closing: 0 });
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerSearch, setLedgerSearch] = useState('');
  const [debouncedLedgerSearch, setDebouncedLedgerSearch] = useState('');

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ dateFrom, dateTo, search })); } catch { /* ignore */ }
  }, [dateFrom, dateTo, search]);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedLedgerSearch(ledgerSearch), 300);
    return () => clearTimeout(t);
  }, [ledgerSearch]);

  const [sortKey, setSortKey] = useState<GroupSortKey>('net_balance');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [ledgerSortKey, setLedgerSortKey] = useState<LedgerSortKey>('ledger_name');
  const [ledgerSortDir, setLedgerSortDir] = useState<SortDir>('asc');

  // Pagination — 10/page on each view. Reset whenever the dataset shape
  // changes (search, date range, drill-down) so the user never lands on
  // an empty page after a filter narrows results.
  const PAGE_SIZE = 10;
  const [groupPage, setGroupPage] = useState(1);
  const [ledgerPage, setLedgerPage] = useState(1);
  useEffect(() => { setGroupPage(1); }, [debouncedSearch, dateFrom, dateTo, sortKey, sortDir]);
  useEffect(() => { setLedgerPage(1); }, [drilledGroup, debouncedLedgerSearch, ledgerSortKey, ledgerSortDir]);

  const [showControls, setShowControls] = useState(false);
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const onAfter = () => setPrinting(false);
    window.addEventListener('afterprint', onAfter);
    return () => window.removeEventListener('afterprint', onAfter);
  }, []);
  const handlePrint = () => {
    if ((drilledGroup ? ledgerRows.length : rows.length) === 0) return;
    setPrinting(true);
    setTimeout(() => window.print(), 50);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await vouchersApi.getGroupSummary({
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        search: debouncedSearch || undefined,
      });
      if (res.success) {
        setRows(res.data.rows || []);
        setTotals({
          debit:   res.data.totals?.debit   || 0,
          credit:  res.data.totals?.credit  || 0,
          balance: res.data.totals?.balance || 0,
        });
      }
    } catch { showError('Error', 'Failed to load Group Summary'); }
    finally { setLoading(false); }
  }, [dateFrom, dateTo, debouncedSearch, showError]);

  useEffect(() => { load(); }, [load]);

  const loadLedgers = useCallback(async () => {
    if (!drilledGroup?.group_id) return;
    setLedgerLoading(true);
    try {
      const res = await vouchersApi.getGroupLedgers(drilledGroup.group_id, {
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        search: debouncedLedgerSearch || undefined,
      });
      if (res.success) {
        setLedgerRows(res.data.rows || []);
        setLedgerTotals({
          opening: res.data.totals?.opening || 0,
          debit:   res.data.totals?.debit   || 0,
          credit:  res.data.totals?.credit  || 0,
          closing: res.data.totals?.closing || 0,
        });
      }
    } catch { showError('Error', 'Failed to load ledgers in this group'); }
    finally { setLedgerLoading(false); }
  }, [drilledGroup, dateFrom, dateTo, debouncedLedgerSearch, showError]);
  useEffect(() => { if (drilledGroup) loadLedgers(); }, [loadLedgers, drilledGroup]);

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

  const ledgerSorted = useMemo(() => {
    const arr = [...ledgerRows];
    const dir = ledgerSortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      const av = (a as any)[ledgerSortKey];
      const bv = (b as any)[ledgerSortKey];
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av ?? '').localeCompare(String(bv ?? '')) * dir;
    });
    return arr;
  }, [ledgerRows, ledgerSortKey, ledgerSortDir]);

  const toggleSort = (k: GroupSortKey) => {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('desc'); }
  };
  const toggleLedgerSort = (k: LedgerSortKey) => {
    if (ledgerSortKey === k) setLedgerSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setLedgerSortKey(k); setLedgerSortDir('asc'); }
  };
  const SortIcon = ({ col }: { col: GroupSortKey }) => {
    if (sortKey !== col) return <ChevronsUpDown size={11} className="inline-block ml-1 text-slate-400" />;
    return sortDir === 'asc'
      ? <ChevronUp size={11} className="inline-block ml-1 text-blue-600" />
      : <ChevronDown size={11} className="inline-block ml-1 text-blue-600" />;
  };
  const LedgerSortIcon = ({ col }: { col: LedgerSortKey }) => {
    if (ledgerSortKey !== col) return <ChevronsUpDown size={11} className="inline-block ml-1 text-slate-400" />;
    return ledgerSortDir === 'asc'
      ? <ChevronUp size={11} className="inline-block ml-1 text-blue-600" />
      : <ChevronDown size={11} className="inline-block ml-1 text-blue-600" />;
  };

  const cell = 'border border-slate-300 px-2.5 py-1.5 text-[14px] leading-snug';
  const cellNum = `${cell} text-right tabular-nums whitespace-nowrap`;
  const headCell = 'border border-slate-400 bg-slate-200 px-2.5 py-1.5 text-[13px] font-bold text-slate-700 uppercase tracking-wide sticky top-0 z-10';
  const headBtn = 'flex items-center select-none cursor-pointer hover:text-blue-700';

  // Slice the sorted lists into the current page. Printing renders all
  // rows so the printout is complete regardless of page index.
  const groupTotalPages  = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const groupSafePage    = Math.min(groupPage, groupTotalPages);
  const groupStartIdx    = (groupSafePage - 1) * PAGE_SIZE;
  const groupEndIdx      = Math.min(groupStartIdx + PAGE_SIZE, sorted.length);
  const groupPageRows    = printing ? sorted : sorted.slice(groupStartIdx, groupEndIdx);
  const ledgerTotalPages = Math.max(1, Math.ceil(ledgerSorted.length / PAGE_SIZE));
  const ledgerSafePage   = Math.min(ledgerPage, ledgerTotalPages);
  const ledgerStartIdx   = (ledgerSafePage - 1) * PAGE_SIZE;
  const ledgerEndIdx     = Math.min(ledgerStartIdx + PAGE_SIZE, ledgerSorted.length);
  const ledgerPageRows   = printing ? ledgerSorted : ledgerSorted.slice(ledgerStartIdx, ledgerEndIdx);

  return (
    <div className="flex flex-col w-full fixed left-0 right-0 top-14 bottom-16 sm:static sm:h-full sm:top-auto sm:bottom-auto" style={{ overscrollBehavior: "contain" }}>
      <div className="print-only mb-3 px-3" aria-hidden>
        <h1 className="text-xl font-bold mb-1">Group Summary</h1>
        <div className="text-sm">
          {drilledGroup ? `${drilledGroup.group_name} · ` : ''}
          From {displayDate(dateFrom)} to {displayDate(dateTo)}
        </div>
      </div>

      {/* ── Header bar ── */}
      <div className="flex-none bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between print:hidden">
        <div className="flex items-center gap-1 min-w-0">
          <button
            onClick={() => drilledGroup
              ? (setDrilledGroup(null), setLedgerRows([]), setLedgerSearch(''))
              : navigate(-1)}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 -ml-1 flex-shrink-0"
            title={drilledGroup ? 'Back to groups' : 'Back'}>
            <ChevronLeft size={20} />
          </button>
          <h1 className="text-[17px] font-bold text-slate-800 truncate">Group Summary</h1>
          {drilledGroup && (
            <span className="text-[13px] font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded flex-shrink-0 ml-1 truncate max-w-[120px]">
              {drilledGroup.group_name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => setShowControls(v => !v)}
            className={`p-2 rounded-lg transition-colors ${showControls ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
            title="Search">
            <Search size={18} />
          </button>
          <button onClick={handlePrint}
            disabled={(drilledGroup ? ledgerRows.length : rows.length) === 0}
            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-40"
            title="Print">
            <Printer size={16} />
          </button>
          <button onClick={drilledGroup ? loadLedgers : load}
            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"
            title="Refresh">
            <RefreshCw size={16} className={(loading || ledgerLoading) ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ── Search & date filter panel (slide-down) ── */}
      {showControls && (
        <div className="flex-none bg-slate-50 border-b border-slate-200 px-3 py-2.5 print:hidden">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[140px]">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={drilledGroup ? ledgerSearch : search}
                onChange={e => drilledGroup ? setLedgerSearch(e.target.value) : setSearch(e.target.value)}
                placeholder={drilledGroup ? 'Ledger name…' : 'Group name…'}
                autoFocus
                className="pl-9 pr-7 py-2 border border-slate-300 rounded-lg text-[13px] w-full outline-none focus:ring-2 focus:ring-blue-300 bg-white" />
              {(drilledGroup ? ledgerSearch : search) && (
                <button onClick={() => drilledGroup ? setLedgerSearch('') : setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
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
          </div>
        </div>
      )}

      {!drilledGroup ? (
        <>
          {/* Mobile flat list — group summary view */}
          <div className="sm:hidden flex-1 min-h-0 overflow-auto bg-white" style={{ overscrollBehavior: "contain" }}>
            {loading ? (
              <div className="text-center text-gray-400 py-8">Loading…</div>
            ) : sorted.length === 0 ? (
              <div className="text-center text-gray-400 py-8">No groups with activity between {displayDate(dateFrom)} and {displayDate(dateTo)}</div>
            ) : (
              <>
                {groupPageRows.map((g) => {
                  const drillable = !!g.group_id;
                  const drCrLabel = Math.abs(g.net_balance) > 0.005 ? (g.net_balance > 0 ? 'Dr' : 'Cr') : '';
                  return (
                    <div key={`${g.group_id ?? 'null'}-${g.group_name}`}
                      className={`border-b border-gray-200 ${drillable ? 'cursor-pointer active:bg-blue-50' : ''}`}
                      onClick={() => { if (drillable) setDrilledGroup(g); }}>
                      <div className="flex items-start justify-between px-4 py-3">
                        <div>
                          <div className="font-bold text-gray-900 text-[15px] uppercase">
                            {g.group_name}
                          </div>
                          <div className="text-[13px] text-gray-500 mt-0.5">
                            {g.ledger_count} ledgers&nbsp;&nbsp;·&nbsp;&nbsp;{g.voucher_count} vouchers
                          </div>
                        </div>
                        <span className="text-[15px] font-medium text-gray-900 tabular-nums whitespace-nowrap ml-3">
                          {fmt(Math.abs(g.net_balance))}{drCrLabel ? ` ${drCrLabel}` : ''}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>

          {/* Desktop table — group summary view */}
          <div className="hidden sm:block flex-1 min-h-0 overflow-auto bg-white border-x border-b border-slate-300 mx-3 mb-3 print:mx-0 print:overflow-visible print:max-h-none print:border-slate-400">
            <table className="border-collapse text-[14px] w-full">
              <thead>
                <tr>
                  <th className={`${headCell} text-left`}>
                    <div className={headBtn} onClick={() => toggleSort('group_name')}>Group<SortIcon col="group_name" /></div>
                  </th>
                  <th className={`${headCell} text-right w-24`}>
                    <div className={headBtn + ' justify-end'} onClick={() => toggleSort('ledger_count')}>Ledgers<SortIcon col="ledger_count" /></div>
                  </th>
                  <th className={`${headCell} text-right w-24`}>
                    <div className={headBtn + ' justify-end'} onClick={() => toggleSort('voucher_count')}>Vouchers<SortIcon col="voucher_count" /></div>
                  </th>
                  <th className={`${headCell} text-right w-36`}>
                    <div className={headBtn + ' justify-end'} onClick={() => toggleSort('total_debit')}>Debit<SortIcon col="total_debit" /></div>
                  </th>
                  <th className={`${headCell} text-right w-36`}>
                    <div className={headBtn + ' justify-end'} onClick={() => toggleSort('total_credit')}>Credit<SortIcon col="total_credit" /></div>
                  </th>
                  <th className={`${headCell} text-right w-36`}>
                    <div className={headBtn + ' justify-end'} onClick={() => toggleSort('net_balance')}>Net<SortIcon col="net_balance" /></div>
                  </th>
                  <th className={`${headCell} text-center w-12`}>Dr/Cr</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className={`${cell} text-center text-slate-400 py-6`}>Loading…</td></tr>
                ) : sorted.length === 0 ? (
                  <tr><td colSpan={7} className={`${cell} text-center text-slate-400 py-6`}>No groups with activity between {displayDate(dateFrom)} and {displayDate(dateTo)}</td></tr>
                ) : (
                  groupPageRows.map((g, i) => {
                    const positive = g.net_balance > 0;
                    const zebra = i % 2 === 1 ? 'bg-slate-50' : 'bg-white';
                    const drillable = !!g.group_id;
                    return (
                      <tr key={`${g.group_id ?? 'null'}-${g.group_name}`}
                        className={`${zebra} ${drillable ? 'hover:bg-blue-50 cursor-pointer' : ''}`}
                        onClick={() => { if (drillable) setDrilledGroup(g); }}>
                        <td className={`${cell} font-medium text-slate-800`}>
                          <div className="flex items-center gap-2">
                            <span>{g.group_name}</span>
                            {drillable && (
                              <span className="text-[10px] text-blue-600 underline decoration-dotted">view ledgers</span>
                            )}
                          </div>
                        </td>
                        <td className={cellNum + ' text-slate-600'}>{g.ledger_count}</td>
                        <td className={cellNum + ' text-slate-600'}>{g.voucher_count}</td>
                        <td className={cellNum + ' text-emerald-700'}>{g.total_debit > 0 ? fmt(g.total_debit) : <span className="text-slate-300">—</span>}</td>
                        <td className={cellNum + ' text-red-700'}>{g.total_credit > 0 ? fmt(g.total_credit) : <span className="text-slate-300">—</span>}</td>
                        <td className={cellNum + (positive ? ' text-emerald-700' : g.net_balance < 0 ? ' text-red-700' : ' text-slate-400') + ' font-semibold'}>
                          {Math.abs(g.net_balance) > 0.005 ? fmt(Math.abs(g.net_balance)) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className={`${cell} text-center font-semibold ${positive ? 'text-emerald-700' : g.net_balance < 0 ? 'text-red-700' : 'text-slate-400'}`}>
                          {Math.abs(g.net_balance) > 0.005 ? (positive ? 'Dr' : 'Cr') : '—'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {sorted.length > 0 && (
                <tfoot>
                  <tr className="bg-slate-200 font-bold sticky bottom-0">
                    <td colSpan={3} className={`${cell} text-slate-700`}>Total ({sorted.length} groups)</td>
                    <td className={cellNum + ' text-emerald-800'}>{fmt(totals.debit)}</td>
                    <td className={cellNum + ' text-red-800'}>{fmt(totals.credit)}</td>
                    <td className={cellNum + ' text-slate-800'}>{fmt(Math.abs(totals.balance))}</td>
                    <td className={cell + ' text-center'}>{totals.balance > 0 ? 'Dr' : totals.balance < 0 ? 'Cr' : '—'}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Mobile — Grand Total fixed above pagination */}
          {!loading && sorted.length > 0 && (
            <div className="sm:hidden flex-none border-t border-gray-200 print:hidden">
              <div className="bg-blue-700 text-white px-4 py-2.5 flex justify-between items-center">
                <span className="font-bold text-sm tracking-widest">GRAND TOTAL</span>
                <span className="text-sm tabular-nums font-semibold">{sorted.length} groups</span>
              </div>
              <div className="flex divide-x divide-gray-200 bg-white">
                <div className="flex-1 px-3 py-2.5">
                  <div className="text-[10px] uppercase text-gray-400 font-bold tracking-wide">Debit</div>
                  <div className="text-[14px] font-bold text-emerald-700 tabular-nums mt-0.5">{fmt(totals.debit)}</div>
                </div>
                <div className="flex-1 px-3 py-2.5">
                  <div className="text-[10px] uppercase text-gray-400 font-bold tracking-wide">Credit</div>
                  <div className="text-[14px] font-bold text-red-600 tabular-nums mt-0.5">{fmt(totals.credit)}</div>
                </div>
                <div className="flex-1 px-3 py-2.5">
                  <div className="text-[10px] uppercase text-gray-400 font-bold tracking-wide">Net</div>
                  <div className="text-[14px] font-bold text-slate-800 tabular-nums mt-0.5">
                    {fmt(Math.abs(totals.balance))}{totals.balance > 0 ? ' Dr' : totals.balance < 0 ? ' Cr' : ''}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Pagination — flex-none keeps it at bottom */}
          {!printing && sorted.length > PAGE_SIZE && (
            <Pagination
              page={groupSafePage} totalPages={groupTotalPages}
              startIdx={groupStartIdx} endIdx={groupEndIdx} totalRows={sorted.length}
              setPage={setGroupPage}
            />
          )}
        </>
      ) : (
        <>
          {/* Mobile flat list — ledger detail view */}
          <div className="sm:hidden flex-1 min-h-0 overflow-auto bg-white" style={{ overscrollBehavior: "contain" }}>
            {ledgerLoading ? (
              <div className="text-center text-gray-400 py-8">Loading…</div>
            ) : ledgerSorted.length === 0 ? (
              <div className="text-center text-gray-400 py-8">No ledgers in this group</div>
            ) : (
              <>
                {ledgerPageRows.map((l) => {
                  const closeSign = l.closing_balance > 0 ? 'Dr' : l.closing_balance < 0 ? 'Cr' : '';
                  const openSign = l.opening_balance > 0 ? 'Dr' : l.opening_balance < 0 ? 'Cr' : '';
                  return (
                    <div key={l.ledger_id}
                      className="border-b border-gray-200 cursor-pointer active:bg-blue-50"
                      onClick={() => navigate(`/reports/ledger?ledger_id=${l.ledger_id}`)}>
                      <div className="flex items-start justify-between px-4 py-3">
                        <div>
                          <div className="font-bold text-gray-900 text-[15px]">
                            {l.ledger_name}
                          </div>
                          <div className="text-[13px] text-gray-500 mt-0.5">
                            Opening: {fmt(Math.abs(l.opening_balance))}{openSign ? ` ${openSign}` : ''}&nbsp;&nbsp;|&nbsp;&nbsp;Dr: {fmt(l.debit_total)}&nbsp;&nbsp;|&nbsp;&nbsp;Cr: {fmt(l.credit_total)}
                          </div>
                        </div>
                        <span className="text-[15px] font-medium text-gray-900 tabular-nums whitespace-nowrap ml-3">
                          {fmt(Math.abs(l.closing_balance))}{closeSign ? ` ${closeSign}` : ''}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>

          {/* Desktop table — ledger detail view */}
          <div className="hidden sm:block flex-1 min-h-0 overflow-auto bg-white border-x border-b border-slate-300 mx-3 mb-3 print:mx-0 print:overflow-visible print:max-h-none print:border-slate-400">
            <table className="border-collapse text-[14px] w-full">
              <thead>
                <tr>
                  <th className={`${headCell} text-left`}>
                    <div className={headBtn} onClick={() => toggleLedgerSort('ledger_name')}>Particulars<LedgerSortIcon col="ledger_name" /></div>
                  </th>
                  <th className={`${headCell} text-right w-40`}>
                    <div className={headBtn + ' justify-end'} onClick={() => toggleLedgerSort('opening_balance')}>Opening Balance<LedgerSortIcon col="opening_balance" /></div>
                  </th>
                  <th className={`${headCell} text-right w-36`}>
                    <div className={headBtn + ' justify-end'} onClick={() => toggleLedgerSort('debit_total')}>Debit<LedgerSortIcon col="debit_total" /></div>
                  </th>
                  <th className={`${headCell} text-right w-36`}>
                    <div className={headBtn + ' justify-end'} onClick={() => toggleLedgerSort('credit_total')}>Credit<LedgerSortIcon col="credit_total" /></div>
                  </th>
                  <th className={`${headCell} text-right w-40`}>
                    <div className={headBtn + ' justify-end'} onClick={() => toggleLedgerSort('closing_balance')}>Closing Balance<LedgerSortIcon col="closing_balance" /></div>
                  </th>
                  <th className={`${headCell} text-center w-20 print:hidden`}>Action</th>
                </tr>
              </thead>
              <tbody>
                {ledgerLoading ? (
                  <tr><td colSpan={6} className={`${cell} text-center text-slate-400 py-6`}>Loading…</td></tr>
                ) : ledgerSorted.length === 0 ? (
                  <tr><td colSpan={6} className={`${cell} text-center text-slate-400 py-6`}>No ledgers in this group</td></tr>
                ) : (
                  ledgerPageRows.map((l, i) => {
                    const zebra = i % 2 === 1 ? 'bg-slate-50' : 'bg-white';
                    const openSign = l.opening_balance > 0 ? 'Dr' : l.opening_balance < 0 ? 'Cr' : '';
                    const closeSign = l.closing_balance > 0 ? 'Dr' : l.closing_balance < 0 ? 'Cr' : '';
                    return (
                      <tr key={l.ledger_id} className={`${zebra} hover:bg-blue-50`}>
                        <td className={`${cell} font-medium text-slate-800`}>{l.ledger_name}</td>
                        <td className={cellNum + ' text-slate-700'}>
                          {Math.abs(l.opening_balance) > 0.005
                            ? <>{fmt(Math.abs(l.opening_balance))} <span className="text-[10px] text-slate-500 ml-1">{openSign}</span></>
                            : <span className="text-slate-300">—</span>}
                        </td>
                        <td className={cellNum + ' text-emerald-700'}>{l.debit_total > 0 ? fmt(l.debit_total) : <span className="text-slate-300">—</span>}</td>
                        <td className={cellNum + ' text-red-700'}>{l.credit_total > 0 ? fmt(l.credit_total) : <span className="text-slate-300">—</span>}</td>
                        <td className={cellNum + ' font-semibold ' + (l.closing_balance > 0 ? 'text-emerald-800' : l.closing_balance < 0 ? 'text-red-800' : 'text-slate-400')}>
                          {Math.abs(l.closing_balance) > 0.005
                            ? <>{fmt(Math.abs(l.closing_balance))} <span className="text-[10px] ml-1">{closeSign}</span></>
                            : <span className="text-slate-300">—</span>}
                        </td>
                        <td className={`${cell} text-center print:hidden`}>
                          <button onClick={() => navigate(`/reports/ledger?ledger_id=${l.ledger_id}`)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-full">
                            <ExternalLink size={12} /> Open
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {ledgerSorted.length > 0 && (
                <tfoot>
                  <tr className="bg-slate-200 font-bold sticky bottom-0">
                    <td className={`${cell} text-slate-700`}>Grand Total ({ledgerSorted.length} ledgers)</td>
                    <td className={cellNum + ' text-slate-800'}>
                      {fmt(Math.abs(ledgerTotals.opening))}
                      <span className="text-[10px] ml-1">{ledgerTotals.opening > 0 ? 'Dr' : ledgerTotals.opening < 0 ? 'Cr' : ''}</span>
                    </td>
                    <td className={cellNum + ' text-emerald-800'}>{fmt(ledgerTotals.debit)}</td>
                    <td className={cellNum + ' text-red-800'}>{fmt(ledgerTotals.credit)}</td>
                    <td className={cellNum + ' text-slate-800'}>
                      {fmt(Math.abs(ledgerTotals.closing))}
                      <span className="text-[10px] ml-1">{ledgerTotals.closing > 0 ? 'Dr' : ledgerTotals.closing < 0 ? 'Cr' : ''}</span>
                    </td>
                    <td className={cell + ' print:hidden'} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {/* Mobile — Grand Total fixed above pagination */}
          {!ledgerLoading && ledgerSorted.length > 0 && (
            <div className="sm:hidden flex-none border-t border-gray-200 print:hidden">
              <div className="bg-blue-700 text-white px-4 py-2.5 flex justify-between items-center">
                <span className="font-bold text-sm tracking-widest">GRAND TOTAL</span>
                <span className="text-sm tabular-nums font-semibold">{ledgerSorted.length} ledgers</span>
              </div>
              <div className="flex divide-x divide-gray-200 bg-white">
                <div className="flex-1 px-3 py-2.5">
                  <div className="text-[10px] uppercase text-gray-400 font-bold tracking-wide">Opening</div>
                  <div className="text-[13px] font-bold text-slate-700 tabular-nums mt-0.5">
                    {fmt(Math.abs(ledgerTotals.opening))}{ledgerTotals.opening > 0 ? ' Dr' : ledgerTotals.opening < 0 ? ' Cr' : ''}
                  </div>
                </div>
                <div className="flex-1 px-3 py-2.5">
                  <div className="text-[10px] uppercase text-gray-400 font-bold tracking-wide">Dr</div>
                  <div className="text-[13px] font-bold text-emerald-700 tabular-nums mt-0.5">{fmt(ledgerTotals.debit)}</div>
                </div>
                <div className="flex-1 px-3 py-2.5">
                  <div className="text-[10px] uppercase text-gray-400 font-bold tracking-wide">Cr</div>
                  <div className="text-[13px] font-bold text-red-600 tabular-nums mt-0.5">{fmt(ledgerTotals.credit)}</div>
                </div>
                <div className="flex-1 px-3 py-2.5">
                  <div className="text-[10px] uppercase text-gray-400 font-bold tracking-wide">Closing</div>
                  <div className="text-[13px] font-bold text-slate-800 tabular-nums mt-0.5">
                    {fmt(Math.abs(ledgerTotals.closing))}{ledgerTotals.closing > 0 ? ' Dr' : ledgerTotals.closing < 0 ? ' Cr' : ''}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Pagination */}
          {!printing && ledgerSorted.length > PAGE_SIZE && (
            <Pagination
              page={ledgerSafePage} totalPages={ledgerTotalPages}
              startIdx={ledgerStartIdx} endIdx={ledgerEndIdx} totalRows={ledgerSorted.length}
              setPage={setLedgerPage}
            />
          )}
        </>
      )}
    </div>
  );
}

function Pagination({
  page, totalPages, startIdx, endIdx, totalRows, setPage,
}: {
  page: number; totalPages: number; startIdx: number; endIdx: number; totalRows: number;
  setPage: (n: number | ((p: number) => number)) => void;
}) {
  return (
    <div className="flex-none flex items-center justify-between px-3 py-1.5 border-t border-slate-200 bg-slate-50 text-[13px] text-slate-700 print:hidden">
      <div className="tabular-nums">{`${startIdx + 1}–${endIdx} of ${totalRows}`}</div>
      <div className="flex items-center gap-1">
        <button onClick={() => setPage(1)} disabled={page === 1}
          className="p-1 border border-slate-300 rounded bg-white hover:bg-slate-50 disabled:opacity-40"><ChevronsLeft size={14} /></button>
        <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
          className="p-1 border border-slate-300 rounded bg-white hover:bg-slate-50 disabled:opacity-40"><ChevronLeft size={14} /></button>
        <span className="px-2 tabular-nums">Page {page} / {totalPages}</span>
        <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
          className="p-1 border border-slate-300 rounded bg-white hover:bg-slate-50 disabled:opacity-40"><ChevronRight size={14} /></button>
        <button onClick={() => setPage(totalPages)} disabled={page === totalPages}
          className="p-1 border border-slate-300 rounded bg-white hover:bg-slate-50 disabled:opacity-40"><ChevronsRight size={14} /></button>
      </div>
    </div>
  );
}
