import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ExternalLink, X, Calendar, ChevronLeft, ChevronRight, RefreshCw, ChevronUp, ChevronDown, ChevronsUpDown, Filter as FilterIcon } from 'lucide-react';
import { vouchersApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
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
const displayDate = (s: string) => {
  if (!s) return '';
  const d = new Date(s);
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
};

export default function Daybook() {
  const navigate = useNavigate();
  const { showError } = useToast();
  const { canEdit, canCheckPermission } = useAuth();
  // The Open button routes to /billing/vouchers/edit/:id for everyone.
  // The Vouchers page itself flips to readOnly mode when the current user
  // doesn't have edit permission, so we don't need a separate view modal.
  const canEditVoucher = canEdit('vouchers') || canEdit('activities') || canCheckPermission('reports_daybook', 'edit');

  // Applied date range lives in the URL (?from=…&to=…) so navigating to a
  // voucher edit page and clicking back restores the same view. Defaults to
  // today→today when the params are absent. Using replace:true on updates
  // keeps the back stack from filling up.
  //
  // Draft state is what the user is currently editing in the pickers — it
  // does NOT trigger a fetch on every keystroke. The fetch (and URL update)
  // happens only when the user clicks Apply.
  const [searchParams, setSearchParams] = useSearchParams();
  const todayStr = toInputDate(new Date());
  const dateFrom = searchParams.get('from') || todayStr;
  const dateTo   = searchParams.get('to')   || todayStr;
  const search   = searchParams.get('q')    || '';
  // Per-column filters live in the URL too so back/forward navigation restores
  // them along with the date range. They're applied client-side over the rows
  // already returned for the date window.
  const filterParticulars = searchParams.get('p') || '';
  const filterVchType     = searchParams.get('vt') || '';
  const filterVchNo       = searchParams.get('vn') || '';
  const filterDrMin       = searchParams.get('drMin') || '';
  const filterDrMax       = searchParams.get('drMax') || '';
  const filterCrMin       = searchParams.get('crMin') || '';
  const filterCrMax       = searchParams.get('crMax') || '';

  const [draftFrom,        setDraftFrom]        = useState(dateFrom);
  const [draftTo,          setDraftTo]          = useState(dateTo);
  const [draftSearch,      setDraftSearch]      = useState(search);
  const [draftParticulars, setDraftParticulars] = useState(filterParticulars);
  const [draftVchType,     setDraftVchType]     = useState(filterVchType);
  const [draftVchNo,       setDraftVchNo]       = useState(filterVchNo);
  const [draftDrMin,       setDraftDrMin]       = useState(filterDrMin);
  const [draftDrMax,       setDraftDrMax]       = useState(filterDrMax);
  const [draftCrMin,       setDraftCrMin]       = useState(filterCrMin);
  const [draftCrMax,       setDraftCrMax]       = useState(filterCrMax);

  // Keep drafts in sync when the URL changes externally (browser back, today,
  // etc). Local edits via the inputs are the only thing that should diverge.
  useEffect(() => { setDraftFrom(dateFrom); }, [dateFrom]);
  useEffect(() => { setDraftTo(dateTo); },     [dateTo]);
  useEffect(() => { setDraftSearch(search); }, [search]);
  useEffect(() => { setDraftParticulars(filterParticulars); }, [filterParticulars]);
  useEffect(() => { setDraftVchType(filterVchType); }, [filterVchType]);
  useEffect(() => { setDraftVchNo(filterVchNo); }, [filterVchNo]);
  useEffect(() => { setDraftDrMin(filterDrMin); }, [filterDrMin]);
  useEffect(() => { setDraftDrMax(filterDrMax); }, [filterDrMax]);
  useEffect(() => { setDraftCrMin(filterCrMin); }, [filterCrMin]);
  useEffect(() => { setDraftCrMax(filterCrMax); }, [filterCrMax]);

  type ApplyArgs = {
    from: string; to: string; q: string;
    p: string; vt: string; vn: string;
    drMin: string; drMax: string; crMin: string; crMax: string;
  };
  const updateParams = (a: ApplyArgs) => {
    const next: Record<string, string> = { from: a.from, to: a.to };
    if (a.q)     next.q     = a.q;
    if (a.p)     next.p     = a.p;
    if (a.vt)    next.vt    = a.vt;
    if (a.vn)    next.vn    = a.vn;
    if (a.drMin) next.drMin = a.drMin;
    if (a.drMax) next.drMax = a.drMax;
    if (a.crMin) next.crMin = a.crMin;
    if (a.crMax) next.crMax = a.crMax;
    setSearchParams(next, { replace: true });
  };
  const applyDraft = () => updateParams({
    from: draftFrom, to: draftTo, q: draftSearch.trim(),
    p: draftParticulars.trim(), vt: draftVchType.trim(), vn: draftVchNo.trim(),
    drMin: draftDrMin.trim(), drMax: draftDrMax.trim(),
    crMin: draftCrMin.trim(), crMax: draftCrMax.trim(),
  });
  const draftDirty =
    draftFrom !== dateFrom ||
    draftTo !== dateTo ||
    draftSearch.trim() !== search ||
    draftParticulars.trim() !== filterParticulars ||
    draftVchType.trim() !== filterVchType ||
    draftVchNo.trim() !== filterVchNo ||
    draftDrMin.trim() !== filterDrMin ||
    draftDrMax.trim() !== filterDrMax ||
    draftCrMin.trim() !== filterCrMin ||
    draftCrMax.trim() !== filterCrMax;
  const hasColFilters = !!(filterParticulars || filterVchType || filterVchNo || filterDrMin || filterDrMax || filterCrMin || filterCrMax);
  const filterCount =
    (search ? 1 : 0) +
    (filterParticulars ? 1 : 0) +
    (filterVchNo ? 1 : 0) +
    (filterVchType ? 1 : 0) +
    ((filterDrMin || filterDrMax) ? 1 : 0) +
    ((filterCrMin || filterCrMax) ? 1 : 0);
  const resetAllFilters = () => {
    setDraftSearch(''); setDraftParticulars(''); setDraftVchType(''); setDraftVchNo('');
    setDraftDrMin(''); setDraftDrMax(''); setDraftCrMin(''); setDraftCrMax('');
    setSearchParams({ from: dateFrom, to: dateTo }, { replace: true });
  };

  // Filter modal — drafts edited inside the popup are committed only when
  // the user clicks Apply. Closing via Cancel/X resyncs drafts from the URL
  // so abandoned edits don't leak out via the toolbar's date Apply.
  const [showControls, setShowControls] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const closeFilter = () => {
    setDraftSearch(search);
    setDraftParticulars(filterParticulars);
    setDraftVchType(filterVchType);
    setDraftVchNo(filterVchNo);
    setDraftDrMin(filterDrMin);
    setDraftDrMax(filterDrMax);
    setDraftCrMin(filterCrMin);
    setDraftCrMax(filterCrMax);
    setFilterOpen(false);
  };
  const applyFromModal = () => { applyDraft(); setFilterOpen(false); };
  const resetFiltersInModal = () => {
    setDraftSearch(''); setDraftParticulars(''); setDraftVchType(''); setDraftVchNo('');
    setDraftDrMin(''); setDraftDrMax(''); setDraftCrMin(''); setDraftCrMax('');
  };
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Sort state — Vch Date asc by default to mirror LedgerReport's chronological view.
  type SortKey = 'vch_date' | 'party_name' | 'vch_no' | 'vch_type_name' | 'dr_amount' | 'cr_amount';
  const [sortKey, setSortKey] = useState<SortKey>('vch_date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const toggleSort = (col: SortKey) => {
    if (sortKey === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(col); setSortDir('asc'); }
  };
  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ChevronsUpDown size={11} className="inline-block ml-1 text-slate-400" />;
    return sortDir === 'asc'
      ? <ChevronUp size={11} className="inline-block ml-1 text-blue-600" />
      : <ChevronDown size={11} className="inline-block ml-1 text-blue-600" />;
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await vouchersApi.getDaybook({ date_from: dateFrom, date_to: dateTo });
      if (res.success) setRows(res.data);
    } catch { showError('Error', 'Failed to load daybook'); }
    finally { setLoading(false); }
  }, [dateFrom, dateTo, showError]);

  useEffect(() => { load(); }, [load]);

  const today = () => {
    const t = toInputDate(new Date());
    setSearchParams({ from: t, to: t }, { replace: true });
  };

  // Open the voucher in the editor. The Vouchers page renders read-only
  // for users without edit permission, so the same route handles both
  // edit and view roles — no separate view modal needed.
  const openVoucher = (id: number) => {
    navigate(`/billing/vouchers/edit/${id}`, canEditVoucher ? undefined : { state: { readOnly: true } });
  };

  // Apply search + per-column filters + sort client-side. The backend already
  // filters by date range, so this layer narrows what's already loaded. Sort
  // is purely client-side too.
  const filteredRows = useMemo(() => {
    const q  = (search || '').trim().toLowerCase();
    const fp = (filterParticulars || '').trim().toLowerCase();
    const ft = (filterVchType || '').trim().toLowerCase();
    const fn = (filterVchNo || '').trim().toLowerCase();
    const drMin = filterDrMin === '' ? null : Number(filterDrMin);
    const drMax = filterDrMax === '' ? null : Number(filterDrMax);
    const crMin = filterCrMin === '' ? null : Number(filterCrMin);
    const crMax = filterCrMax === '' ? null : Number(filterCrMax);

    const out = rows.filter(r => {
      if (q) {
        const matches =
          String(r.vch_no || '').toLowerCase().includes(q) ||
          String(r.party_name || '').toLowerCase().includes(q) ||
          String(r.vch_type_name || '').toLowerCase().includes(q) ||
          String(r.vch_subtype_name || '').toLowerCase().includes(q) ||
          String(r.remark || '').toLowerCase().includes(q);
        if (!matches) return false;
      }
      if (fp && !String(r.party_name || '').toLowerCase().includes(fp)) return false;
      if (fn && !String(r.vch_no || '').toLowerCase().includes(fn)) return false;
      if (ft) {
        const t = String(r.vch_subtype_name && r.vch_subtype_name !== r.vch_type_name
          ? r.vch_subtype_name
          : (r.vch_type_name || '')).toLowerCase();
        if (!t.includes(ft)) return false;
      }
      const dr = Number(r.dr_amount || 0);
      const cr = Number(r.cr_amount || 0);
      if (drMin != null && !Number.isNaN(drMin) && dr < drMin) return false;
      if (drMax != null && !Number.isNaN(drMax) && dr > drMax) return false;
      if (crMin != null && !Number.isNaN(crMin) && cr < crMin) return false;
      if (crMax != null && !Number.isNaN(crMax) && cr > crMax) return false;
      return true;
    });

    const dir = sortDir === 'asc' ? 1 : -1;
    const byKey = (a: any, b: any) => {
      if (sortKey === 'dr_amount' || sortKey === 'cr_amount') {
        return (Number(a[sortKey] || 0) - Number(b[sortKey] || 0)) * dir;
      }
      if (sortKey === 'vch_date') {
        return (new Date(a.vch_date).getTime() - new Date(b.vch_date).getTime()) * dir;
      }
      return String(a[sortKey] || '').localeCompare(String(b[sortKey] || '')) * dir;
    };
    return [...out].sort(byKey);
  }, [rows, search, filterParticulars, filterVchType, filterVchNo, filterDrMin, filterDrMax, filterCrMin, filterCrMax, sortKey, sortDir]);

  const totalDr = filteredRows.reduce((s, r) => s + Number(r.dr_amount || 0), 0);
  const totalCr = filteredRows.reduce((s, r) => s + Number(r.cr_amount || 0), 0);

  // Client-side pagination, 10 per page. Totals above stay computed across
  // the full range so the footer reflects the whole period, not just the
  // visible page. Page resets to 1 whenever any applied filter changes so the
  // user doesn't get stranded on a page index that no longer exists.
  const PAGE_SIZE = 10;
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [dateFrom, dateTo, search, filterParticulars, filterVchType, filterVchNo, filterDrMin, filterDrMax, filterCrMin, filterCrMax]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const visibleRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Excel-style cells matching the Ledger Report layout — slate borders, slate-200
  // header row. The thead is sticky inside the scrolling table wrapper below
  // (single-source-of-truth scroll context), so the header pins reliably.
  const cell = 'border border-slate-300 px-2.5 py-1.5 text-[14px] leading-snug';
  const cellNum = `${cell} text-right tabular-nums whitespace-nowrap`;
  const headCell = 'border border-slate-400 bg-slate-200 px-2.5 py-1.5 text-[13px] font-bold text-slate-700 uppercase tracking-wide sticky top-0 z-10';
  const headBtn = 'flex items-center select-none cursor-pointer hover:text-blue-700';

  return (
    // Flex column constrained to the viewport below the fixed app nav
    // (h-14/md:h-16). The toolbar is `flex-none` so it never scrolls; the
    // table wrapper is `flex-1 overflow-auto` so rows scroll *inside* it,
    // pinning the toolbar AND the thead together. Desktop subtracts an
    // extra 8px for the main element's md:p-1 padding around it.
    <div className="flex flex-col w-full fixed left-0 right-0 top-14 bottom-16 sm:static sm:h-full sm:top-auto sm:bottom-auto" style={{ overscrollBehavior: "contain" }}>
      {/* ── Header bar ── */}
      <div className="flex-none bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between print:hidden">
        <div className="flex items-center gap-1">
          <button onClick={() => navigate(-1)} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 -ml-1" title="Back">
            <ChevronLeft size={20} />
          </button>
          <h1 className="text-[17px] font-bold text-slate-800">Day Book</h1>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowControls(s => !s)}
            className={`p-2 rounded-lg relative transition-colors ${showControls ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
            title="Date range & filters">
            <FilterIcon size={18} />
            {filterCount > 0 && !showControls && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none">
                {filterCount}
              </span>
            )}
          </button>
          <button onClick={load} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100" title="Refresh">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>


      {/* ── Date & filter slide-down ── */}
      {showControls && (
        <div className="flex-none bg-slate-50 border-b border-slate-200 px-3 py-2.5 print:hidden">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-stretch border border-slate-300 rounded bg-white overflow-hidden flex-1 min-w-[220px]">
              <div className="flex items-center gap-1 px-2 border-r border-slate-300 bg-slate-100">
                <Calendar size={12} className="text-slate-400" />
                <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wide">From</span>
              </div>
              <input type="date" value={draftFrom}
                onChange={e => setDraftFrom(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') applyDraft(); }}
                className="text-[13px] text-slate-700 outline-none bg-transparent px-2 py-1.5 flex-1 min-w-0" />
              <div className="flex items-center px-2 border-l border-r border-slate-300 bg-slate-100">
                <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wide">To</span>
              </div>
              <input type="date" value={draftTo}
                onChange={e => setDraftTo(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') applyDraft(); }}
                className="text-[13px] text-slate-700 outline-none bg-transparent px-2 py-1.5 flex-1 min-w-0" />
            </div>
            <button onClick={applyDraft} disabled={!draftDirty}
              className={`text-[13px] px-3 py-1.5 rounded text-white transition-colors ${draftDirty ? 'bg-blue-600 hover:bg-blue-700' : 'bg-slate-300 cursor-not-allowed'}`}>
              Apply
            </button>
            <button onClick={today}
              className="px-3 py-1.5 border border-slate-300 rounded bg-white text-[13px] text-slate-600 hover:bg-slate-100">
              Today
            </button>
            <button onClick={() => setFilterOpen(true)}
              className="relative flex items-center gap-1 px-3 py-1.5 border border-slate-300 rounded bg-white text-[13px] text-slate-700 hover:bg-slate-100">
              <FilterIcon size={13} className="text-slate-500" />
              More filters
              {filterCount > 0 && (
                <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold bg-blue-600 text-white">
                  {filterCount}
                </span>
              )}
            </button>
            {(hasColFilters || search) && (
              <button onClick={resetAllFilters}
                className="px-3 py-1.5 border border-slate-300 rounded bg-white text-[13px] text-slate-600 hover:bg-slate-100">
                <X size={12} className="inline mr-0.5" /> Clear
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Mobile: Tally-style flat list ── */}
      <div className="sm:hidden flex-1 min-h-0 overflow-auto bg-white" style={{ overscrollBehavior: "contain" }}>
        {loading ? (
          <div className="text-center text-slate-400 py-10 text-sm">Loading…</div>
        ) : filteredRows.length === 0 ? (
          <div className="text-center text-slate-400 py-10 text-sm">No vouchers found</div>
        ) : (
          <>
            {visibleRows.map(row => {
              const isDebit  = Number(row.dr_amount) > 0;
              const amount   = isDebit ? row.dr_amount : row.cr_amount;
              const subtype  = row.vch_subtype_name && row.vch_subtype_name !== row.vch_type_name
                ? row.vch_subtype_name : (row.vch_type_name || '');
              return (
                <div key={row.id} className="border-b border-gray-200"
                  onClick={() => openVoucher(row.id)}>
                  <div className="flex items-start justify-between px-4 py-3 active:bg-gray-50">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-gray-900 text-[15px] uppercase">{row.vch_type_name || '—'}</p>
                      <p className="text-[13px] text-gray-500 mt-0.5">
                        {displayDate(row.vch_date)}
                        {subtype ? <span> &nbsp;|&nbsp; {subtype}</span> : null}
                        {row.vch_no ? <span className="font-medium">  #{row.vch_no}</span> : null}
                      </p>
                      {row.party_name && <p className="text-[12px] text-gray-400 mt-0.5 truncate">{row.party_name}</p>}
                    </div>
                    <div className="ml-4 shrink-0 text-right">
                      <p className="text-[15px] font-medium text-gray-900 tabular-nums">
                        {fmt(amount)} {isDebit ? 'Dr.' : 'Cr.'}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* ── Desktop table ── */}
      <div className="hidden sm:block flex-1 min-h-0 overflow-auto bg-white border-b border-slate-300">
        <table className="border-collapse text-[14px] w-full table-fixed">
          <thead>
            <tr>
              <th className={`${headCell} text-left w-[110px]`}>
                <div className={headBtn} onClick={() => toggleSort('vch_date')}>Vch Date<SortIcon col="vch_date" /></div>
              </th>
              <th className={`${headCell} text-left w-full`}>
                <div className={headBtn} onClick={() => toggleSort('party_name')}>Particulars<SortIcon col="party_name" /></div>
              </th>
              <th className={`${headCell} text-left w-[140px]`}>
                <div className={headBtn} onClick={() => toggleSort('vch_no')}>Vch No.<SortIcon col="vch_no" /></div>
              </th>
              <th className={`${headCell} text-left w-[120px]`}>
                <div className={headBtn} onClick={() => toggleSort('vch_type_name')}>Vch Type<SortIcon col="vch_type_name" /></div>
              </th>
              <th className={`${headCell} text-right w-[140px]`}>
                <div className={headBtn + ' justify-end'} onClick={() => toggleSort('dr_amount')}>Debit<SortIcon col="dr_amount" /></div>
              </th>
              <th className={`${headCell} text-right w-[140px]`}>
                <div className={headBtn + ' justify-end'} onClick={() => toggleSort('cr_amount')}>Credit<SortIcon col="cr_amount" /></div>
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className={`${cell} text-center text-slate-400 py-6`}>Loading…</td></tr>
            ) : filteredRows.length === 0 ? (
              <tr><td colSpan={6} className={`${cell} text-center text-slate-400 py-6`}>
                {search
                  ? `No vouchers matching "${search}" between ${displayDate(dateFrom)} and ${displayDate(dateTo)}`
                  : (dateFrom === dateTo
                    ? `No vouchers for ${displayDate(dateFrom)}`
                    : `No vouchers between ${displayDate(dateFrom)} and ${displayDate(dateTo)}`)}
              </td></tr>
            ) : (
              visibleRows.map((row, i) => {
                const zebra = i % 2 === 1 ? 'bg-slate-50' : 'bg-white';
                return (
                  <tr key={row.id} className={`${zebra} hover:bg-blue-50`}>
                    <td className={`${cell} text-slate-600 whitespace-nowrap tabular-nums`}>{displayDate(row.vch_date)}</td>
                    <td className={`${cell} font-medium text-slate-800`}>{row.party_name || '—'}</td>
                    <td className={`${cell} whitespace-nowrap`}>
                      {row.vch_no ? (
                        <button onClick={() => openVoucher(row.id)}
                          className="text-blue-600 hover:text-blue-800 hover:underline font-medium">
                          {row.vch_no}
                        </button>
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                    <td className={`${cell} text-slate-700`}>
                      {row.vch_subtype_name && row.vch_subtype_name !== row.vch_type_name
                        ? row.vch_subtype_name
                        : (row.vch_type_name || '—')}
                    </td>
                    <td className={cellNum + ' text-slate-800 font-medium'}>
                      {Number(row.dr_amount) > 0 ? fmt(row.dr_amount) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className={cellNum + ' text-slate-800 font-medium'}>
                      {Number(row.cr_amount) > 0 ? fmt(row.cr_amount) : <span className="text-slate-300">—</span>}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {filteredRows.length > 0 && (
            <tfoot>
              <tr className="bg-slate-200 font-bold sticky bottom-0">
                <td colSpan={4} className={`${cell} text-slate-700`}>Total ({filteredRows.length} vouchers)</td>
                <td className={cellNum + ' text-slate-800'}>{fmt(totalDr)}</td>
                <td className={cellNum + ' text-slate-800'}>{fmt(totalCr)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Mobile Grand Total — fixed above pagination */}
      {!loading && filteredRows.length > 0 && (
        <div className="sm:hidden flex-none border-t border-gray-200 print:hidden">
          <div className="bg-blue-700 text-white px-4 py-2.5 flex justify-between items-center">
            <span className="font-bold text-sm tracking-widest">GRAND TOTAL</span>
            <span className="text-sm tabular-nums font-semibold">{filteredRows.length} vouchers</span>
          </div>
          <div className="flex divide-x divide-gray-200 bg-white">
            <div className="flex-1 px-3 py-2.5">
              <div className="text-[10px] uppercase text-gray-400 font-bold tracking-wide">Debit</div>
              <div className="text-[13px] font-bold text-emerald-700 tabular-nums mt-0.5">{fmt(totalDr)}</div>
            </div>
            <div className="flex-1 px-3 py-2.5">
              <div className="text-[10px] uppercase text-gray-400 font-bold tracking-wide">Credit</div>
              <div className="text-[13px] font-bold text-red-600 tabular-nums mt-0.5">{fmt(totalCr)}</div>
            </div>
            <div className="flex-1 px-3 py-2.5">
              <div className="text-[10px] uppercase text-gray-400 font-bold tracking-wide">Net {totalDr >= totalCr ? 'Dr' : 'Cr'}</div>
              <div className={`text-[13px] font-bold tabular-nums mt-0.5 ${Math.abs(totalDr - totalCr) < 0.01 ? 'text-green-600' : 'text-blue-700'}`}>
                {fmt(Math.abs(totalDr - totalCr))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pagination — flex-none keeps it at bottom */}
      {filteredRows.length > PAGE_SIZE && (
        <div className="flex-none flex items-center justify-between px-3 py-2 bg-white border-t border-slate-200 text-xs text-slate-600 print:hidden">
          <div>
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredRows.length)} of {filteredRows.length}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-1 rounded border border-slate-300 bg-white disabled:opacity-30 hover:bg-slate-50"
              title="Previous"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="px-2">Page {page} of {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-1 rounded border border-slate-300 bg-white disabled:opacity-30 hover:bg-slate-50"
              title="Next"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ── Filter Modal ── */}
      {filterOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 overflow-y-auto"
          onClick={closeFilter}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md mt-16"
            onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center px-5 py-3 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                <FilterIcon size={15} className="text-slate-500" /> Filters
              </h3>
              <button onClick={closeFilter} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <label className="block">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Search</span>
                <input value={draftSearch} onChange={e => setDraftSearch(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') applyFromModal(); }}
                  placeholder="Vch no / party / remark…"
                  className="mt-1 w-full px-2 py-1.5 border border-slate-300 rounded text-[13px] outline-none focus:ring-1 focus:ring-blue-300 focus:border-blue-400" />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Particulars</span>
                <input value={draftParticulars} onChange={e => setDraftParticulars(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') applyFromModal(); }}
                  placeholder="Party name…"
                  className="mt-1 w-full px-2 py-1.5 border border-slate-300 rounded text-[13px] outline-none focus:ring-1 focus:ring-blue-300 focus:border-blue-400" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Vch No.</span>
                  <input value={draftVchNo} onChange={e => setDraftVchNo(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') applyFromModal(); }}
                    placeholder="filter no…"
                    className="mt-1 w-full px-2 py-1.5 border border-slate-300 rounded text-[13px] outline-none focus:ring-1 focus:ring-blue-300 focus:border-blue-400" />
                </label>
                <label className="block">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Vch Type</span>
                  <input value={draftVchType} onChange={e => setDraftVchType(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') applyFromModal(); }}
                    placeholder="filter type…"
                    className="mt-1 w-full px-2 py-1.5 border border-slate-300 rounded text-[13px] outline-none focus:ring-1 focus:ring-blue-300 focus:border-blue-400" />
                </label>
              </div>
              <div>
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Debit Range</span>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <input type="number" value={draftDrMin} onChange={e => setDraftDrMin(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') applyFromModal(); }}
                    placeholder="min"
                    className="w-full px-2 py-1.5 border border-slate-300 rounded text-[13px] tabular-nums outline-none focus:ring-1 focus:ring-blue-300 focus:border-blue-400" />
                  <input type="number" value={draftDrMax} onChange={e => setDraftDrMax(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') applyFromModal(); }}
                    placeholder="max"
                    className="w-full px-2 py-1.5 border border-slate-300 rounded text-[13px] tabular-nums outline-none focus:ring-1 focus:ring-blue-300 focus:border-blue-400" />
                </div>
              </div>
              <div>
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Credit Range</span>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <input type="number" value={draftCrMin} onChange={e => setDraftCrMin(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') applyFromModal(); }}
                    placeholder="min"
                    className="w-full px-2 py-1.5 border border-slate-300 rounded text-[13px] tabular-nums outline-none focus:ring-1 focus:ring-blue-300 focus:border-blue-400" />
                  <input type="number" value={draftCrMax} onChange={e => setDraftCrMax(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') applyFromModal(); }}
                    placeholder="max"
                    className="w-full px-2 py-1.5 border border-slate-300 rounded text-[13px] tabular-nums outline-none focus:ring-1 focus:ring-blue-300 focus:border-blue-400" />
                </div>
              </div>
            </div>
            <div className="flex justify-between items-center gap-2 px-5 py-3 border-t border-gray-100 bg-slate-50">
              <button onClick={resetFiltersInModal}
                className="text-[12px] text-slate-600 hover:text-slate-900 underline">
                Reset
              </button>
              <div className="flex gap-2">
                <button onClick={closeFilter}
                  className="px-3 py-1.5 text-[13px] border border-slate-300 rounded hover:bg-slate-100 bg-white text-slate-700">
                  Cancel
                </button>
                <button onClick={applyFromModal}
                  className="px-4 py-1.5 text-[13px] rounded bg-blue-600 hover:bg-blue-700 text-white">
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
