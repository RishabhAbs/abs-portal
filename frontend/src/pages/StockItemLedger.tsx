import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Calendar, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  RefreshCw, Search, X, Printer,
} from 'lucide-react';
import { vouchersApi } from '../services/api';
import { useToast } from '../components/Toast/Toast';

const fmt = (n: any) =>
  Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtQty = (n: any) =>
  Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 3 });

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

type Row = {
  sno: number;
  vch_id: number;
  vch_no: string | null;
  vch_date: string | null;
  vch_type_name: string | null;
  particulars: string;
  opening_qty: number; opening_value: number;
  inward_qty: number; inward_value: number;
  outward_qty: number; outward_value: number;
  closing_qty: number; closing_value: number;
};

const PAGE_SIZE = 25;

export default function StockItemLedger() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { showError } = useToast();

  const itemId = Number(searchParams.get('item_id'));
  const today = new Date();
  const { from: fyFrom } = fyBounds(today);

  const [itemName, setItemName] = useState('');
  const [dateFrom, setDateFrom] = useState(toInputDate(fyFrom));
  const [dateTo, setDateTo]     = useState(toInputDate(today));
  const [search, setSearch]     = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [showControls, setShowControls] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [loading, setLoading]   = useState(false);

  const [rows, setRows] = useState<Row[]>([]);
  const [opening, setOpening] = useState({ qty: 0, value: 0 });
  const [closing, setClosing] = useState({ qty: 0, value: 0 });
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => { setPage(1); }, [debouncedSearch, dateFrom, dateTo]);
  useEffect(() => {
    const onAfter = () => setPrinting(false);
    window.addEventListener('afterprint', onAfter);
    return () => window.removeEventListener('afterprint', onAfter);
  }, []);

  const load = useCallback(async () => {
    if (!itemId) { setRows([]); return; }
    setLoading(true);
    try {
      const res = await vouchersApi.getStockItemLedger({
        item_id: itemId,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        search: debouncedSearch || undefined,
      });
      if (res.success) {
        setRows(res.data.rows || []);
        setOpening(res.data.opening || { qty: 0, value: 0 });
        setClosing(res.data.closing || { qty: 0, value: 0 });
        if (res.data.item?.name) setItemName(res.data.item.name);
      }
    } catch { showError('Error', 'Failed to load item voucher register'); }
    finally { setLoading(false); }
  }, [itemId, dateFrom, dateTo, debouncedSearch, showError]);

  useEffect(() => { load(); }, [load]);

  const handlePrint = () => {
    if (rows.length === 0) return;
    setPrinting(true);
    setTimeout(() => window.print(), 50);
  };

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = printing ? rows : rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const cell = 'border border-slate-300 px-2.5 py-1.5 text-[13px] leading-snug';
  const cellNum = `${cell} text-right tabular-nums whitespace-nowrap`;
  const headCell = 'border border-slate-400 bg-slate-200 px-2 py-1.5 text-[12px] font-bold text-slate-700 uppercase tracking-wide sticky top-0 z-10';

  return (
    <div className="flex flex-col w-full fixed left-0 right-0 top-14 bottom-16 sm:static sm:h-full sm:top-auto sm:bottom-auto" style={{ overscrollBehavior: 'contain' }}>
      <div className="print-only mb-3 px-3" aria-hidden>
        <h1 className="text-xl font-bold mb-1">{itemName || 'Stock Item'} — Voucher Register</h1>
        <div className="text-sm">From {displayDate(dateFrom)} to {displayDate(dateTo)}</div>
      </div>

      {/* Header */}
      <div className="flex-none bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between print:hidden">
        <div className="flex items-center gap-1 min-w-0 flex-1">
          <button onClick={() => navigate(-1)} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 -ml-1 flex-shrink-0" title="Back">
            <ChevronLeft size={20} />
          </button>
          <h1 className="text-[17px] font-bold text-slate-800 truncate">{itemName || 'Stock Item'}</h1>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => setShowControls(v => !v)}
            className={`p-2 rounded-lg transition-colors ${showControls ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
            title="Search & Filters">
            <Search size={18} />
          </button>
          <button onClick={handlePrint} disabled={rows.length === 0}
            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-40" title="Print">
            <Printer size={16} />
          </button>
          <button onClick={load} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100" title="Refresh">
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
                placeholder="Vch no. / party…" autoFocus
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
          </div>
        </div>
      )}

      {/* Mobile card list */}
      <div className="sm:hidden flex-1 min-h-0 overflow-auto bg-white" style={{ overscrollBehavior: 'contain' }}>
        {loading ? (
          <div className="text-center text-gray-400 py-8 text-[13px]">Loading…</div>
        ) : pageRows.length === 0 ? (
          <div className="text-center text-gray-400 py-8 text-[13px]">No vouchers in this date range</div>
        ) : pageRows.map(r => (
          <div key={`${r.vch_id}-${r.sno}`} className="border-b border-gray-100 px-4 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-gray-900 text-[14px] leading-snug truncate">{r.particulars}</div>
                <div className="text-[11px] text-gray-400 mt-0.5">{r.vch_type_name || '—'} · {r.vch_no || '—'} · {displayDate(r.vch_date)}</div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className={`text-[14px] font-bold tabular-nums ${r.closing_value < 0 ? 'text-red-600' : 'text-blue-700'}`}>₹{fmt(r.closing_value)}</div>
                <div className="text-[11px] text-gray-400 tabular-nums mt-0.5">{fmtQty(r.closing_qty)} qty</div>
              </div>
            </div>
            <div className="flex items-center gap-3 mt-1.5 text-[11px] text-gray-400">
              <span>Op: {fmtQty(r.opening_qty)}</span>
              {r.inward_qty !== 0 && <span className="text-emerald-600">In: {fmtQty(r.inward_qty)}/{fmt(r.inward_value)}</span>}
              {r.outward_qty !== 0 && <span className="text-red-500">Out: {fmtQty(r.outward_qty)}/{fmt(r.outward_value)}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden sm:block flex-1 min-h-0 overflow-auto bg-white border-x border-b border-slate-300 mx-3 mb-3 print:mx-0 print:overflow-visible print:max-h-none print:border-slate-400">
        <table className="border-collapse text-[13px] w-full">
          <thead>
            <tr>
              <th className={`${headCell} text-right w-12`} rowSpan={2}>S.No</th>
              <th className={`${headCell} text-left`} rowSpan={2}>Particulars</th>
              <th className={`${headCell} text-left w-28`} rowSpan={2}>Vch Type</th>
              <th className={`${headCell} text-left w-24`} rowSpan={2}>Vch No.</th>
              <th className={`${headCell} text-left w-28`} rowSpan={2}>Vch Date</th>
              <th className={`${headCell} text-center`} colSpan={2}>Opening</th>
              <th className={`${headCell} text-center`} colSpan={2}>Inward</th>
              <th className={`${headCell} text-center`} colSpan={2}>Outward</th>
              <th className={`${headCell} text-center`} colSpan={2}>Closing</th>
            </tr>
            <tr>
              <th className={`${headCell} text-right w-20`}>Qty</th>
              <th className={`${headCell} text-right w-24`}>Value</th>
              <th className={`${headCell} text-right w-20`}>Qty</th>
              <th className={`${headCell} text-right w-24`}>Value</th>
              <th className={`${headCell} text-right w-20`}>Qty</th>
              <th className={`${headCell} text-right w-24`}>Value</th>
              <th className={`${headCell} text-right w-20`}>Qty</th>
              <th className={`${headCell} text-right w-24`}>Value</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={13} className={`${cell} text-center text-slate-400 py-6`}>Loading…</td></tr>
            ) : pageRows.length === 0 ? (
              <tr><td colSpan={13} className={`${cell} text-center text-slate-400 py-6`}>No vouchers in this date range</td></tr>
            ) : pageRows.map((r, i) => {
              const zebra = i % 2 === 1 ? 'bg-slate-50' : 'bg-white';
              const negativeStock = r.closing_qty < -0.0005;
              return (
                <tr key={`${r.vch_id}-${r.sno}`} className={`${zebra} hover:bg-blue-50`}>
                  <td className={`${cell} text-right text-slate-500`}>{r.sno}</td>
                  <td className={`${cell} font-medium text-slate-800`}>{r.particulars}</td>
                  <td className={`${cell} text-slate-600 text-[12px]`}>{r.vch_type_name || '—'}</td>
                  <td className={`${cell} text-slate-600`}>
                    {r.vch_no ? (
                      <button onClick={() => navigate(`/billing/vouchers/edit/${r.vch_id}`)}
                        className="text-blue-600 hover:text-blue-800 hover:underline font-medium">{r.vch_no}</button>
                    ) : (
                      <button onClick={() => navigate(`/billing/vouchers/edit/${r.vch_id}`)}
                        className="text-slate-400 hover:text-blue-600 hover:underline">—</button>
                    )}
                  </td>
                    <td className={`${cell} text-slate-600`}>{displayDate(r.vch_date)}</td>
                  <td className={cellNum + ' text-slate-700'}>{r.opening_qty !== 0 ? fmtQty(r.opening_qty) : <span className="text-slate-300">—</span>}</td>
                  <td className={cellNum + ' text-slate-600'}>{r.opening_value !== 0 ? fmt(r.opening_value) : <span className="text-slate-300">—</span>}</td>
                  <td className={cellNum + ' text-emerald-700'}>{r.inward_qty !== 0 ? fmtQty(r.inward_qty) : <span className="text-slate-300">—</span>}</td>
                  <td className={cellNum + ' text-emerald-600'}>{r.inward_value !== 0 ? fmt(r.inward_value) : <span className="text-slate-300">—</span>}</td>
                  <td className={cellNum + ' text-red-700'}>{r.outward_qty !== 0 ? fmtQty(r.outward_qty) : <span className="text-slate-300">—</span>}</td>
                  <td className={cellNum + ' text-red-600'}>{r.outward_value !== 0 ? fmt(r.outward_value) : <span className="text-slate-300">—</span>}</td>
                  <td className={cellNum + ' font-semibold ' + (negativeStock ? 'text-red-700' : 'text-blue-700')}>{fmtQty(r.closing_qty)}</td>
                  <td className={cellNum + ' font-semibold ' + (negativeStock ? 'text-red-700' : 'text-blue-700')}>{fmt(r.closing_value)}</td>
                </tr>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="bg-slate-200 font-bold sticky bottom-0">
                <td colSpan={5} className={`${cell} text-slate-700`}>Opening / Closing ({rows.length} vouchers)</td>
                <td className={cellNum + ' text-slate-700'}>{fmtQty(opening.qty)}</td>
                <td className={cellNum + ' text-slate-700'}>{fmt(opening.value)}</td>
                <td className={cell} />
                <td className={cell} />
                <td className={cell} />
                <td className={cell} />
                <td className={cellNum + ' text-blue-700'}>{fmtQty(closing.qty)}</td>
                <td className={cellNum + ' text-blue-700'}>{fmt(closing.value)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Pagination */}
      {!printing && rows.length > PAGE_SIZE && (
        <div className="flex-none flex items-center justify-between gap-2 px-3 py-1.5 border-t border-slate-200 bg-slate-50 text-[13px] text-slate-700 print:hidden">
          <div className="tabular-nums">{`${(safePage - 1) * PAGE_SIZE + 1}–${Math.min(safePage * PAGE_SIZE, rows.length)} of ${rows.length}`}</div>
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
