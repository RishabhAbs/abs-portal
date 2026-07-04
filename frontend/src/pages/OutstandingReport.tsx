import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Calendar, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronUp, ChevronDown, ChevronsUpDown, Filter, RefreshCw, RotateCcw, Search, X, Columns3 } from 'lucide-react';
import { vouchersApi } from '../services/api';
import { useToast } from '../components/Toast/Toast';
import BillFollowupModal from '../components/Outstanding/BillFollowupModal';

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
const statusBadge = (status: string) => {
  switch (status) {
    case 'Payment':     return 'bg-emerald-100 text-emerald-700';
    case 'Followup':    return 'bg-blue-100 text-blue-700';
    case 'Error':        return 'bg-red-100 text-red-700';
    case 'Frustitting': return 'bg-orange-100 text-orange-700';
    default:              return 'bg-slate-100 text-slate-600';
  }
};

type Bill = {
  ledger_id: number | null;
  party_name: string;
  group_name: string | null;
  reseller_name: string | null;
  bill_name: string;
  bill_date: string | null;
  last_activity: string | null;
  age_days: number;
  opening_balance: number;
  closing_balance: number;
  followup_status: string | null;
  followup_person: string | null;
  followup_phone: string | null;
  followup_next_date: string | null;
  followup_remark: string | null;
  customer_person: string | null;
  customer_mobile: string | null;
  all_contacts: { person: string | null; mobile: string; is_primary: boolean }[];
};
type Side = 'all' | 'receivable' | 'payable';
type SortKey = 'bill_name' | 'bill_date' | 'party_name' | 'group_name' | 'reseller_name' | 'age_days' | 'opening_balance' | 'closing_balance';
type SortDir = 'asc' | 'desc';

const PAGE_SIZES = [25, 50, 100, 200];
// Auto-fit row count is clamped to this range — enough to fill most
// screens without ever cramming dozens of unreadable rows on a tall one.
const MIN_AUTO_ROWS = 10;
const MAX_AUTO_ROWS = 30;
const STORAGE_KEY = 'outstanding-report-filters';
const COLUMNS_KEY = 'outstanding-report-columns-v2';

// Toggleable columns — # / Bill Name / Party Name / Age / Closing / Dr/Cr
// always show (the report's core identity); everything else is optional
// and hidden by default to keep the table concise, opt back in via the
// Columns button.
type ColKey = 'bill_date' | 'reseller' | 'group' | 'opening' | 'status' | 'person' | 'number' | 'next_date' | 'remark';
const OPTIONAL_COLUMNS: { key: ColKey; label: string; defaultOn: boolean }[] = [
  { key: 'status',     label: 'Status',      defaultOn: true },
  { key: 'next_date',  label: 'Next Date',   defaultOn: true },
  { key: 'bill_date',  label: 'Bill Date',   defaultOn: false },
  { key: 'opening',    label: 'Opening',     defaultOn: false },
  { key: 'reseller',   label: 'Reseller',    defaultOn: false },
  { key: 'group',      label: 'Group',       defaultOn: false },
  { key: 'person',     label: 'Person Name', defaultOn: true },
  { key: 'number',     label: 'Number',      defaultOn: true },
  { key: 'remark',     label: 'Remark',      defaultOn: false },
];
const defaultVisibleCols = (): Record<ColKey, boolean> =>
  Object.fromEntries(OPTIONAL_COLUMNS.map(c => [c.key, c.defaultOn])) as Record<ColKey, boolean>;

function fyBounds(d: Date) {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return { from: new Date(y, 3, 1), to: new Date(y + 1, 2, 31) };
}

function defaultFilters() {
  const today = new Date();
  const { from } = fyBounds(today);
  return {
    dateFrom: toInputDate(from),
    dateTo:   toInputDate(today),
    side: 'all' as Side,
    partySearch: '',
    billName: '',
  };
}

export default function OutstandingReport() {
  const navigate = useNavigate();
  const { showError } = useToast();
  const { side: sideParam } = useParams<{ side?: string }>();
  const lockedSide: Side | null = sideParam === 'payable' || sideParam === 'receivable' ? sideParam : null;

  const initial = (() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return { ...defaultFilters(), ...JSON.parse(saved) };
    } catch { /* ignore */ }
    return defaultFilters();
  })();

  const [dateFrom, setDateFrom] = useState<string>(initial.dateFrom);
  const [dateTo, setDateTo]     = useState<string>(initial.dateTo);
  const [side, setSide]         = useState<Side>(lockedSide || initial.side);

  useEffect(() => {
    if (lockedSide) setSide(lockedSide);
  }, [lockedSide]);
  const [partySearch, setPartySearch] = useState<string>(initial.partySearch);
  const [billNameFilter, setBillNameFilter] = useState<string>(initial.billName);
  const [debouncedParty, setDebouncedParty] = useState<string>(initial.partySearch);
  const [debouncedBill, setDebouncedBill]   = useState<string>(initial.billName);
  const [loading, setLoading] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [hideZero, setHideZero] = useState(false);
  const [bills, setBills] = useState<Bill[]>([]);
  const [totals, setTotals] = useState({ receivable: 0, payable: 0 });
  const [followupTarget, setFollowupTarget] = useState<Bill | null>(null);
  const [visibleCols, setVisibleCols] = useState<Record<ColKey, boolean>>(() => {
    try {
      const saved = localStorage.getItem(COLUMNS_KEY);
      if (saved) return { ...defaultVisibleCols(), ...JSON.parse(saved) };
    } catch { /* ignore */ }
    return defaultVisibleCols();
  });
  useEffect(() => {
    try { localStorage.setItem(COLUMNS_KEY, JSON.stringify(visibleCols)); } catch { /* ignore */ }
  }, [visibleCols]);
  const toggleCol = (key: ColKey) => setVisibleCols(v => ({ ...v, [key]: !v[key] }));
  // Always-on columns: #, Bill Name, Party Name, Age, Closing, Dr/Cr
  const visibleColCount = 6 + OPTIONAL_COLUMNS.filter(c => visibleCols[c.key]).length;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        dateFrom, dateTo, side, partySearch, billName: billNameFilter,
      }));
    } catch { /* ignore */ }
  }, [dateFrom, dateTo, side, partySearch, billNameFilter]);

  const resetAll = () => {
    const d = defaultFilters();
    setDateFrom(d.dateFrom);
    setDateTo(d.dateTo);
    setSide(lockedSide || d.side);
    setPartySearch(d.partySearch);
    setBillNameFilter(d.billName);
    setHideZero(false);
  };

  const defaults = defaultFilters();
  const dateRangeChanged = dateFrom !== defaults.dateFrom || dateTo !== defaults.dateTo;
  const filterCount =
    (partySearch ? 1 : 0) +
    (billNameFilter ? 1 : 0) +
    (!lockedSide && side !== 'all' ? 1 : 0) +
    (hideZero ? 1 : 0) +
    (dateRangeChanged ? 1 : 0);

  const [sortKey, setSortKey] = useState<SortKey>('bill_date');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);

  // Fit exactly as many rows as the viewport allows — no internal table
  // scroll, extra rows go to the next page instead. Recomputes on resize
  // and stops once the user manually picks a Rows value from the dropdown.
  const [autoPageSize, setAutoPageSize] = useState(true);
  const [rowScale, setRowScale] = useState(1);
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const theadRef = useRef<HTMLTableSectionElement>(null);
  const firstRowRef = useRef<HTMLTableRowElement>(null);
  const tfootRef = useRef<HTMLTableSectionElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedParty(partySearch), 300);
    return () => clearTimeout(t);
  }, [partySearch]);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedBill(billNameFilter), 300);
    return () => clearTimeout(t);
  }, [billNameFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await vouchersApi.getOutstanding({
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        bill_name: debouncedBill || undefined,
        search: debouncedParty || undefined,
        side,
      });
      if (res.success) {
        let flatBills: Bill[] = [];
        if (Array.isArray(res.data.bills)) {
          flatBills = res.data.bills;
        } else if (Array.isArray((res.data as any).parties)) {
          for (const p of (res.data as any).parties) {
            for (const b of (p.bills || [])) {
              const bal = Number(b.balance || 0);
              flatBills.push({
                ledger_id: p.ledger_id ?? null,
                party_name: p.party_name || 'Unallocated',
                group_name: p.group_name ?? null,
                reseller_name: p.reseller_name ?? null,
                bill_name: b.bill_name || '—',
                bill_date: b.bill_date || null,
                last_activity: b.last_activity || null,
                age_days: Number(b.age_days) || 0,
                opening_balance: bal > 0 ? bal : 0,
                closing_balance: bal,
                followup_status: b.followup_status ?? null,
                followup_person: b.followup_person ?? null,
                followup_phone: b.followup_phone ?? null,
                followup_next_date: b.followup_next_date ?? null,
                followup_remark: b.followup_remark ?? null,
                customer_person: b.customer_person ?? null,
                customer_mobile: b.customer_mobile ?? null,
                all_contacts: b.all_contacts ?? [],
              });
            }
          }
        }
        setBills(flatBills);
        setTotals({
          receivable: res.data.totalReceivable || 0,
          payable: res.data.totalPayable || 0,
        });
      }
    } catch {
      showError('Error', 'Failed to load outstanding report');
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, debouncedParty, debouncedBill, side, showError]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [debouncedParty, debouncedBill, side, dateFrom, dateTo, pageSize, sortKey, sortDir, hideZero]);

  const sorted = useMemo(() => {
    const arr = bills.filter(b => !hideZero || Math.abs(b.closing_balance) > 0.005);
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      const av = a[sortKey] as any;
      const bv = b[sortKey] as any;
      if (sortKey === 'bill_date') {
        const at = a.bill_date ? new Date(a.bill_date).getTime() : 0;
        const bt = b.bill_date ? new Date(b.bill_date).getTime() : 0;
        return (at - bt) * dir;
      }
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av ?? '').localeCompare(String(bv ?? '')) * dir;
    });
    return arr;
  }, [bills, sortKey, sortDir, hideZero]);

  const totalRows = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, totalRows);
  const pageRows = sorted.slice(startIdx, endIdx);

  useEffect(() => {
    if (!autoPageSize) return;
    const computeRows = () => {
      const wrap = tableWrapRef.current;
      const rowH = firstRowRef.current?.getBoundingClientRect().height;
      if (!wrap || !rowH) return;
      const headerH = theadRef.current?.getBoundingClientRect().height || 0;
      const footerH = tfootRef.current?.getBoundingClientRect().height || 0;
      const available = wrap.clientHeight - headerH - footerH;
      if (available <= 0) return;
      // Clamp to a comfortable range — never cram dozens of unreadable
      // rows on a tall screen, never under-fill on a short one.
      const rawRows = Math.floor(available / rowH);
      const rows = Math.min(Math.max(rawRows, MIN_AUTO_ROWS), MAX_AUTO_ROWS);
      setPageSize(prev => (prev === rows ? prev : rows));
      // If clamping left slack space (tall screen, few rows needed), scale
      // the font up modestly so those rows still fill the space nicely
      // instead of leaving a gap under the last row.
      const scale = Math.min(Math.max(available / (rows * rowH), 1), 1.5);
      setRowScale(prev => (Math.abs(prev - scale) < 0.02 ? prev : scale));
    };
    computeRows();
    const ro = new ResizeObserver(computeRows);
    if (tableWrapRef.current) ro.observe(tableWrapRef.current);
    window.addEventListener('resize', computeRows);
    return () => { ro.disconnect(); window.removeEventListener('resize', computeRows); };
  }, [autoPageSize, pageRows.length]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ChevronsUpDown size={11} className="inline-block ml-1 text-slate-400" />;
    return sortDir === 'asc'
      ? <ChevronUp size={11} className="inline-block ml-1 text-blue-600" />
      : <ChevronDown size={11} className="inline-block ml-1 text-blue-600" />;
  };

  // Font sizes intentionally NOT set here — they inherit from the <table>'s
  // inline fontSize (scaled by rowScale). headCell uses an em-relative size
  // so the header/body proportion holds at any scale.
  const cell = 'border border-slate-300 px-2 py-1 leading-snug';
  const cellNum = `${cell} text-right tabular-nums whitespace-nowrap`;
  const headCell = 'border border-slate-400 bg-slate-200 px-2 py-1 text-[0.88em] font-bold text-slate-700 uppercase tracking-wide sticky top-0 z-10';
  const headBtn = 'flex items-center select-none cursor-pointer hover:text-blue-700';

  return (
    <div className="flex flex-col w-full fixed left-0 right-0 top-14 bottom-16 sm:static sm:h-full sm:top-auto sm:bottom-auto" style={{ overscrollBehavior: "contain" }}>

      {/* ── Header bar ── */}
      <div className="flex-none bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button onClick={() => navigate(-1)} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 -ml-1" title="Back">
            <ChevronLeft size={20} />
          </button>
          <h1 className="text-[17px] font-bold text-slate-800">
            {lockedSide === 'payable' ? 'Payables Outstanding' : lockedSide === 'receivable' ? 'Receivables Outstanding' : 'Outstanding Report'}
          </h1>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setShowSearch(s => !s); setShowFilter(false); setShowColumns(false); }}
            className={`p-2 rounded-lg transition-colors ${showSearch ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
            title="Search"
          >
            <Search size={18} />
          </button>
          <button
            onClick={() => { setShowFilter(s => !s); setShowSearch(false); setShowColumns(false); }}
            className={`p-2 rounded-lg transition-colors relative ${showFilter ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
            title="Filter"
          >
            <Filter size={18} />
            {filterCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none">
                {filterCount}
              </span>
            )}
          </button>
          <button
            onClick={() => { setShowColumns(s => !s); setShowSearch(false); setShowFilter(false); }}
            className={`hidden sm:inline-flex p-2 rounded-lg transition-colors ${showColumns ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
            title="Show/hide columns"
          >
            <Columns3 size={18} />
          </button>
          <button
            onClick={load}
            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"
            title="Refresh"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ── Columns panel (slide-down, desktop only) ── */}
      {showColumns && (
        <div className="hidden sm:block flex-none bg-slate-50 border-b border-slate-200 px-3 py-2.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-slate-400 font-bold uppercase tracking-wide mr-1">Columns:</span>
            {OPTIONAL_COLUMNS.map(c => (
              <button key={c.key} onClick={() => toggleCol(c.key)}
                className={`text-[12px] px-2.5 py-1 rounded-full border transition-colors ${
                  visibleCols[c.key] ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-100'
                }`}>
                {c.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Search bar (slide-down) ── */}
      {showSearch && (
        <div className="flex-none bg-slate-50 border-b border-slate-200 px-3 py-2.5">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={partySearch}
              onChange={e => setPartySearch(e.target.value)}
              placeholder="Search party name…"
              autoFocus
              className="w-full pl-8 pr-8 py-2.5 border border-slate-300 rounded-lg text-[14px] outline-none focus:ring-2 focus:ring-blue-300 bg-white"
            />
            {partySearch && (
              <button onClick={() => setPartySearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Filter panel (slide-down) ── */}
      {showFilter && (
        <div className="flex-none bg-slate-50 border-b border-slate-200 px-3 py-3 space-y-2">
          <div className="flex gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[140px]">
              <input
                value={billNameFilter}
                onChange={e => setBillNameFilter(e.target.value)}
                placeholder="Bill no…"
                className="w-full pl-3 pr-8 py-2 border border-slate-300 rounded-lg text-[13px] outline-none focus:ring-2 focus:ring-blue-300 bg-white"
              />
              {billNameFilter && (
                <button onClick={() => setBillNameFilter('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400"><X size={13} /></button>
              )}
            </div>
            <div className="flex items-stretch border border-slate-300 rounded-lg bg-white overflow-hidden">
              <div className="flex items-center px-2 border-r border-slate-300 bg-slate-100">
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wide">From</span>
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
          <div className="flex gap-2 flex-wrap items-center">
            {!lockedSide && (
              <select value={side} onChange={e => setSide(e.target.value as Side)}
                className="flex-1 min-w-[140px] text-[13px] border border-slate-300 rounded-lg px-3 py-2 bg-white outline-none">
                <option value="all">All sides</option>
                <option value="receivable">Receivable only</option>
                <option value="payable">Payable only</option>
              </select>
            )}
            <label className="flex items-center gap-1.5 px-3 py-2 border border-slate-300 rounded-lg bg-white text-[13px] text-slate-600 cursor-pointer whitespace-nowrap">
              <input type="checkbox" checked={hideZero} onChange={e => setHideZero(e.target.checked)} className="cursor-pointer" />
              Hide zero
            </label>
            <button onClick={resetAll} disabled={filterCount === 0}
              className="flex items-center gap-1.5 px-3 py-2 border border-slate-300 rounded-lg text-[13px] text-slate-600 bg-white hover:bg-slate-100 disabled:opacity-40">
              <RotateCcw size={13} /> Reset
            </button>
          </div>
        </div>
      )}

      {/* ── Mobile scrollable rows ── */}
      <div className="sm:hidden flex-1 min-h-0 overflow-auto bg-white" style={{ overscrollBehavior: "contain" }}>
        {loading ? (
          <div className="py-16 text-center text-slate-400 text-sm">
            <RefreshCw size={20} className="animate-spin mx-auto mb-2 text-blue-400" />
            Loading…
          </div>
        ) : pageRows.length === 0 ? (
          <div className="py-16 text-center text-slate-400 text-sm px-8">
            No outstanding bills between {displayDate(dateFrom)} and {displayDate(dateTo)}
          </div>
        ) : pageRows.map((b, i) => {
          const positive = b.closing_balance > 0;
          const rowIdx = startIdx + i;
          const ageBadge =
            b.age_days <= 15 ? 'bg-emerald-100 text-emerald-700' :
            b.age_days <= 30 ? 'bg-amber-100  text-amber-700'   :
            b.age_days <= 60 ? 'bg-orange-100 text-orange-700'  :
                               'bg-red-100    text-red-700';
          return (
            <div key={rowIdx} className="border-b border-slate-100 px-4 py-3 active:bg-slate-50">
              {/* ── Party + Amount ── */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-slate-900 text-[15px] leading-snug truncate">{b.party_name}</div>
                  <div className="text-[12px] text-slate-400 mt-0.5 truncate">
                    <button onClick={() => setFollowupTarget(b)} className="text-blue-600 hover:underline font-medium">{b.bill_name}</button>
                    {b.bill_date ? `  ·  ${displayDate(b.bill_date)}` : ''}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className={`text-[16px] font-bold tabular-nums leading-tight ${positive ? 'text-emerald-700' : 'text-red-600'}`}>
                    ₹{fmt(Math.abs(b.closing_balance))}
                  </div>
                  <div className={`text-[10px] font-bold tracking-wide ${positive ? 'text-emerald-500' : 'text-red-400'}`}>
                    {positive ? 'RECEIVABLE' : 'PAYABLE'}
                  </div>
                </div>
              </div>
              {/* ── Age badge + reseller ── */}
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ageBadge}`}>
                  {b.age_days}d
                </span>
                {b.followup_status && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusBadge(b.followup_status)}`}>
                    {b.followup_status}
                  </span>
                )}
                {b.reseller_name && (
                  <span className="text-[12px] text-slate-400 truncate">{b.reseller_name}</span>
                )}
              </div>
              {(b.followup_person || b.followup_next_date || b.followup_remark) && (
                <div className="text-[11px] text-slate-500 mt-1 truncate">
                  {b.followup_person && <span className="font-medium text-slate-700">{b.followup_person}</span>}
                  {b.followup_phone && <span> · {b.followup_phone}</span>}
                  {b.followup_next_date && <span> · Next: {displayDate(b.followup_next_date)}</span>}
                  {b.followup_remark && <span className="italic"> — {b.followup_remark}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Desktop table ── */}
      <div ref={tableWrapRef} className="hidden sm:block flex-1 min-h-0 overflow-auto bg-white border border-slate-300 mx-3 mb-1 mt-1">
        <table className="border-collapse w-full" style={{ fontSize: `${12.5 * rowScale}px` }}>
          <thead ref={theadRef}>
            <tr>
              <th className={`${headCell} text-center w-8`}>#</th>
              <th className={`${headCell} text-left w-32`}>
                <div className={headBtn} onClick={() => toggleSort('bill_name')}>Bill Name<SortIcon col="bill_name" /></div>
              </th>
              {visibleCols.bill_date && (
                <th className={`${headCell} text-left w-24`}>
                  <div className={headBtn} onClick={() => toggleSort('bill_date')}>Bill Date<SortIcon col="bill_date" /></div>
                </th>
              )}
              <th className={`${headCell} text-left w-40`}>
                <div className={headBtn} onClick={() => toggleSort('party_name')}>Party Name<SortIcon col="party_name" /></div>
              </th>
              {visibleCols.reseller && (
                <th className={`${headCell} text-left w-32`}>
                  <div className={headBtn} onClick={() => toggleSort('reseller_name')}>Reseller<SortIcon col="reseller_name" /></div>
                </th>
              )}
              {visibleCols.group && (
                <th className={`${headCell} text-left w-32`}>
                  <div className={headBtn} onClick={() => toggleSort('group_name')}>Group<SortIcon col="group_name" /></div>
                </th>
              )}
              <th className={`${headCell} text-center w-12`}>
                <div className={headBtn + ' justify-center'} onClick={() => toggleSort('age_days')}>Age<SortIcon col="age_days" /></div>
              </th>
              {visibleCols.opening && (
                <th className={`${headCell} text-right w-28`}>
                  <div className={headBtn + ' justify-end'} onClick={() => toggleSort('opening_balance')}>Opening<SortIcon col="opening_balance" /></div>
                </th>
              )}
              <th className={`${headCell} text-right w-28`}>
                <div className={headBtn + ' justify-end'} onClick={() => toggleSort('closing_balance')}>Closing<SortIcon col="closing_balance" /></div>
              </th>
              <th className={`${headCell} text-center w-10`}>Dr/Cr</th>
              {visibleCols.status && <th className={`${headCell} text-center w-20`}>Status</th>}
              {visibleCols.person && <th className={`${headCell} text-left w-28`}>Person Name</th>}
              {visibleCols.number && <th className={`${headCell} text-left w-24`}>Number</th>}
              {visibleCols.next_date && <th className={`${headCell} text-left w-20`}>Next Date</th>}
              {visibleCols.remark && <th className={`${headCell} text-left w-36`}>Remark</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={visibleColCount} className={`${cell} text-center text-slate-400 py-10`}>Loading…</td></tr>
            ) : pageRows.length === 0 ? (
              <tr><td colSpan={visibleColCount} className={`${cell} text-center text-slate-400 py-10`}>No outstanding bills between {displayDate(dateFrom)} and {displayDate(dateTo)}</td></tr>
            ) : (
              pageRows.map((b, i) => {
                const positive = b.closing_balance > 0;
                const rowIdx = startIdx + i;
                const zebra = rowIdx % 2 === 1 ? 'bg-slate-50' : 'bg-white';
                return (
                  <tr key={rowIdx} ref={i === 0 ? firstRowRef : undefined} className={`${zebra} hover:bg-blue-50`}>
                    <td className={`${cell} text-center text-slate-400 bg-slate-100 tabular-nums`}>{rowIdx + 1}</td>
                    <td className={cell}>
                      <button onClick={() => setFollowupTarget(b)} title={b.bill_name}
                        className="text-blue-600 hover:text-blue-800 hover:underline font-medium truncate block max-w-[120px]">{b.bill_name}</button>
                    </td>
                    {visibleCols.bill_date && (
                      <td className={`${cell} text-slate-600 whitespace-nowrap tabular-nums`}>{displayDate(b.bill_date)}</td>
                    )}
                    <td className={cell}><div className="text-slate-700 truncate max-w-[150px]" title={b.party_name}>{b.party_name}</div></td>
                    {visibleCols.reseller && (
                      <td className={cell}><div className="text-slate-600 truncate max-w-[120px]" title={b.reseller_name || ''}>{b.reseller_name || '—'}</div></td>
                    )}
                    {visibleCols.group && (
                      <td className={cell}><div className="text-slate-600 truncate max-w-[120px]" title={b.group_name || ''}>{b.group_name || '—'}</div></td>
                    )}
                    <td className={`${cell} text-center text-slate-600 tabular-nums`}>{b.age_days}d</td>
                    {visibleCols.opening && (
                      <td className={cellNum + ' text-slate-700'}>{fmt(b.opening_balance)}</td>
                    )}
                    <td className={cellNum + (positive ? ' text-emerald-700' : ' text-red-700') + ' font-semibold'}>
                      {fmt(Math.abs(b.closing_balance))}
                    </td>
                    <td className={`${cell} text-center font-semibold ${positive ? 'text-emerald-700' : 'text-red-700'}`}>
                      {positive ? 'Dr' : 'Cr'}
                    </td>
                    {visibleCols.status && (
                      <td className={`${cell} text-center`}>
                        {b.followup_status ? (
                          <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full ${statusBadge(b.followup_status)}`}>{b.followup_status}</span>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                    )}
                    {visibleCols.person && (
                      <td className={cell}><div className="text-slate-700 truncate max-w-[110px]" title={b.followup_person || ''}>{b.followup_person || <span className="text-slate-300">—</span>}</div></td>
                    )}
                    {visibleCols.number && (
                      <td className={`${cell} text-slate-700 tabular-nums whitespace-nowrap`}>
                        {b.followup_phone ? (
                          <span className="inline-flex items-center gap-1">
                            {b.followup_phone}
                            {(() => {
                              const primary = b.all_contacts.find(c => c.is_primary);
                              if (!primary) return null;
                              const isPrimary = primary.mobile === b.followup_phone;
                              return (
                                <span className={`text-[9px] font-bold px-1 rounded ${isPrimary ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                  {isPrimary ? 'Primary' : 'Alt'}
                                </span>
                              );
                            })()}
                          </span>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                    )}
                    {visibleCols.next_date && (
                      <td className={`${cell} text-slate-600 whitespace-nowrap tabular-nums`}>{b.followup_next_date ? displayDate(b.followup_next_date) : <span className="text-slate-300">—</span>}</td>
                    )}
                    {visibleCols.remark && (
                      <td className={cell}>
                        <div className="text-slate-600 truncate max-w-[150px]" title={b.followup_remark || ''}>{b.followup_remark || <span className="text-slate-300">—</span>}</div>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
          {!loading && sorted.length > 0 && (() => {
            // Leading colSpan covers: #, Bill Name, [Bill Date], Party Name, [Reseller], [Group], Age
            const leadingSpan = 4
              + (visibleCols.bill_date ? 1 : 0)
              + (visibleCols.reseller ? 1 : 0)
              + (visibleCols.group ? 1 : 0);
            const trailingSpan = (['status', 'person', 'number', 'next_date', 'remark'] as ColKey[])
              .filter(k => visibleCols[k]).length;
            return (
              <tfoot ref={tfootRef}>
                <tr className="bg-slate-200 font-bold sticky bottom-0">
                  <td colSpan={leadingSpan} className={`${cell} text-slate-700`}>Grand Total — {totalRows} bills</td>
                  {visibleCols.opening && (
                    <td className={cellNum + ' text-slate-700'}>{fmt(sorted.reduce((s, b) => s + b.opening_balance, 0))}</td>
                  )}
                  <td className={cellNum + ' text-emerald-700'}>{fmt(totals.receivable)}</td>
                  <td className={`${cell} text-center text-slate-600`}>Dr</td>
                  {trailingSpan > 0 && <td colSpan={trailingSpan} className={cell} />}
                </tr>
              </tfoot>
            );
          })()}
        </table>
      </div>

      {/* ── Grand Total — mobile only ── */}
      {!loading && sorted.length > 0 && (
        <div className="sm:hidden flex-none border-t border-slate-200 print:hidden">
          <div className="bg-blue-700 text-white px-4 py-2 flex justify-between items-center">
            <span className="font-bold text-[13px] uppercase tracking-widest">Grand Total</span>
            <span className="text-[12px] tabular-nums opacity-90">{totalRows} bills</span>
          </div>
          <div className="flex divide-x divide-slate-200 bg-white">
            <div className="flex-1 px-3 py-2.5">
              <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">Payable</div>
              <div className="text-[13px] font-bold text-red-600 tabular-nums mt-0.5">{fmt(totals.payable)}</div>
            </div>
            <div className="flex-1 px-3 py-2.5">
              <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">Receivable</div>
              <div className="text-[13px] font-bold text-emerald-700 tabular-nums mt-0.5">{fmt(totals.receivable)}</div>
            </div>
            <div className="flex-1 px-3 py-2.5">
              <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">Bills</div>
              <div className="text-[13px] font-bold text-slate-700 tabular-nums mt-0.5">{totalRows}</div>
            </div>
          </div>
        </div>
      )}

      {/* ── Pagination ── */}
      {totalRows > pageSize && (
        <div className="flex-none flex items-center justify-between px-3 py-2 bg-white border-t border-slate-200 text-[13px] text-slate-700 print:hidden">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-slate-400 hidden sm:inline">Rows:</span>
            <select
              value={autoPageSize ? 'auto' : String(pageSize)}
              onChange={e => {
                if (e.target.value === 'auto') setAutoPageSize(true);
                else { setAutoPageSize(false); setPageSize(Number(e.target.value)); }
              }}
              className="border border-slate-300 rounded px-1.5 py-0.5 text-[13px] bg-white">
              <option value="auto">Auto ({pageSize})</option>
              {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <span className="tabular-nums text-[12px] text-slate-500">{startIdx + 1}–{endIdx} / {totalRows}</span>
          <div className="flex items-center gap-0.5">
            <button onClick={() => setPage(1)} disabled={safePage === 1}
              className="p-1.5 border border-slate-300 rounded bg-white hover:bg-slate-50 disabled:opacity-40">
              <ChevronsLeft size={13} />
            </button>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}
              className="p-1.5 border border-slate-300 rounded bg-white hover:bg-slate-50 disabled:opacity-40">
              <ChevronLeft size={13} />
            </button>
            <span className="px-2 tabular-nums text-[12px]">{safePage} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}
              className="p-1.5 border border-slate-300 rounded bg-white hover:bg-slate-50 disabled:opacity-40">
              <ChevronRight size={13} />
            </button>
            <button onClick={() => setPage(totalPages)} disabled={safePage === totalPages}
              className="p-1.5 border border-slate-300 rounded bg-white hover:bg-slate-50 disabled:opacity-40">
              <ChevronsRight size={13} />
            </button>
          </div>
        </div>
      )}

      {followupTarget && followupTarget.ledger_id != null && (
        <BillFollowupModal
          isOpen={true}
          onClose={() => setFollowupTarget(null)}
          onSuccess={load}
          data={{
            ledger_id: followupTarget.ledger_id,
            party_name: followupTarget.party_name,
            bill_name: followupTarget.bill_name,
            status: followupTarget.followup_status,
            // Bill-specific followup contact wins if one's already been
            // logged; otherwise default to the customer's own primary
            // contact so the fields are never blank on first open.
            person_name: followupTarget.followup_person || followupTarget.customer_person,
            phone_number: followupTarget.followup_phone || followupTarget.customer_mobile,
            next_date: followupTarget.followup_next_date,
            remark: followupTarget.followup_remark,
            contacts: followupTarget.all_contacts,
          }}
        />
      )}
    </div>
  );
}
