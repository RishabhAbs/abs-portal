import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ExternalLink, X, Calendar, ChevronLeft, ChevronRight, RefreshCw,
  ChevronUp, ChevronDown, ChevronsUpDown, Filter as FilterIcon,
  CheckCircle2, Circle, ShieldCheck,
} from 'lucide-react';
import { vouchersApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast/Toast';

const fmt = (n: any) =>
  Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const toInputDate = (d: Date) => d.toISOString().split('T')[0];
const displayDate = (s: string) => {
  if (!s) return '';
  const d = new Date(s);
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
};
// Compact "07-May 14:30" form for the Status pill — short enough to fit
// alongside the reviewer's name without forcing the column wider.
const fmtCheckedAt = (s?: string | null) => {
  if (!s) return '';
  const d = new Date(s);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mn = String(d.getMinutes()).padStart(2, '0');
  return `${dd}-${months[d.getMonth()]} ${hh}:${mn}`;
};
// Long form for tooltips — full date + 12h time.
const fmtCheckedAtLong = (s?: string | null) => {
  if (!s) return '';
  return new Date(s).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
};

type ReviewMode = 'pending' | 'checked' | 'all';

export default function PendingReview() {
  const navigate = useNavigate();
  const { showError, showSuccess } = useToast();
  const { canCheckPermission, canEdit, isAdmin } = useAuth();
  // Marking as Checked is the routine reviewer action — anyone with edit
  // access or the explicit vouchers.check permission can do it. Unmarking
  // is admin-only because it removes an audit-trail entry.
  const canMarkChecked =
    canCheckPermission('vouchers', 'check')
    || canEdit('vouchers')
    || canEdit('activities');
  const isAdminUser = isAdmin();

  // Default range = current FY → today, since auditors usually want a wide
  // window to catch any unreviewed entries that slipped through.
  const fyDefault = (() => {
    const today = new Date();
    const y = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
    return { from: toInputDate(new Date(y, 3, 1)), to: toInputDate(today) };
  })();

  const [searchParams, setSearchParams] = useSearchParams();
  const dateFrom = searchParams.get('from') || fyDefault.from;
  const dateTo   = searchParams.get('to')   || fyDefault.to;
  const search   = searchParams.get('q')    || '';
  const mode     = (searchParams.get('mode') as ReviewMode) || 'pending';
  const filterParticulars = searchParams.get('p') || '';
  const filterVchType     = searchParams.get('vt') || '';
  const filterVchNo       = searchParams.get('vn') || '';

  const [draftFrom,        setDraftFrom]        = useState(dateFrom);
  const [draftTo,          setDraftTo]          = useState(dateTo);
  const [draftSearch,      setDraftSearch]      = useState(search);
  const [draftParticulars, setDraftParticulars] = useState(filterParticulars);
  const [draftVchType,     setDraftVchType]     = useState(filterVchType);
  const [draftVchNo,       setDraftVchNo]       = useState(filterVchNo);

  useEffect(() => { setDraftFrom(dateFrom); }, [dateFrom]);
  useEffect(() => { setDraftTo(dateTo); },     [dateTo]);
  useEffect(() => { setDraftSearch(search); }, [search]);
  useEffect(() => { setDraftParticulars(filterParticulars); }, [filterParticulars]);
  useEffect(() => { setDraftVchType(filterVchType); }, [filterVchType]);
  useEffect(() => { setDraftVchNo(filterVchNo); }, [filterVchNo]);

  type ApplyArgs = {
    from: string; to: string; q: string;
    p: string; vt: string; vn: string;
    mode: ReviewMode;
  };
  const updateParams = (a: ApplyArgs) => {
    const next: Record<string, string> = { from: a.from, to: a.to, mode: a.mode };
    if (a.q)  next.q  = a.q;
    if (a.p)  next.p  = a.p;
    if (a.vt) next.vt = a.vt;
    if (a.vn) next.vn = a.vn;
    setSearchParams(next, { replace: true });
  };
  const applyDraft = () => updateParams({
    from: draftFrom, to: draftTo, q: draftSearch.trim(),
    p: draftParticulars.trim(), vt: draftVchType.trim(), vn: draftVchNo.trim(),
    mode,
  });
  const setMode = (next: ReviewMode) => updateParams({
    from: dateFrom, to: dateTo, q: search,
    p: filterParticulars, vt: filterVchType, vn: filterVchNo,
    mode: next,
  });
  const draftDirty =
    draftFrom !== dateFrom ||
    draftTo !== dateTo ||
    draftSearch.trim() !== search ||
    draftParticulars.trim() !== filterParticulars ||
    draftVchType.trim() !== filterVchType ||
    draftVchNo.trim() !== filterVchNo;
  const hasFilters = !!(filterParticulars || filterVchType || filterVchNo || search);
  const filterCount =
    (search ? 1 : 0) +
    (filterParticulars ? 1 : 0) +
    (filterVchNo ? 1 : 0) +
    (filterVchType ? 1 : 0);
  const resetAllFilters = () => {
    setDraftSearch(''); setDraftParticulars(''); setDraftVchType(''); setDraftVchNo('');
    setSearchParams({ from: dateFrom, to: dateTo, mode }, { replace: true });
  };

  const [filterOpen, setFilterOpen] = useState(false);
  const closeFilter = () => {
    setDraftSearch(search);
    setDraftParticulars(filterParticulars);
    setDraftVchType(filterVchType);
    setDraftVchNo(filterVchNo);
    setFilterOpen(false);
  };
  const applyFromModal = () => { applyDraft(); setFilterOpen(false); };
  const resetFiltersInModal = () => {
    setDraftSearch(''); setDraftParticulars(''); setDraftVchType(''); setDraftVchNo('');
  };

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  // Mark / unmark confirmation. `mode` is the action; `row` is the voucher
  // we're acting on (null when the modal is closed). Single state for both
  // flows so we can reuse one modal.
  const [confirm, setConfirm] = useState<{ mode: 'mark' | 'unmark'; row: any } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

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
    } catch { showError('Error', 'Failed to load vouchers'); }
    finally { setLoading(false); }
  }, [dateFrom, dateTo, showError]);

  useEffect(() => { load(); }, [load]);

  const today = () => {
    const t = toInputDate(new Date());
    setSearchParams({ from: t, to: t, mode }, { replace: true });
  };

  const openVoucher = (id: number) => navigate(`/billing/vouchers/edit/${id}`);

  // Trigger the in-app confirm modal. Actual API call happens in the modal's
  // confirm button so we can show a busy state and avoid the native dialog.
  const promptMark   = (row: any) => setConfirm({ mode: 'mark', row });
  const promptUnmark = (row: any) => setConfirm({ mode: 'unmark', row });
  const runConfirm = async () => {
    if (!confirm) return;
    setConfirmBusy(true);
    try {
      if (confirm.mode === 'mark') {
        await vouchersApi.markChecked(confirm.row.id);
        showSuccess('Marked', 'Voucher marked as Checked');
      } else {
        await vouchersApi.markUnchecked(confirm.row.id);
        showSuccess('Unchecked', 'Voucher unmarked');
      }
      setConfirm(null);
      load();
    } catch (e: any) {
      showError('Error', e?.message || 'Failed');
    } finally { setConfirmBusy(false); }
  };

  const filteredRows = useMemo(() => {
    const q  = (search || '').trim().toLowerCase();
    const fp = (filterParticulars || '').trim().toLowerCase();
    const ft = (filterVchType || '').trim().toLowerCase();
    const fn = (filterVchNo || '').trim().toLowerCase();
    const out = rows.filter(r => {
      // Mode filter — pending = unchecked, checked = reviewed, all = both.
      if (mode === 'pending' && r.checked_by) return false;
      if (mode === 'checked' && !r.checked_by) return false;
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
  }, [rows, mode, search, filterParticulars, filterVchType, filterVchNo, sortKey, sortDir]);

  // Counts shown in the mode chips — always reflect the full date-range
  // dataset, not the current mode, so the user sees how many are pending
  // even while viewing 'checked'.
  const counts = useMemo(() => {
    let pending = 0, checked = 0;
    for (const r of rows) {
      if (r.checked_by) checked++;
      else pending++;
    }
    return { pending, checked, all: rows.length };
  }, [rows]);

  const totalDr = filteredRows.reduce((s, r) => s + Number(r.dr_amount || 0), 0);
  const totalCr = filteredRows.reduce((s, r) => s + Number(r.cr_amount || 0), 0);

  const PAGE_SIZE = 10;
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [dateFrom, dateTo, search, filterParticulars, filterVchType, filterVchNo, mode]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const visibleRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const cell = 'border border-slate-300 px-2.5 py-1.5 text-[14px] leading-snug';
  const cellNum = `${cell} text-right tabular-nums whitespace-nowrap`;
  const headCell = 'border border-slate-400 bg-slate-200 px-2.5 py-1.5 text-[13px] font-bold text-slate-700 uppercase tracking-wide sticky top-0 z-10';
  const headBtn = 'flex items-center select-none cursor-pointer hover:text-blue-700';

  // Segmented mode toggle — visually one connected control with three
  // buttons. The active button gets the colour swatch, inactive stay neutral
  // but keep their count badge so the user can see the totals without
  // switching tabs.
  const ModeChip = ({ value, label, count, color }: { value: ReviewMode; label: string; count: number; color: string }) => (
    <button onClick={() => setMode(value)}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold border transition-colors first:rounded-l last:rounded-r -ml-px first:ml-0 ${
        mode === value
          ? `${color} text-white border-transparent shadow-inner relative z-10`
          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
      }`}>
      {label}
      <span className={`inline-flex items-center justify-center min-w-[20px] h-[18px] px-1.5 rounded-full text-[10px] font-bold ${
        mode === value ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-600'
      }`}>
        {count}
      </span>
    </button>
  );

  return (
    <div className="flex flex-col w-full fixed left-0 right-0 top-14 bottom-16 sm:static sm:h-full sm:top-auto sm:bottom-auto" style={{ overscrollBehavior: "contain" }}>
      {/* Toolbar */}
      <div className="flex-none bg-slate-50 px-3 pt-2 pb-2 border-b border-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <ShieldCheck size={18} className="text-blue-600" />
            Pending Review
          </h1>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex">
              <ModeChip value="pending" label="Pending" count={counts.pending} color="bg-amber-500" />
              <ModeChip value="checked" label="Checked" count={counts.checked} color="bg-emerald-600" />
              <ModeChip value="all"     label="All"     count={counts.all}     color="bg-slate-600" />
            </div>
            <button onClick={() => setFilterOpen(true)} title="Open filters"
              className="relative flex items-center gap-1 px-2.5 py-1.5 border border-slate-300 rounded hover:bg-slate-50 bg-white text-[12px] text-slate-700">
              <FilterIcon size={12} className="text-slate-500" />
              Filter
              {filterCount > 0 && (
                <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold bg-blue-600 text-white">
                  {filterCount}
                </span>
              )}
            </button>
            <div className="flex items-stretch border border-slate-300 rounded bg-white overflow-hidden">
              <div className="flex items-center gap-1 px-2 border-r border-slate-300 bg-slate-50">
                <Calendar size={12} className="text-slate-400" />
                <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wide">From</span>
              </div>
              <input type="date" value={draftFrom}
                onChange={e => setDraftFrom(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') applyDraft(); }}
                className="text-[13px] text-slate-700 outline-none bg-transparent px-2 py-1.5 w-[125px]" />
              <div className="flex items-center px-2 border-l border-r border-slate-300 bg-slate-50">
                <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wide">To</span>
              </div>
              <input type="date" value={draftTo}
                onChange={e => setDraftTo(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') applyDraft(); }}
                className="text-[13px] text-slate-700 outline-none bg-transparent px-2 py-1.5 w-[125px]" />
            </div>
            <button onClick={applyDraft} disabled={!draftDirty}
              className={`text-[12px] px-3 py-1.5 rounded text-white transition-colors ${draftDirty ? 'bg-blue-600 hover:bg-blue-700' : 'bg-slate-300 cursor-not-allowed'}`}>
              Apply
            </button>
            <button onClick={today} title="Today"
              className="px-2 py-1.5 border border-slate-300 rounded hover:bg-slate-50 bg-white text-[12px] text-slate-600">
              Today
            </button>
            {hasFilters && (
              <button onClick={resetAllFilters} title="Clear all filters"
                className="px-2 py-1.5 border border-slate-300 rounded hover:bg-slate-50 bg-white text-[12px] text-slate-600">
                <X size={12} className="inline mr-0.5" /> Clear filters
              </button>
            )}
            <button onClick={load} title="Refresh"
              className="p-1.5 border border-slate-300 rounded hover:bg-slate-50 bg-white">
              <RefreshCw size={12} className={loading ? 'animate-spin text-slate-500' : 'text-slate-500'} />
            </button>
          </div>
        </div>
      </div>

      {/* Scrollable table area */}
      <div className="flex-1 min-h-0 overflow-auto bg-white border-x border-b border-slate-300 mx-3 mb-3" style={{ overscrollBehavior: 'contain' }}>
        <table className="border-collapse text-[14px] w-full">
          <thead>
            <tr>
              <th className={`${headCell} text-left w-28`}>
                <div className={headBtn} onClick={() => toggleSort('vch_date')}>Vch Date<SortIcon col="vch_date" /></div>
              </th>
              <th className={`${headCell} text-left`}>
                <div className={headBtn} onClick={() => toggleSort('party_name')}>Particulars<SortIcon col="party_name" /></div>
              </th>
              <th className={`${headCell} text-left w-28`}>
                <div className={headBtn} onClick={() => toggleSort('vch_no')}>Vch No.<SortIcon col="vch_no" /></div>
              </th>
              <th className={`${headCell} text-left w-28`}>
                <div className={headBtn} onClick={() => toggleSort('vch_type_name')}>Vch Type<SortIcon col="vch_type_name" /></div>
              </th>
              <th className={`${headCell} text-right w-32`}>
                <div className={headBtn + ' justify-end'} onClick={() => toggleSort('dr_amount')}>Debit<SortIcon col="dr_amount" /></div>
              </th>
              <th className={`${headCell} text-right w-32`}>
                <div className={headBtn + ' justify-end'} onClick={() => toggleSort('cr_amount')}>Credit<SortIcon col="cr_amount" /></div>
              </th>
              <th className={`${headCell} text-center w-52`}>Status</th>
              <th className={`${headCell} text-center w-24`}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className={`${cell} text-center text-slate-400 py-6`}>Loading…</td></tr>
            ) : filteredRows.length === 0 ? (
              <tr><td colSpan={8} className={`${cell} text-center py-12`}>
                <div className="flex flex-col items-center gap-2 text-slate-400">
                  {mode === 'pending'
                    ? <CheckCircle2 size={36} className="text-emerald-300" />
                    : <ShieldCheck size={36} className="text-slate-300" />}
                  <span className="text-sm font-medium text-slate-500">
                    {mode === 'pending'
                      ? 'All caught up — no vouchers awaiting review.'
                      : mode === 'checked'
                        ? 'No reviewed vouchers in this range yet.'
                        : 'No vouchers in this range.'}
                  </span>
                </div>
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
                    <td className={`${cell} text-center`}>
                      {row.checked_by ? (
                        isAdminUser ? (
                          <button type="button"
                            title={`Checked by ${row.checked_by} on ${fmtCheckedAtLong(row.checked_at)} — click to unmark`}
                            onClick={() => promptUnmark(row)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 bg-emerald-100 hover:bg-emerald-200 rounded-full whitespace-nowrap transition-colors">
                            <CheckCircle2 size={12} />
                            <span className="flex flex-col items-start leading-tight">
                              <span>{row.checked_by}</span>
                              {row.checked_at && (
                                <span className="text-[9px] font-medium text-emerald-700/80 tabular-nums">
                                  {fmtCheckedAt(row.checked_at)}
                                </span>
                              )}
                            </span>
                          </button>
                        ) : (
                          <span title={`Checked by ${row.checked_by} on ${fmtCheckedAtLong(row.checked_at)}`}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 bg-emerald-100 rounded-full whitespace-nowrap">
                            <CheckCircle2 size={12} />
                            <span className="flex flex-col items-start leading-tight">
                              <span>{row.checked_by}</span>
                              {row.checked_at && (
                                <span className="text-[9px] font-medium text-emerald-700/80 tabular-nums">
                                  {fmtCheckedAt(row.checked_at)}
                                </span>
                              )}
                            </span>
                          </span>
                        )
                      ) : (
                        canMarkChecked ? (
                          <button type="button"
                            title="Mark as Checked"
                            onClick={() => promptMark(row)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold text-white bg-amber-500 hover:bg-amber-600 rounded-full whitespace-nowrap shadow-sm transition-colors">
                            <Circle size={12} /> Mark Checked
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold text-amber-800 bg-amber-100 rounded-full whitespace-nowrap">
                            <Circle size={12} /> Pending
                          </span>
                        )
                      )}
                    </td>
                    <td className={`${cell} text-center`}>
                      <button onClick={() => openVoucher(row.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-full whitespace-nowrap transition-colors"
                        title="Open voucher">
                        <ExternalLink size={12} /> Open
                      </button>
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
                <td className={cell} />
                <td className={cell} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Sticky footer wrapper for mobile */}
      <div className="sticky bottom-16 md:relative md:bottom-auto z-20 bg-white print:hidden">
        {filteredRows.length > PAGE_SIZE && (
          <div className="flex items-center justify-between px-3 py-2 mx-0 sm:mx-3 mb-0 sm:mb-2 bg-white border-t sm:border border-slate-300 text-xs text-slate-600">
            <div>
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredRows.length)} of {filteredRows.length}
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="p-1 rounded border border-slate-300 bg-white disabled:opacity-30 hover:bg-slate-50" title="Previous">
                <ChevronLeft size={14} />
              </button>
              <span className="px-2">Page {page} of {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                className="p-1 rounded border border-slate-300 bg-white disabled:opacity-30 hover:bg-slate-50" title="Next">
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Mark / Unmark Confirm Modal — replaces window.confirm so the prompt
          fits the rest of the app's chrome and we can show a busy state. */}
      {confirm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-5">
            <h3 className="font-semibold text-gray-800 mb-2">
              {confirm.mode === 'mark' ? 'Mark Voucher as Checked' : 'Remove Checked Flag'}
            </h3>
            <p className="text-sm text-gray-600 mb-1">
              <span className="font-semibold">{confirm.row.party_name || '—'}</span>
              {confirm.row.vch_no && <> · {confirm.row.vch_no}</>}
            </p>
            <p className="text-sm text-gray-600 mb-5">
              {confirm.mode === 'mark' ? (
                <>Mark this voucher as <span className="font-semibold text-emerald-700">Checked</span>? Once marked, the voucher is locked — <span className="font-semibold">only an admin can unmark or delete it</span>.</>
              ) : (
                <>Remove the Checked flag from this voucher? It will become <span className="font-semibold">editable and deletable</span> again by anyone with the appropriate permission.</>
              )}
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setConfirm(null)}
                className="px-4 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50">
                Cancel
              </button>
              <button type="button" disabled={confirmBusy} onClick={runConfirm}
                className={`px-4 py-1.5 text-sm rounded text-white disabled:opacity-50 ${
                  confirm.mode === 'mark' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-600 hover:bg-amber-700'
                }`}>
                {confirmBusy
                  ? (confirm.mode === 'mark' ? 'Marking…' : 'Unmarking…')
                  : (confirm.mode === 'mark' ? 'Mark as Checked' : 'Unmark')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filter Modal */}
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
