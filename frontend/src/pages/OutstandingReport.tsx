import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronUp, ChevronDown, ChevronsUpDown, Filter, RefreshCw, RotateCcw, Search, X } from 'lucide-react';
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
};
type Side = 'all' | 'receivable' | 'payable';
type SortKey = 'bill_name' | 'bill_date' | 'party_name' | 'group_name' | 'reseller_name' | 'age_days' | 'opening_balance' | 'closing_balance';
type SortDir = 'asc' | 'desc';

const PAGE_SIZES = [25, 50, 100, 200];
const STORAGE_KEY = 'outstanding-report-filters';

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

  const initial = (() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return { ...defaultFilters(), ...JSON.parse(saved) };
    } catch { /* ignore */ }
    return defaultFilters();
  })();

  const [dateFrom, setDateFrom] = useState<string>(initial.dateFrom);
  const [dateTo, setDateTo]     = useState<string>(initial.dateTo);
  const [side, setSide]         = useState<Side>(initial.side);
  const [partySearch, setPartySearch] = useState<string>(initial.partySearch);
  const [billNameFilter, setBillNameFilter] = useState<string>(initial.billName);
  const [debouncedParty, setDebouncedParty] = useState<string>(initial.partySearch);
  const [debouncedBill, setDebouncedBill]   = useState<string>(initial.billName);
  const [loading, setLoading] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showFilter, setShowFilter] = useState(false);
  const [bills, setBills] = useState<Bill[]>([]);
  const [totals, setTotals] = useState({ receivable: 0, payable: 0 });

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
    setSide(d.side);
    setPartySearch(d.partySearch);
    setBillNameFilter(d.billName);
  };

  const defaults = defaultFilters();
  const dateRangeChanged = dateFrom !== defaults.dateFrom || dateTo !== defaults.dateTo;
  const filterCount =
    (partySearch ? 1 : 0) +
    (billNameFilter ? 1 : 0) +
    (side !== 'all' ? 1 : 0) +
    (dateRangeChanged ? 1 : 0);

  const [sortKey, setSortKey] = useState<SortKey>('bill_date');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(10);

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
  useEffect(() => { setPage(1); }, [debouncedParty, debouncedBill, side, dateFrom, dateTo, pageSize, sortKey, sortDir]);

  const sorted = useMemo(() => {
    const arr = [...bills];
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
  }, [bills, sortKey, sortDir]);

  const totalRows = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, totalRows);
  const pageRows = sorted.slice(startIdx, endIdx);

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

  const cell = 'border border-slate-300 px-2.5 py-1.5 text-[14px] leading-snug';
  const cellNum = `${cell} text-right tabular-nums whitespace-nowrap`;
  const headCell = 'border border-slate-400 bg-slate-200 px-2.5 py-1.5 text-[13px] font-bold text-slate-700 uppercase tracking-wide sticky top-0 z-10';
  const headBtn = 'flex items-center select-none cursor-pointer hover:text-blue-700';

  return (
    <div className="flex flex-col h-[calc(100vh-56px)] md:h-[calc(100vh-72px)] w-full">

      {/* ── Header bar ── */}
      <div className="flex-none bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button onClick={() => navigate(-1)} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 -ml-1" title="Back">
            <ChevronLeft size={20} />
          </button>
          <h1 className="text-[17px] font-bold text-slate-800">Outstanding Report</h1>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setShowSearch(s => !s); setShowFilter(false); }}
            className={`p-2 rounded-lg transition-colors ${showSearch ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
            title="Search"
          >
            <Search size={18} />
          </button>
          <button
            onClick={() => { setShowFilter(s => !s); setShowSearch(false); }}
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
            onClick={load}
            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"
            title="Refresh"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ── Stats bar ── */}
      <div className="flex-none bg-white border-b border-slate-200">
        <div className="flex divide-x divide-slate-200">
          <div className="flex-1 px-3 py-2.5">
            <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">Payable</div>
            <div className="text-[14px] font-bold text-red-600 tabular-nums mt-0.5">{fmt(totals.payable)}</div>
          </div>
          <div className="flex-1 px-3 py-2.5">
            <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">Receivable</div>
            <div className="text-[14px] font-bold text-emerald-600 tabular-nums mt-0.5">{fmt(totals.receivable)}</div>
          </div>
          <div className="px-3 py-2.5 flex flex-col items-end justify-center">
            <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">Bills</div>
            <div className="text-[14px] font-bold text-slate-700 tabular-nums mt-0.5">{totalRows}</div>
          </div>
        </div>
      </div>

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
          <div className="relative">
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
          <div className="flex gap-2">
            <div className="flex-1 flex items-stretch border border-slate-300 rounded-lg bg-white overflow-hidden">
              <div className="flex items-center px-2 border-r border-slate-300 bg-slate-100">
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wide">From</span>
              </div>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="flex-1 text-[13px] text-slate-700 outline-none bg-transparent px-2 py-1.5 min-w-0" />
            </div>
            <div className="flex-1 flex items-stretch border border-slate-300 rounded-lg bg-white overflow-hidden">
              <div className="flex items-center px-2 border-r border-slate-300 bg-slate-100">
                <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wide">To</span>
              </div>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="flex-1 text-[13px] text-slate-700 outline-none bg-transparent px-2 py-1.5 min-w-0" />
            </div>
          </div>
          <div className="flex gap-2">
            <select value={side} onChange={e => setSide(e.target.value as Side)}
              className="flex-1 text-[13px] border border-slate-300 rounded-lg px-3 py-2 bg-white outline-none">
              <option value="all">All sides</option>
              <option value="receivable">Receivable only</option>
              <option value="payable">Payable only</option>
            </select>
            <button onClick={resetAll} disabled={filterCount === 0}
              className="flex items-center gap-1.5 px-3 py-2 border border-slate-300 rounded-lg text-[13px] text-slate-600 bg-white hover:bg-slate-100 disabled:opacity-40">
              <RotateCcw size={13} /> Reset
            </button>
          </div>
        </div>
      )}

      {/* ── Mobile scrollable rows ── */}
      <div className="sm:hidden flex-1 min-h-0 overflow-auto bg-white">
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
          const amountSide = positive ? 'Dr' : 'Cr';
          const subInfo = [displayDate(b.bill_date), b.bill_name].filter(Boolean).join('  |  ');
          return (
            <div key={rowIdx} className="border-b border-slate-100 active:bg-slate-50">
              <div className="flex items-start justify-between px-4 py-3">
                <div className="flex-1 min-w-0 pr-3">
                  <div className="font-semibold text-slate-900 text-[15px] leading-snug truncate">{b.party_name}</div>
                  <div className="text-[12px] text-slate-400 mt-0.5">{subInfo}</div>
                  {(b.reseller_name || b.age_days != null) && (
                    <div className="text-[12px] text-slate-400 mt-0.5">
                      {b.reseller_name ? `${b.reseller_name}  ·  ` : ''}Age: {b.age_days} days
                    </div>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <span className={`text-[15px] font-semibold tabular-nums ${positive ? 'text-emerald-700' : 'text-red-600'}`}>
                    {fmt(Math.abs(b.closing_balance))} {amountSide}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Desktop table ── */}
      <div className="hidden sm:block flex-1 min-h-0 overflow-auto bg-white border border-slate-300 mx-3 mb-1 mt-1">
        <table className="border-collapse text-[14px] w-full">
          <thead>
            <tr>
              <th className={`${headCell} text-center w-10`}>#</th>
              <th className={`${headCell} text-left w-36`}>
                <div className={headBtn} onClick={() => toggleSort('bill_name')}>Bill Name<SortIcon col="bill_name" /></div>
              </th>
              <th className={`${headCell} text-left w-28`}>
                <div className={headBtn} onClick={() => toggleSort('bill_date')}>Bill Date<SortIcon col="bill_date" /></div>
              </th>
              <th className={`${headCell} text-left`}>
                <div className={headBtn} onClick={() => toggleSort('party_name')}>Party Name<SortIcon col="party_name" /></div>
              </th>
              <th className={`${headCell} text-left w-40`}>
                <div className={headBtn} onClick={() => toggleSort('reseller_name')}>Reseller<SortIcon col="reseller_name" /></div>
              </th>
              <th className={`${headCell} text-left w-40`}>
                <div className={headBtn} onClick={() => toggleSort('group_name')}>Group<SortIcon col="group_name" /></div>
              </th>
              <th className={`${headCell} text-center w-16`}>
                <div className={headBtn + ' justify-center'} onClick={() => toggleSort('age_days')}>Age<SortIcon col="age_days" /></div>
              </th>
              <th className={`${headCell} text-right w-36`}>
                <div className={headBtn + ' justify-end'} onClick={() => toggleSort('opening_balance')}>Opening<SortIcon col="opening_balance" /></div>
              </th>
              <th className={`${headCell} text-right w-36`}>
                <div className={headBtn + ' justify-end'} onClick={() => toggleSort('closing_balance')}>Closing<SortIcon col="closing_balance" /></div>
              </th>
              <th className={`${headCell} text-center w-12`}>Dr/Cr</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className={`${cell} text-center text-slate-400 py-10`}>Loading…</td></tr>
            ) : pageRows.length === 0 ? (
              <tr><td colSpan={10} className={`${cell} text-center text-slate-400 py-10`}>No outstanding bills between {displayDate(dateFrom)} and {displayDate(dateTo)}</td></tr>
            ) : (
              pageRows.map((b, i) => {
                const positive = b.closing_balance > 0;
                const rowIdx = startIdx + i;
                const zebra = rowIdx % 2 === 1 ? 'bg-slate-50' : 'bg-white';
                return (
                  <tr key={rowIdx} className={`${zebra} hover:bg-blue-50`}>
                    <td className={`${cell} text-center text-slate-400 bg-slate-100 tabular-nums`}>{rowIdx + 1}</td>
                    <td className={`${cell} font-medium text-slate-800 whitespace-nowrap`}>{b.bill_name}</td>
                    <td className={`${cell} text-slate-600 whitespace-nowrap tabular-nums`}>{displayDate(b.bill_date)}</td>
                    <td className={`${cell} text-slate-700`}>{b.party_name}</td>
                    <td className={`${cell} text-slate-600`}>{b.reseller_name || '—'}</td>
                    <td className={`${cell} text-slate-600`}>{b.group_name || '—'}</td>
                    <td className={`${cell} text-center text-slate-600 tabular-nums`}>{b.age_days}d</td>
                    <td className={cellNum + ' text-slate-700'}>{fmt(b.opening_balance)}</td>
                    <td className={cellNum + (positive ? ' text-emerald-700' : ' text-red-700') + ' font-semibold'}>
                      {fmt(Math.abs(b.closing_balance))}
                    </td>
                    <td className={`${cell} text-center font-semibold ${positive ? 'text-emerald-700' : 'text-red-700'}`}>
                      {positive ? 'Dr' : 'Cr'}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {!loading && sorted.length > 0 && (
            <tfoot>
              <tr className="bg-slate-200 font-bold sticky bottom-0">
                <td colSpan={7} className={`${cell} text-slate-700`}>Grand Total — {totalRows} bills</td>
                <td className={cellNum + ' text-slate-700'}>{fmt(sorted.reduce((s, b) => s + b.opening_balance, 0))}</td>
                <td className={cellNum + ' text-emerald-700'}>{fmt(totals.receivable)}</td>
                <td className={`${cell} text-center text-slate-600`}>Dr</td>
              </tr>
            </tfoot>
          )}
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
            <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))}
              className="border border-slate-300 rounded px-1.5 py-0.5 text-[13px] bg-white">
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
    </div>
  );
}
