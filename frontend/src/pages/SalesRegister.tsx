import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Calendar, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  ChevronUp, ChevronDown, ChevronsUpDown, RefreshCw, Search, X,
  ExternalLink, Printer, ArrowLeft,
} from 'lucide-react';
import { vouchersApi } from '../services/api';
import { useToast } from '../components/Toast/Toast';

const fmt = (n: any) =>
  Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const toInputDate = (d: Date) => d.toISOString().split('T')[0];
const displayDate = (s?: string | null) => {
  if (!s) return '—';
  const d = new Date(s);
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
};
const MONTHS_LONG = ['January','February','March','April','May','June','July','August','September','October','November','December'];

type MonthRow = {
  year: number;
  month: number;
  voucher_count: number;
  debit_total: number;
  credit_total: number;
  gross_total: number;
};
type VchRow = {
  vch_id: number;
  vch_no: string | null;
  vch_date: string | null;
  vch_type_name: string | null;
  vch_subtype_name: string | null;
  party_name: string;
  party_gst: string | null;
  party_state: string | null;
  item_count: number;
  taxable_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  other_charges: number;
  total_amount: number;
};
type DetailSortKey = 'vch_date' | 'vch_no' | 'party_name' | 'taxable_amount' | 'total_amount';
type SortDir = 'asc' | 'desc';
const PAGE_SIZES = [10, 25, 50, 100];
const STORAGE_KEY = 'sales-register-filters';

function fyBounds(d: Date) {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return { from: new Date(y, 3, 1), to: new Date(y + 1, 2, 31) };
}
function defaultFilters() {
  const today = new Date();
  const { from } = fyBounds(today);
  return { dateFrom: toInputDate(from), dateTo: toInputDate(today) };
}
// Last day of a month — used to clamp the drill-down's date range so a
// pick of "May 2026" runs queries for 01-May to 31-May regardless of the
// outer report's overall window.
function monthBounds(year: number, month: number /* 1-12 */) {
  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 0); // day 0 of next month = last day of this month
  return { from: toInputDate(from), to: toInputDate(to) };
}

export default function SalesRegister() {
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
  const [loading, setLoading] = useState(false);
  const [monthRows, setMonthRows] = useState<MonthRow[]>([]);
  const [monthTotals, setMonthTotals] = useState({ voucher_count: 0, debit_total: 0, credit_total: 0, gross_total: 0 });

  // Detail state — populated when the user drills into a month.
  const [detailMonth, setDetailMonth] = useState<{ year: number; month: number } | null>(null);
  const [detailRows, setDetailRows] = useState<VchRow[]>([]);
  const [detailTotals, setDetailTotals] = useState({ taxable: 0, cgst: 0, sgst: 0, igst: 0, other: 0, total: 0 });
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailSearch, setDetailSearch] = useState('');
  const [debouncedDetailSearch, setDebouncedDetailSearch] = useState('');

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ dateFrom, dateTo })); } catch { /* ignore */ }
  }, [dateFrom, dateTo]);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedDetailSearch(detailSearch), 300);
    return () => clearTimeout(t);
  }, [detailSearch]);

  const [showControls, setShowControls] = useState(false);
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const onAfter = () => setPrinting(false);
    window.addEventListener('afterprint', onAfter);
    return () => window.removeEventListener('afterprint', onAfter);
  }, []);
  const handlePrint = () => {
    if ((detailMonth ? detailRows.length : monthRows.length) === 0) return;
    setPrinting(true);
    setTimeout(() => window.print(), 50);
  };

  // Fetch the month-wise summary whenever the date range changes.
  const loadMonthly = useCallback(async () => {
    setLoading(true);
    try {
      const res = await vouchersApi.getSalesRegisterMonthly({
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      });
      if (res.success) {
        setMonthRows(res.data.rows || []);
        setMonthTotals({
          voucher_count: res.data.totals?.voucher_count || 0,
          debit_total:   res.data.totals?.debit_total   || 0,
          credit_total:  res.data.totals?.credit_total  || 0,
          gross_total:   res.data.totals?.gross_total   || 0,
        });
      }
    } catch { showError('Error', 'Failed to load Sales Register'); }
    finally { setLoading(false); }
  }, [dateFrom, dateTo, showError]);
  useEffect(() => { loadMonthly(); }, [loadMonthly]);

  // Fetch the per-voucher detail when a month is selected. Re-runs on
  // search change so the user can filter within a month.
  const loadDetail = useCallback(async (year: number, month: number) => {
    const { from, to } = monthBounds(year, month);
    setDetailLoading(true);
    try {
      const res = await vouchersApi.getSalesRegister({
        date_from: from, date_to: to,
        search: debouncedDetailSearch || undefined,
      });
      if (res.success) {
        setDetailRows(res.data.rows || []);
        setDetailTotals({
          taxable: res.data.totals?.taxable || 0,
          cgst:    res.data.totals?.cgst    || 0,
          sgst:    res.data.totals?.sgst    || 0,
          igst:    res.data.totals?.igst    || 0,
          other:   res.data.totals?.other   || 0,
          total:   res.data.totals?.total   || 0,
        });
      }
    } catch { showError('Error', 'Failed to load detail'); }
    finally { setDetailLoading(false); }
  }, [debouncedDetailSearch, showError]);
  useEffect(() => {
    if (detailMonth) loadDetail(detailMonth.year, detailMonth.month);
  }, [detailMonth, loadDetail]);

  // Detail sort + pagination (client-side over the per-month payload).
  const [detailSortKey, setDetailSortKey] = useState<DetailSortKey>('vch_date');
  const [detailSortDir, setDetailSortDir] = useState<SortDir>('asc');
  const [detailPage, setDetailPage] = useState(1);
  const [detailPageSize, setDetailPageSize] = useState<number>(10);
  useEffect(() => { setDetailPage(1); }, [detailMonth, debouncedDetailSearch, detailPageSize, detailSortKey, detailSortDir]);

  const detailSorted = useMemo(() => {
    const arr = [...detailRows];
    const dir = detailSortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      if (detailSortKey === 'vch_date') {
        const at = a.vch_date ? new Date(a.vch_date).getTime() : 0;
        const bt = b.vch_date ? new Date(b.vch_date).getTime() : 0;
        return (at - bt) * dir;
      }
      const av = (a as any)[detailSortKey];
      const bv = (b as any)[detailSortKey];
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av ?? '').localeCompare(String(bv ?? '')) * dir;
    });
    return arr;
  }, [detailRows, detailSortKey, detailSortDir]);

  const detailTotalRows = detailSorted.length;
  const detailTotalPages = Math.max(1, Math.ceil(detailTotalRows / detailPageSize));
  const detailSafePage = Math.min(detailPage, detailTotalPages);
  const detailStartIdx = (detailSafePage - 1) * detailPageSize;
  const detailEndIdx = Math.min(detailStartIdx + detailPageSize, detailTotalRows);
  const detailPageRows = printing ? detailSorted : detailSorted.slice(detailStartIdx, detailEndIdx);

  const toggleDetailSort = (k: DetailSortKey) => {
    if (detailSortKey === k) setDetailSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setDetailSortKey(k); setDetailSortDir('asc'); }
  };
  const DetailSortIcon = ({ col }: { col: DetailSortKey }) => {
    if (detailSortKey !== col) return <ChevronsUpDown size={11} className="inline-block ml-1 text-slate-400" />;
    return detailSortDir === 'asc'
      ? <ChevronUp size={11} className="inline-block ml-1 text-blue-600" />
      : <ChevronDown size={11} className="inline-block ml-1 text-blue-600" />;
  };

  const cell = 'border border-slate-300 px-2.5 py-1.5 text-[14px] leading-snug';
  const cellNum = `${cell} text-right tabular-nums whitespace-nowrap`;
  const headCell = 'border border-slate-400 bg-slate-200 px-2.5 py-1.5 text-[13px] font-bold text-slate-700 uppercase tracking-wide sticky top-0 z-10';
  const headBtn = 'flex items-center select-none cursor-pointer hover:text-blue-700';

  return (
    <div className="flex flex-col h-[calc(100vh-56px)] md:h-[calc(100vh-72px)] w-full">
      {/* Print-only header */}
      <div className="print-only mb-3 px-3" aria-hidden>
        <h1 className="text-xl font-bold mb-1">Sales Register</h1>
        <div className="text-sm">
          {detailMonth
            ? `${MONTHS_LONG[detailMonth.month - 1]} ${detailMonth.year}`
            : `From ${displayDate(dateFrom)} to ${displayDate(dateTo)}`}
        </div>
      </div>

      {/* ── Header bar ── */}
      <div className="flex-none bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between print:hidden">
        <div className="flex items-center gap-1 min-w-0">
          <button
            onClick={() => detailMonth
              ? (setDetailMonth(null), setDetailRows([]), setDetailSearch(''), setShowControls(false))
              : navigate(-1)}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 -ml-1 flex-shrink-0"
            title={detailMonth ? 'Back to months' : 'Back'}>
            <ChevronLeft size={20} />
          </button>
          <h1 className="text-[17px] font-bold text-slate-800 truncate">Sales Register</h1>
          {detailMonth && (
            <span className="text-[13px] font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded flex-shrink-0 ml-1">
              {MONTHS_LONG[detailMonth.month - 1]} {detailMonth.year}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => setShowControls(s => !s)}
            className={`p-2 rounded-lg transition-colors ${showControls ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
            title="Search">
            <Search size={18} />
          </button>
          <button onClick={handlePrint}
            disabled={(detailMonth ? detailRows.length : monthRows.length) === 0}
            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-40"
            title="Print">
            <Printer size={16} />
          </button>
          <button onClick={detailMonth ? () => loadDetail(detailMonth.year, detailMonth.month) : loadMonthly}
            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"
            title="Refresh">
            <RefreshCw size={16} className={(loading || detailLoading) ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ── Search & date filter panel (slide-down) ── */}
      {showControls && (
        <div className="flex-none bg-slate-50 border-b border-slate-200 px-3 py-2.5 print:hidden">
          <div className="flex items-center gap-2 flex-wrap">
            {detailMonth && (
              <div className="relative flex-1 min-w-[140px]">
                <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={detailSearch} onChange={e => setDetailSearch(e.target.value)}
                  placeholder="Party / vch no…"
                  autoFocus
                  className="pl-9 pr-7 py-2 border border-slate-300 rounded-lg text-[13px] w-full outline-none focus:ring-2 focus:ring-blue-300 bg-white" />
                {detailSearch && (
                  <button onClick={() => setDetailSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    <X size={12} />
                  </button>
                )}
              </div>
            )}
            <div className="flex items-stretch border border-slate-300 rounded-lg bg-white overflow-hidden">
              <div className="flex items-center gap-1 px-2 border-r border-slate-300 bg-slate-100">
                <Calendar size={12} className="text-slate-400" />
                <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wide">From</span>
              </div>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                disabled={!!detailMonth}
                className="text-[13px] text-slate-700 outline-none bg-transparent px-2 py-1.5 w-[115px] disabled:opacity-50" />
              <div className="flex items-center px-2 border-l border-r border-slate-300 bg-slate-100">
                <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wide">To</span>
              </div>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                disabled={!!detailMonth}
                className="text-[13px] text-slate-700 outline-none bg-transparent px-2 py-1.5 w-[115px] disabled:opacity-50" />
            </div>
          </div>
        </div>
      )}

      {/* Body — month-wise summary OR per-voucher detail. */}
      {!detailMonth ? (
        <MonthlyView
          monthRows={monthRows} monthTotals={monthTotals} loading={loading}
          dateFrom={dateFrom} dateTo={dateTo}
          onPickMonth={(year, month) => setDetailMonth({ year, month })}
          headCell={headCell} cell={cell} cellNum={cellNum}
        />
      ) : (
        <DetailView
          detailMonth={detailMonth} rows={detailPageRows} totals={detailTotals}
          loading={detailLoading} totalRows={detailTotalRows}
          startIdx={detailStartIdx} endIdx={detailEndIdx}
          page={detailSafePage} totalPages={detailTotalPages}
          pageSize={detailPageSize} setPageSize={setDetailPageSize} setPage={setDetailPage}
          printing={printing}
          headCell={headCell} headBtn={headBtn} cell={cell} cellNum={cellNum}
          toggleSort={toggleDetailSort} SortIcon={DetailSortIcon}
          openVoucher={(id) => navigate(`/billing/vouchers/edit/${id}`)}
        />
      )}
    </div>
  );
}

function MonthlyView({
  monthRows, monthTotals, loading, dateFrom, dateTo, onPickMonth,
  headCell, cell, cellNum,
}: {
  monthRows: MonthRow[]; monthTotals: any; loading: boolean;
  dateFrom: string; dateTo: string;
  onPickMonth: (year: number, month: number) => void;
  headCell: string; cell: string; cellNum: string;
}) {
  return (
    <>
      {/* Mobile flat list — monthly view */}
      <div className="sm:hidden flex-1 min-h-0 overflow-auto bg-white">
        {loading ? (
          <div className="text-center text-gray-400 py-8">Loading…</div>
        ) : monthRows.length === 0 ? (
          <div className="text-center text-gray-400 py-8">No sales between {displayDate(dateFrom)} and {displayDate(dateTo)}</div>
        ) : (
          monthRows.map((m) => {
            const empty = m.voucher_count === 0;
            return (
              <div key={`${m.year}-${m.month}`}
                className={`border-b border-gray-200 ${empty ? 'opacity-50' : 'cursor-pointer active:bg-blue-50'}`}
                onClick={() => { if (!empty) onPickMonth(m.year, m.month); }}>
                <div className="flex items-start justify-between px-4 py-3">
                  <div>
                    <div className="font-bold text-gray-900 text-[15px] uppercase">
                      {MONTHS_LONG[m.month - 1]} {m.year}
                    </div>
                    <div className="text-[13px] text-gray-500 mt-0.5">
                      {m.voucher_count} vouchers
                    </div>
                  </div>
                  <span className="text-[15px] font-medium text-gray-900 tabular-nums">
                    {fmt(m.gross_total)}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Mobile — Grand Total fixed above desktop */}
      {!loading && monthRows.length > 0 && (
        <div className="sm:hidden flex-none border-t border-gray-200 print:hidden">
          <div className="bg-blue-700 text-white px-4 py-2.5 flex justify-between items-center">
            <span className="font-bold text-sm tracking-widest">GRAND TOTAL</span>
            <span className="text-sm tabular-nums font-semibold">{monthTotals.voucher_count} vouchers</span>
          </div>
          <div className="flex divide-x divide-gray-200 bg-white">
            <div className="flex-1 px-3 py-2.5">
              <div className="text-[10px] uppercase text-gray-400 font-bold tracking-wide">Debit</div>
              <div className="text-[14px] font-bold text-emerald-700 tabular-nums mt-0.5">{fmt(monthTotals.debit_total)}</div>
            </div>
            <div className="flex-1 px-3 py-2.5">
              <div className="text-[10px] uppercase text-gray-400 font-bold tracking-wide">Credit</div>
              <div className="text-[14px] font-bold text-red-600 tabular-nums mt-0.5">{fmt(monthTotals.credit_total)}</div>
            </div>
            <div className="flex-1 px-3 py-2.5">
              <div className="text-[10px] uppercase text-gray-400 font-bold tracking-wide">Net</div>
              <div className="text-[14px] font-bold text-blue-700 tabular-nums mt-0.5">{fmt(monthTotals.gross_total)}</div>
            </div>
          </div>
        </div>
      )}

      {/* Desktop table — monthly view */}
      <div className="hidden sm:block flex-1 min-h-0 overflow-auto bg-white border-x border-b border-slate-300 mx-3 mb-3 print:mx-0 print:overflow-visible print:max-h-none print:border-slate-400">
        <table className="border-collapse text-[14px] w-full">
          <thead>
            <tr>
              <th className={`${headCell} text-left`}>Particulars</th>
              <th className={`${headCell} text-right w-32`}>Vouchers</th>
              <th className={`${headCell} text-right w-40`}>Debit</th>
              <th className={`${headCell} text-right w-40`}>Credit</th>
              <th className={`${headCell} text-right w-40`}>Closing</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className={`${cell} text-center text-slate-400 py-6`}>Loading…</td></tr>
            ) : monthRows.length === 0 ? (
              <tr><td colSpan={5} className={`${cell} text-center text-slate-400 py-6`}>No sales between {displayDate(dateFrom)} and {displayDate(dateTo)}</td></tr>
            ) : (
              monthRows.map((m, i) => {
                const empty = m.voucher_count === 0;
                const zebra = i % 2 === 1 ? 'bg-slate-50' : 'bg-white';
                return (
                  <tr key={`${m.year}-${m.month}`}
                    className={`${zebra} ${empty ? 'text-slate-400' : 'text-slate-800 cursor-pointer hover:bg-blue-50'}`}
                    onClick={() => { if (!empty) onPickMonth(m.year, m.month); }}>
                    <td className={`${cell} font-medium`}>
                      <div className="flex items-center gap-2">
                        <span>{MONTHS_LONG[m.month - 1]} {m.year}</span>
                        {!empty && (
                          <span className="text-[10px] text-blue-600 underline decoration-dotted">view vouchers</span>
                        )}
                      </div>
                    </td>
                    <td className={cellNum}>{empty ? <span className="text-slate-300">—</span> : m.voucher_count}</td>
                    <td className={cellNum}>{m.debit_total > 0 ? fmt(m.debit_total) : <span className="text-slate-300">—</span>}</td>
                    <td className={cellNum}>{m.credit_total > 0 ? fmt(m.credit_total) : <span className="text-slate-300">—</span>}</td>
                    <td className={cellNum + ' font-semibold'}>{m.gross_total > 0 ? fmt(m.gross_total) : <span className="text-slate-300">—</span>}</td>
                  </tr>
                );
              })
            )}
          </tbody>
          {monthRows.length > 0 && (
            <tfoot>
              <tr className="bg-slate-200 font-bold">
                <td className={cell + ' text-slate-700'}>Grand Total</td>
                <td className={cellNum + ' text-slate-700'}>{monthTotals.voucher_count}</td>
                <td className={cellNum + ' text-emerald-800'}>{fmt(monthTotals.debit_total)}</td>
                <td className={cellNum + ' text-red-800'}>{fmt(monthTotals.credit_total)}</td>
                <td className={cellNum + ' text-blue-700'}>{fmt(monthTotals.gross_total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}

function DetailView({
  detailMonth, rows, totals, loading, totalRows, startIdx, endIdx,
  page, totalPages, pageSize, setPageSize, setPage, printing,
  headCell, headBtn, cell, cellNum, toggleSort, SortIcon, openVoucher,
}: {
  detailMonth: { year: number; month: number };
  rows: VchRow[]; totals: any; loading: boolean; totalRows: number;
  startIdx: number; endIdx: number;
  page: number; totalPages: number;
  pageSize: number; setPageSize: (n: number) => void; setPage: (fn: (p: number) => number | number) => void;
  printing: boolean;
  headCell: string; headBtn: string; cell: string; cellNum: string;
  toggleSort: (k: DetailSortKey) => void;
  SortIcon: React.FC<{ col: DetailSortKey }>;
  openVoucher: (id: number) => void;
}) {
  return (
    <>
      {/* Totals strip */}
      <div className="flex-none flex flex-wrap items-stretch gap-0 border-x border-slate-300 bg-white text-[13px] mx-3 print:mx-0 print:border-slate-400">
        <Stat label="Taxable" value={totals.taxable} color="text-slate-800" />
        <Stat label="CGST"    value={totals.cgst}    color="text-slate-700" />
        <Stat label="SGST"    value={totals.sgst}    color="text-slate-700" />
        <Stat label="IGST"    value={totals.igst}    color="text-slate-700" />
        <Stat label="Other"   value={totals.other}   color="text-slate-500" />
        <Stat label="Total"   value={totals.total}   color="text-blue-700"  bold />
        <div className="flex items-center gap-2 px-3 py-2 ml-auto border-l border-slate-300">
          <span className="text-slate-500 uppercase text-[11px] font-bold tracking-wide">Vouchers</span>
          <span className="tabular-nums font-bold text-slate-700">{totalRows}</span>
        </div>
      </div>

      {/* Mobile flat list — detail view */}
      <div className="sm:hidden flex-1 min-h-0 overflow-auto bg-white">
        {loading ? (
          <div className="text-center text-gray-400 py-8">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-center text-gray-400 py-8">No sales vouchers in {MONTHS_LONG[detailMonth.month - 1]} {detailMonth.year}</div>
        ) : (
          <>
            {rows.map((r) => (
              <div key={r.vch_id}
                className="border-b border-gray-200 cursor-pointer active:bg-blue-50"
                onClick={() => openVoucher(r.vch_id)}>
                <div className="flex items-start justify-between px-4 py-3">
                  <div>
                    <div className="font-bold text-gray-900 text-[15px] uppercase">
                      {r.vch_type_name || 'SALES'}
                    </div>
                    <div className="text-[13px] text-gray-500 mt-0.5">
                      {displayDate(r.vch_date)}&nbsp;&nbsp;|&nbsp;&nbsp;{r.party_name}&nbsp;&nbsp;#{r.vch_no || '—'}
                    </div>
                    {r.party_gst && (
                      <div className="text-[13px] text-gray-500">{r.party_gst}</div>
                    )}
                  </div>
                  <span className="text-[15px] font-medium text-gray-900 tabular-nums whitespace-nowrap ml-3">
                    {fmt(r.total_amount)}
                  </span>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Desktop table — detail view */}
      <div className="hidden sm:block flex-1 min-h-0 overflow-auto bg-white border-x border-b border-slate-300 mx-3 mb-3 print:mx-0 print:overflow-visible print:max-h-none print:border-slate-400">
        <table className="border-collapse text-[13px] w-full">
          <thead>
            <tr>
              <th className={`${headCell} text-left w-24`}>
                <div className={headBtn} onClick={() => toggleSort('vch_date')}>Date<SortIcon col="vch_date" /></div>
              </th>
              <th className={`${headCell} text-left w-28`}>
                <div className={headBtn} onClick={() => toggleSort('vch_no')}>Vch No.<SortIcon col="vch_no" /></div>
              </th>
              <th className={`${headCell} text-left`}>
                <div className={headBtn} onClick={() => toggleSort('party_name')}>Party<SortIcon col="party_name" /></div>
              </th>
              <th className={`${headCell} text-left w-32`}>GSTIN</th>
              <th className={`${headCell} text-right w-28`}>
                <div className={headBtn + ' justify-end'} onClick={() => toggleSort('taxable_amount')}>Taxable<SortIcon col="taxable_amount" /></div>
              </th>
              <th className={`${headCell} text-right w-24`}>CGST</th>
              <th className={`${headCell} text-right w-24`}>SGST</th>
              <th className={`${headCell} text-right w-24`}>IGST</th>
              <th className={`${headCell} text-right w-24`}>Other</th>
              <th className={`${headCell} text-right w-28`}>
                <div className={headBtn + ' justify-end'} onClick={() => toggleSort('total_amount')}>Total<SortIcon col="total_amount" /></div>
              </th>
              <th className={`${headCell} text-center w-20 print:hidden`}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} className={`${cell} text-center text-slate-400 py-6`}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={11} className={`${cell} text-center text-slate-400 py-6`}>No sales vouchers in {MONTHS_LONG[detailMonth.month - 1]} {detailMonth.year}</td></tr>
            ) : (
              rows.map((r, i) => {
                const rowIdx = printing ? i : startIdx + i;
                const zebra = rowIdx % 2 === 1 ? 'bg-slate-50' : 'bg-white';
                return (
                  <tr key={r.vch_id} className={`${zebra} hover:bg-blue-50`}>
                    <td className={`${cell} text-slate-600 whitespace-nowrap tabular-nums`}>{displayDate(r.vch_date)}</td>
                    <td className={`${cell} whitespace-nowrap`}>
                      <button onClick={() => openVoucher(r.vch_id)}
                        className="text-blue-600 hover:text-blue-800 hover:underline font-medium">
                        {r.vch_no || '—'}
                      </button>
                    </td>
                    <td className={`${cell} text-slate-800 font-medium`}>
                      {r.party_name}
                      {r.party_state && <span className="ml-2 text-[10px] text-slate-500">{r.party_state}</span>}
                    </td>
                    <td className={`${cell} text-slate-600 text-[12px] tabular-nums whitespace-nowrap`}>{r.party_gst || '—'}</td>
                    <td className={cellNum + ' text-slate-800'}>{fmt(r.taxable_amount)}</td>
                    <td className={cellNum + ' text-slate-700'}>{r.cgst_amount > 0 ? fmt(r.cgst_amount) : <span className="text-slate-300">—</span>}</td>
                    <td className={cellNum + ' text-slate-700'}>{r.sgst_amount > 0 ? fmt(r.sgst_amount) : <span className="text-slate-300">—</span>}</td>
                    <td className={cellNum + ' text-slate-700'}>{r.igst_amount > 0 ? fmt(r.igst_amount) : <span className="text-slate-300">—</span>}</td>
                    <td className={cellNum + ' text-slate-500'}>{r.other_charges !== 0 ? fmt(r.other_charges) : <span className="text-slate-300">—</span>}</td>
                    <td className={cellNum + ' font-semibold text-blue-700'}>{fmt(r.total_amount)}</td>
                    <td className={`${cell} text-center print:hidden`}>
                      <button onClick={() => openVoucher(r.vch_id)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-full">
                        <ExternalLink size={12} /> Open
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {totalRows > 0 && (
            <tfoot>
              <tr className="bg-slate-200 font-bold sticky bottom-0">
                <td colSpan={4} className={`${cell} text-slate-700`}>Total ({totalRows} vouchers)</td>
                <td className={cellNum + ' text-slate-800'}>{fmt(totals.taxable)}</td>
                <td className={cellNum + ' text-slate-700'}>{fmt(totals.cgst)}</td>
                <td className={cellNum + ' text-slate-700'}>{fmt(totals.sgst)}</td>
                <td className={cellNum + ' text-slate-700'}>{fmt(totals.igst)}</td>
                <td className={cellNum + ' text-slate-500'}>{fmt(totals.other)}</td>
                <td className={cellNum + ' text-blue-700'}>{fmt(totals.total)}</td>
                <td className={cell + ' print:hidden'} />
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
            <span className="text-sm tabular-nums font-semibold">{totalRows} vouchers</span>
          </div>
          <div className="flex divide-x divide-gray-200 bg-white">
            <div className="flex-1 px-3 py-2.5">
              <div className="text-[10px] uppercase text-gray-400 font-bold tracking-wide">Taxable</div>
              <div className="text-[13px] font-bold text-slate-700 tabular-nums mt-0.5">{fmt(totals.taxable)}</div>
            </div>
            <div className="flex-1 px-3 py-2.5">
              <div className="text-[10px] uppercase text-gray-400 font-bold tracking-wide">GST</div>
              <div className="text-[13px] font-bold text-slate-600 tabular-nums mt-0.5">{fmt(totals.cgst + totals.sgst + totals.igst)}</div>
            </div>
            <div className="flex-1 px-3 py-2.5">
              <div className="text-[10px] uppercase text-gray-400 font-bold tracking-wide">Total</div>
              <div className="text-[13px] font-bold text-blue-700 tabular-nums mt-0.5">{fmt(totals.total)}</div>
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
            <button onClick={() => setPage(() => 1)} disabled={page === 1} className="p-1 border border-slate-300 rounded bg-white hover:bg-slate-50 disabled:opacity-40"><ChevronsLeft size={14} /></button>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="p-1 border border-slate-300 rounded bg-white hover:bg-slate-50 disabled:opacity-40"><ChevronLeft size={14} /></button>
            <span className="px-2 tabular-nums">Page {page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-1 border border-slate-300 rounded bg-white hover:bg-slate-50 disabled:opacity-40"><ChevronRight size={14} /></button>
            <button onClick={() => setPage(() => totalPages)} disabled={page === totalPages} className="p-1 border border-slate-300 rounded bg-white hover:bg-slate-50 disabled:opacity-40"><ChevronsRight size={14} /></button>
          </div>
        </div>
      )}
    </>
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
