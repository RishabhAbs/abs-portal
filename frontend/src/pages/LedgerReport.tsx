import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, ChevronDown, ChevronUp, ChevronsUpDown, ChevronLeft, ChevronRight, RefreshCw, RotateCcw, Search, X, Printer } from 'lucide-react';
import { customersApi, vouchersApi } from '../services/api';
import { useToast } from '../components/Toast/Toast';
import { useAuth } from '../context/AuthContext';

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
  if (!s) return '';
  const d = new Date(s);
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
};

function fyBounds(d: Date) {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return { from: new Date(y, 3, 1), to: new Date(y + 1, 2, 31) };
}

type Row = {
  vch_id: number;
  vch_no: string | null;
  vch_date: string | null;
  vch_type_name: string | null;
  vch_subtype_name: string | null;
  is_first: boolean;
  is_last: boolean;
  particulars: string;
  debit: number;
  credit: number;
  running_balance: number | null;
  remark: string | null;
  bill_names: string | null;
};
type SortKey = 'vch_date' | 'vch_no' | 'vch_type_name' | 'particulars' | 'debit' | 'credit';
type SortDir = 'asc' | 'desc';

const STORAGE_KEY = 'ledger-report-filters';

export default function LedgerReport() {
  const navigate = useNavigate();
  const { showError } = useToast();
  const { canEdit } = useAuth();
  // Voucher edit allowed via any of: vouchers.edit (granular), the
  // ledger-report's own .edit (so report-only users can drill in), or
  // activities.edit (legacy umbrella).
  const canEditVouchers = canEdit('vouchers') || canEdit('reports_ledger') || canEdit('activities');

  // Defaults: this FY → today.
  const today = new Date();
  const { from: fyFrom } = fyBounds(today);

  // Only the date filters are restored from storage. The ledger itself is
  // intentionally not — refresh always starts with no party selected so the
  // user gets a clean picker (matches Tally's behaviour).
  const initial = (() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch { /* ignore */ }
    return null;
  })();

  const [showControls, setShowControls] = useState(false);
  const [ledgerId, setLedgerId] = useState<number | null>(null);
  const [ledgerName, setLedgerName] = useState<string>('');
  const [dateFrom, setDateFrom] = useState<string>(initial?.dateFrom ?? toInputDate(fyFrom));
  const [dateTo, setDateTo]     = useState<string>(initial?.dateTo ?? toInputDate(today));
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [picker, setPicker] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerResults, setPickerResults] = useState<any[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  const snapDoneRef = React.useRef<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [opening, setOpening] = useState(0);
  const [closing, setClosing] = useState(0);
  const [totals, setTotals] = useState({ debit: 0, credit: 0 });

  const [sortKey, setSortKey] = useState<SortKey>('vch_date');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Persist only the date range — never the ledger choice. Reload should
  // start with a clean ledger picker.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ dateFrom, dateTo }));
    } catch { /* ignore */ }
  }, [dateFrom, dateTo]);

  // Debounce search-within-results
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Picker autocomplete (debounced)
  useEffect(() => {
    if (!picker.trim()) { setPickerResults([]); return; }
    const t = setTimeout(async () => {
      setPickerLoading(true);
      try {
        const res = await customersApi.searchAllLedgers(picker.trim());
        setPickerResults(res.success ? res.data : []);
      } catch { setPickerResults([]); }
      finally { setPickerLoading(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [picker]);

  const load = useCallback(async () => {
    if (!ledgerId) { setRows([]); setOpening(0); setClosing(0); return; }
    setLoading(true);
    try {
      const res = await vouchersApi.getLedger({
        ledger_id: ledgerId,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        search: debouncedSearch || undefined,
      });
      if (res.success) {
        const newRows: Row[] = res.data.rows || [];
        setRows(newRows);
        setOpening(res.data.opening || 0);
        setClosing(res.data.closing || 0);
        setTotals({ debit: res.data.totalDebit || 0, credit: res.data.totalCredit || 0 });
        if (res.data.ledger && res.data.ledger.company !== ledgerName) {
          setLedgerName(res.data.ledger.company);
        }
        // Snap "From"/"To" to the most recent entry's month — but only on
        // the first load for this ledger so manual date changes aren't overridden.
        if (snapDoneRef.current !== ledgerId) {
          snapDoneRef.current = ledgerId;
          let latest: Date | null = null;
          for (const r of newRows) {
            if (!r.vch_date) continue;
            const d = new Date(r.vch_date);
            if (!latest || d > latest) latest = d;
          }
          if (latest) {
            const monthStart = toInputDate(new Date(latest.getFullYear(), latest.getMonth(), 1));
            const monthEnd = toInputDate(new Date(latest.getFullYear(), latest.getMonth() + 1, 0));
            if (monthStart !== dateFrom) setDateFrom(monthStart);
            if (monthEnd !== dateTo) setDateTo(monthEnd);
          }
        }
      }
    } catch {
      showError('Error', 'Failed to load ledger');
    } finally {
      setLoading(false);
    }
  }, [ledgerId, dateFrom, dateTo, debouncedSearch, ledgerName, showError]);

  useEffect(() => { load(); }, [load]);

  const selectLedger = (l: any) => {
    setLedgerId(l.id);
    setLedgerName(l.company);
    setPicker('');
    setPickerOpen(false);
    setPickerResults([]);
  };

  const clearLedger = () => {
    setLedgerId(null);
    setLedgerName('');
    setRows([]);
    setOpening(0);
    setClosing(0);
  };

  const resetDates = () => {
    setDateFrom(toInputDate(fyFrom));
    setDateTo(toInputDate(today));
  };

  // Sorting must keep multi-line vouchers grouped — sort by voucher group,
  // then preserve the contra-line order within each voucher.
  const sorted = useMemo(() => {
    if (rows.length === 0) return rows;
    // Build voucher groups (preserving contra order within).
    const groups: Row[][] = [];
    let cur: Row[] = [];
    for (const r of rows) {
      if (r.is_first && cur.length) { groups.push(cur); cur = []; }
      cur.push(r);
    }
    if (cur.length) groups.push(cur);

    const dir = sortDir === 'asc' ? 1 : -1;
    groups.sort((ga, gb) => {
      const a = ga[0]; const b = gb[0];
      if (sortKey === 'vch_date') {
        const at = a.vch_date ? new Date(a.vch_date).getTime() : 0;
        const bt = b.vch_date ? new Date(b.vch_date).getTime() : 0;
        return (at - bt) * dir;
      }
      if (sortKey === 'debit')   return ((ga.reduce((s, r) => s + r.debit, 0))  - (gb.reduce((s, r) => s + r.debit, 0)))  * dir;
      if (sortKey === 'credit')  return ((ga.reduce((s, r) => s + r.credit, 0)) - (gb.reduce((s, r) => s + r.credit, 0))) * dir;
      const av = a[sortKey] as any;
      const bv = b[sortKey] as any;
      return String(av ?? '').localeCompare(String(bv ?? '')) * dir;
    });
    return groups.flat();
  }, [rows, sortKey, sortDir]);

  // Paginate by voucher group (10 vouchers per page) — never split a multi-line
  // voucher across pages. Opening / Total / Closing in the footer always
  // reflect the FULL date range, not just the visible page, since they come
  // from the backend aggregate.
  const PAGE_SIZE = 10;
  const [page, setPage] = useState(1);
  // While `printing` is true, the visible-rows memo ignores pagination so
  // every row in the date range is rendered. After window.print() resolves
  // we flip it back; an afterprint listener also clears it as a safety net
  // in case the user cancels the print dialog.
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const onAfter = () => setPrinting(false);
    window.addEventListener('afterprint', onAfter);
    return () => window.removeEventListener('afterprint', onAfter);
  }, []);
  const handlePrint = () => {
    if (!ledgerId) return;
    setPrinting(true);
    // Defer print() so React commits the all-rows render first; otherwise
    // the dialog opens against the still-paginated DOM.
    setTimeout(() => window.print(), 50);
  };
  const voucherGroups = useMemo(() => {
    const groups: Row[][] = [];
    let cur: Row[] = [];
    for (const r of sorted) {
      if (r.is_first && cur.length) { groups.push(cur); cur = []; }
      cur.push(r);
    }
    if (cur.length) groups.push(cur);
    return groups;
  }, [sorted]);
  const totalPages = Math.max(1, Math.ceil(voucherGroups.length / PAGE_SIZE));
  // Reset to first page whenever the dataset shape changes.
  useEffect(() => { setPage(1); }, [ledgerId, dateFrom, dateTo, sortKey, sortDir, search]);
  // Clamp page if rows shrunk (e.g. after a search filter narrowed results).
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
  const visibleRows = useMemo(() => {
    if (printing) return voucherGroups.flat();
    const start = (page - 1) * PAGE_SIZE;
    return voucherGroups.slice(start, start + PAGE_SIZE).flat();
  }, [voucherGroups, page, printing]);

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

  // Click vch no. → open the voucher in the Vouchers page via a URL
  // (`/billing/vouchers/edit/:id`) so the route reflects which voucher is
  // open and refresh preserves the edit context. The readOnly flag rides
  // along in state — editable when the user has voucher / activities edit
  // perm, otherwise read-only (every input disabled, Save hidden).
  const openVoucher = (vchId: number) => {
    navigate(`/billing/vouchers/edit/${vchId}`, {
      state: {
        readOnly: !canEditVouchers,
      },
    });
  };

  // Excel-style cells
  const cell = 'border border-slate-300 px-2.5 py-1.5 text-[14px] leading-snug';
  const cellNum = `${cell} text-right tabular-nums whitespace-nowrap`;
  const headCell = 'border border-slate-400 bg-slate-200 px-2.5 py-1.5 text-[13px] font-bold text-slate-700 uppercase tracking-wide sticky top-0 z-10';
  const headBtn = 'flex items-center select-none cursor-pointer hover:text-blue-700';

  return (
    <div className="flex flex-col w-full ledger-report-root fixed left-0 right-0 top-14 bottom-16 sm:static sm:h-full sm:top-auto sm:bottom-auto" style={{ overscrollBehavior: 'contain' }}>
      {/* Print-only header — only renders to paper. Browsers ignore display
          for screen because the @media print rules in index.css show it. */}
      <div className="print-only mb-3" aria-hidden>
        <h1 className="text-xl font-bold mb-1">Ledger Statement</h1>
        <div className="text-sm">
          <strong>{ledgerName || '—'}</strong>
          <span className="ml-3">From {displayDate(dateFrom)} to {displayDate(dateTo)}</span>
        </div>
      </div>
      {/* ── Header bar ── */}
      <div className="flex-none bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between print:hidden">
        <div className="flex items-center gap-1 min-w-0">
          <button onClick={() => navigate(-1)} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 -ml-1 flex-shrink-0" title="Back">
            <ChevronLeft size={20} />
          </button>
          <h1 className="text-[17px] font-bold text-slate-800 truncate">Ledger Report</h1>
          {ledgerName && (
            <span className="text-[13px] font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded flex-shrink-0 ml-1 truncate max-w-[130px]">
              {ledgerName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => setShowControls(s => !s)}
            className={`p-2 rounded-lg transition-colors ${showControls ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
            title="Search & filters">
            <Search size={18} />
          </button>
          <button onClick={handlePrint} disabled={!ledgerId || rows.length === 0}
            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-40"
            title={!ledgerId ? 'Pick a ledger first' : 'Print'}>
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
          <div className="flex flex-col gap-2">
            {/* Ledger picker */}
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={picker}
                onChange={e => { setPicker(e.target.value); setPickerOpen(true); }}
                onFocus={() => picker.trim() && setPickerOpen(true)}
                onBlur={() => setTimeout(() => setPickerOpen(false), 200)}
                placeholder={ledgerName ? 'Change ledger…' : 'Pick a ledger / party…'}
                autoFocus
                className="w-full pl-9 pr-7 py-2 border border-slate-300 rounded-lg text-[13px] outline-none focus:ring-2 focus:ring-blue-300 bg-white"
              />
              {picker && (
                <button onMouseDown={() => setPicker('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  <X size={12} />
                </button>
              )}
              {pickerOpen && (pickerResults.length > 0 || pickerLoading) && (
                <div className="absolute z-30 mt-1 w-full bg-white border border-slate-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                  {pickerLoading && <div className="px-3 py-2 text-xs text-slate-400">Searching…</div>}
                  {pickerResults.map((l: any) => (
                    <button key={l.id} onMouseDown={() => selectLedger(l)}
                      className="w-full text-left px-3 py-1.5 text-[13px] hover:bg-blue-50 border-b last:border-0">
                      <div className="font-medium text-slate-800">{l.company}</div>
                      {l.ledgergroup_name && <div className="text-[11px] text-slate-500">{l.ledgergroup_name}</div>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Search within results */}
              <div className="flex-1 min-w-[140px]">
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search vch no / remark…"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-[13px] outline-none focus:ring-2 focus:ring-blue-300 bg-white"
                />
              </div>
              {/* Date range */}
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
              <button onClick={resetDates} title="Reset dates to FY"
                className="p-2 border border-slate-300 rounded-lg hover:bg-slate-100 bg-white text-slate-500">
                <RotateCcw size={14} />
              </button>
              {ledgerId && (
                <button onClick={clearLedger}
                  className="px-3 py-2 border border-slate-300 rounded-lg hover:bg-slate-100 bg-white text-[13px] text-slate-600">
                  <X size={12} className="inline mr-0.5" /> Clear
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {!ledgerId ? (
        <div className="bg-white border border-slate-300 p-12 text-center text-slate-500 text-sm">
          Pick a ledger / party from the search above to view their statement.
        </div>
      ) : (
        <>

          {/* Mobile flat list — Tally-style, shown only on xs screens (hidden on sm+) */}
          <div className="sm:hidden flex-1 min-h-0 overflow-auto bg-white" style={{ overscrollBehavior: 'contain' }}>
            {loading ? (
              <div className="py-10 text-center text-gray-400 text-sm">Loading…</div>
            ) : sorted.length === 0 ? (
              <div className="py-10 text-center text-gray-400 text-sm">No transactions in this range</div>
            ) : (() => {
              // Group voucher rows so multi-line vouchers appear as a single row.
              const groups: Row[][] = [];
              let cur: Row[] = [];
              for (const r of visibleRows) {
                if (r.is_first && cur.length) { groups.push(cur); cur = []; }
                cur.push(r);
              }
              if (cur.length) groups.push(cur);

              return (
                <>
                  {groups.map((grp, gi) => {
                    const first = grp[0];
                    const totalDr = grp.reduce((s, r) => s + r.debit, 0);
                    const totalCr = grp.reduce((s, r) => s + r.credit, 0);
                    const amountVal = totalDr > 0 ? totalDr : totalCr;
                    const amountSide = totalDr > 0 ? 'Dr' : 'Cr';
                    const subInfo = [
                      displayDate(first.vch_date),
                      first.vch_subtype_name && first.vch_subtype_name !== first.vch_type_name
                        ? first.vch_subtype_name
                        : null,
                      first.vch_no ? `#${first.vch_no}` : null,
                    ].filter(Boolean).join('  |  ');
                    return (
                      <div
                        key={`m-${first.vch_id}-${gi}`}
                        className="border-b border-gray-200"
                        onClick={() => first.vch_no && openVoucher(first.vch_id)}
                      >
                        <div className="flex items-start justify-between px-4 py-3">
                          <div className="flex-1 min-w-0 pr-3">
                            <div className="font-bold text-gray-900 text-[15px] uppercase leading-snug">
                              {first.vch_type_name || '—'}
                            </div>
                            <div className="text-[13px] text-gray-500 mt-0.5">{subInfo}</div>
                            {first.particulars && (
                              <div className="text-[13px] text-gray-500 mt-0.5 truncate">{first.particulars}</div>
                            )}
                          </div>
                          <div className="shrink-0 text-right">
                            <span className="text-[15px] font-medium text-gray-900 tabular-nums">
                              {fmt(amountVal)} {amountSide}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </>
              );
            })()}
          </div>

          {/* Table — `print:overflow-visible print:max-h-none` lets every
              row paginate naturally onto paper instead of being clipped to
              the on-screen scroll viewport. */}
          <div className="hidden sm:block bg-white border border-slate-300 overflow-auto max-h-[calc(100vh-220px)] print:overflow-visible print:max-h-none print:border-slate-400">
            <table className="border-collapse text-[14px] w-full">
              <thead>
                <tr>
                  <th className={`${headCell} text-left w-28`}>
                    <div className={headBtn} onClick={() => toggleSort('vch_date')}>Vch Date<SortIcon col="vch_date" /></div>
                  </th>
                  <th className={`${headCell} text-left`}>
                    <div className={headBtn} onClick={() => toggleSort('particulars')}>Particulars<SortIcon col="particulars" /></div>
                  </th>
                  <th className={`${headCell} text-left w-36`}>
                    <div className={headBtn} onClick={() => toggleSort('vch_no')}>Vch No.<SortIcon col="vch_no" /></div>
                  </th>
                  <th className={`${headCell} text-left w-28`}>
                    <div className={headBtn} onClick={() => toggleSort('vch_type_name')}>Vch Type<SortIcon col="vch_type_name" /></div>
                  </th>
                  <th className={`${headCell} text-right w-32`}>
                    <div className={headBtn + ' justify-end'} onClick={() => toggleSort('debit')}>Debit<SortIcon col="debit" /></div>
                  </th>
                  <th className={`${headCell} text-right w-32`}>
                    <div className={headBtn + ' justify-end'} onClick={() => toggleSort('credit')}>Credit<SortIcon col="credit" /></div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className={`${cell} text-center text-slate-400 py-6`}>Loading…</td></tr>
                ) : sorted.length === 0 ? (
                  <tr><td colSpan={6} className={`${cell} text-center text-slate-400 py-6`}>No transactions in this range</td></tr>
                ) : (() => {
                  // Walk rows; alternate zebra per voucher (not per contra
                  // line) so multi-line vouchers stay visually grouped.
                  let voucherIdx = -1;
                  return visibleRows.map(r => {
                    if (r.is_first) voucherIdx++;
                    const zebra = voucherIdx % 2 === 1 ? 'bg-slate-50' : 'bg-white';
                    const continuation = !r.is_first;
                    return (
                      <tr key={`${r.vch_id}-${r.particulars}-${r.is_first}-${r.is_last}`} className={`${zebra} hover:bg-blue-50`}>
                        <td className={`${cell} ${continuation ? 'border-t-transparent' : ''} text-slate-600 whitespace-nowrap tabular-nums`}>
                          {r.is_first ? displayDate(r.vch_date) : ''}
                        </td>
                        <td className={`${cell} ${continuation ? 'pl-6 text-slate-700 border-t-transparent' : 'text-slate-800'}`}>
                          <div>{r.particulars}</div>
                          {r.is_first && r.bill_names && (
                            <div className="text-xs text-slate-500 mt-0.5">
                              <span className="font-medium">Bill Refs:</span> {r.bill_names}
                            </div>
                          )}
                          {r.is_first && r.remark && (
                            <div className="text-xs text-slate-400 italic mt-0.5">
                              {r.remark}
                            </div>
                          )}
                        </td>
                        <td className={`${cell} ${continuation ? 'border-t-transparent' : ''} whitespace-nowrap`}>
                          {r.is_first && r.vch_no ? (
                            <button
                              onClick={() => openVoucher(r.vch_id)}
                              className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
                              title={canEditVouchers ? 'Open in edit mode' : 'View only — no edit permission'}
                            >
                              {r.vch_no}
                            </button>
                          ) : (r.is_first ? '—' : '')}
                        </td>
                        <td className={`${cell} ${continuation ? 'border-t-transparent' : ''} text-slate-700 whitespace-nowrap`}>
                          {r.is_first
                            ? ((r.vch_subtype_name && r.vch_subtype_name !== r.vch_type_name) ? r.vch_subtype_name : (r.vch_type_name || '—'))
                            : ''}
                        </td>
                        <td className={`${cellNum} ${continuation ? 'border-t-transparent' : ''} ${r.debit  > 0 ? 'text-emerald-700' : 'text-slate-300'}`}>
                          {r.debit  > 0 ? fmt(r.debit)  : '—'}
                        </td>
                        <td className={`${cellNum} ${continuation ? 'border-t-transparent' : ''} ${r.credit > 0 ? 'text-red-700' : 'text-slate-300'}`}>
                          {r.credit > 0 ? fmt(r.credit) : '—'}
                        </td>
                      </tr>
                    );
                  });
                })()}
                {/* Footer — Opening → Total → Closing, in that order, all
                    after the transactions. Total counts only the
                    transactions (it does NOT fold the opening into the
                    column sums). Closing = Opening + transactions net. */}
                {(() => {
                  const totalDr = +totals.debit.toFixed(2);
                  const totalCr = +totals.credit.toFixed(2);
                  return (
                    <>
                      <tr className="bg-amber-50 border-t-2 border-slate-300">
                        <td className={cell + ' bg-amber-50 text-slate-500 italic'}>—</td>
                        <td className={cell + ' bg-amber-50 italic font-semibold text-slate-700'} colSpan={3}>Opening Balance</td>
                        <td className={cellNum + ' bg-amber-50 ' + (opening > 0 ? 'text-emerald-700 font-semibold' : 'text-slate-300')}>
                          {opening > 0 ? fmt(opening) : '—'}
                        </td>
                        <td className={cellNum + ' bg-amber-50 ' + (opening < 0 ? 'text-red-700 font-semibold' : 'text-slate-300')}>
                          {opening < 0 ? fmt(Math.abs(opening)) : '—'}
                        </td>
                      </tr>
                      <tr className="bg-slate-100 font-semibold">
                        <td className={cell + ' bg-slate-100 text-slate-500 italic'}>—</td>
                        <td className={cell + ' bg-slate-100 text-slate-700'} colSpan={3}>Total</td>
                        <td className={cellNum + ' bg-slate-100 text-emerald-800'}>{fmt(totalDr)}</td>
                        <td className={cellNum + ' bg-slate-100 text-red-800'}>{fmt(totalCr)}</td>
                      </tr>
                      <tr className="bg-slate-200 font-bold sticky bottom-0">
                        <td className={cell + ' bg-slate-200 text-slate-500 italic'}>—</td>
                        <td className={cell + ' bg-slate-200 italic text-slate-700'} colSpan={3}>Closing Balance</td>
                        <td className={cellNum + ' bg-slate-200 ' + (closing > 0 ? 'text-emerald-800' : 'text-slate-300')}>
                          {closing > 0 ? fmt(closing) : '—'}
                        </td>
                        <td className={cellNum + ' bg-slate-200 ' + (closing < 0 ? 'text-red-800' : 'text-slate-300')}>
                          {closing < 0 ? fmt(Math.abs(closing)) : '—'}
                        </td>
                      </tr>
                    </>
                  );
                })()}
              </tbody>
            </table>
          </div>

          {/* Mobile — Grand Total fixed above pagination */}
          {!loading && sorted.length > 0 && (() => {
            const totalDr = +totals.debit.toFixed(2);
            const totalCr = +totals.credit.toFixed(2);
            const openingAbs = Math.abs(opening);
            const openingSide = opening >= 0 ? 'Dr' : 'Cr';
            const closingAbs = Math.abs(closing);
            const closingSide = closing >= 0 ? 'Dr' : 'Cr';
            return (
              <div className="sm:hidden flex-none border-t border-gray-200 print:hidden">
                <div className="bg-blue-700 text-white px-4 py-2.5 flex justify-between items-center">
                  <span className="font-bold text-sm tracking-widest">GRAND TOTAL</span>
                  <span className="text-xs tabular-nums">Op: {fmt(openingAbs)} {openingSide}</span>
                </div>
                <div className="flex divide-x divide-gray-200 bg-white">
                  <div className="flex-1 px-3 py-2.5">
                    <div className="text-[10px] uppercase text-gray-400 font-bold tracking-wide">Debit</div>
                    <div className="text-[14px] font-bold text-emerald-700 tabular-nums mt-0.5">{fmt(totalDr)}</div>
                  </div>
                  <div className="flex-1 px-3 py-2.5">
                    <div className="text-[10px] uppercase text-gray-400 font-bold tracking-wide">Credit</div>
                    <div className="text-[14px] font-bold text-red-600 tabular-nums mt-0.5">{fmt(totalCr)}</div>
                  </div>
                  <div className="flex-1 px-3 py-2.5">
                    <div className="text-[10px] uppercase text-gray-400 font-bold tracking-wide">Closing {closingSide}</div>
                    <div className="text-[14px] font-bold text-blue-700 tabular-nums mt-0.5">{fmt(closingAbs)}</div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Pagination — flex-none keeps it at bottom */}
          {voucherGroups.length > PAGE_SIZE && (
            <div className="flex-none flex items-center justify-between px-3 py-2 border-t border-slate-200 bg-white text-xs text-slate-600 print:hidden">
              <div>Vouchers {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, voucherGroups.length)} of {voucherGroups.length}</div>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  className="p-1 rounded border border-slate-300 bg-white disabled:opacity-30 hover:bg-slate-50"><ChevronLeft size={14} /></button>
                <span className="px-2">Page {page} of {totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                  className="p-1 rounded border border-slate-300 bg-white disabled:opacity-30 hover:bg-slate-50"><ChevronRight size={14} /></button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
