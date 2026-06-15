import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, X, Search, Copy, Check, ExternalLink, Clock, Info, Zap } from 'lucide-react';
import { tdlExpiryApi, tdlBillingApi, customersApi } from '../services/api';
import { useToast } from '../components/Toast/Toast';
import { useAuth } from '../context/AuthContext';

type BillingCycle = 'monthly' | 'quarterly' | 'half_yearly' | 'yearly';

interface ExpiryRow {
  id: number;
  customer_name: string;
  tdl_name: string;
  first_activation_date: string | null;
  total_amount: number;
  amc_amount: number;
  billing_cycle: BillingCycle;
  start_date: string | null;
  remark: string | null;
  expiry_date: string;
  texpiry: string | null;
  release_version: string | null;
  token: string;
  is_active: number;
}

const EMPTY_FORM = {
  customer_name: '',
  tdl_name: '',
  first_activation_date: '',
  total_amount: '',
  amc_amount: '',
  billing_cycle: 'yearly' as BillingCycle,
  start_date: '',
  remark: '',
  expiry_date: '',
  release_version: '',
};

const PAGE_SIZE = 25;

const CYCLE_MONTHS: Record<BillingCycle, number> = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 };
const CYCLE_LABELS: Record<BillingCycle, string> = { monthly: 'Monthly', quarterly: 'Quarterly', half_yearly: 'Half-Yearly', yearly: 'Yearly' };

function calcExpiry(start: string, cycle: BillingCycle): string {
  const d = new Date(start);
  if (cycle === 'yearly') d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + CYCLE_MONTHS[cycle]);
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

interface GenActivityForm {
  cycle: BillingCycle;
  start_date: string;
  total_amount: string;
  notes: string;
}

const toYMD = (d: string | null) => (d ? d.split('T')[0] : '');

const fmt = (d: string | null) => {
  if (!d) return '—';
  const [y, m, day] = d.split('T')[0].split('-');
  return `${day}/${m}/${y}`;
};

const addDays = (ymd: string, days: number) => {
  const d = new Date(ymd);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
};

const daysBetween = (from: string, to: string) => {
  const a = new Date(from);
  const b = new Date(to);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
};

const isExpiredDate = (ymd: string) => {
  if (!ymd) return false;
  return ymd < new Date().toISOString().split('T')[0];
};

// texpiry is "active" (relevant) only when it falls after expiry_date
const hasActiveTexpiry = (r: ExpiryRow) =>
  !!r.texpiry && !!r.expiry_date && toYMD(r.texpiry) > toYMD(r.expiry_date);

// Extend button visible when today is within 7 days before expiry OR texpiry already set
const canShowExtend = (r: ExpiryRow) => {
  if (hasActiveTexpiry(r)) return true;
  if (!r.expiry_date) return false;
  const today = new Date().toISOString().split('T')[0];
  const window = addDays(toYMD(r.expiry_date), -7);
  return today >= window;
};

const TdlExpiry: React.FC = () => {
  const { showSuccess, showError } = useToast();
  const { canCreate, canEdit, canDelete } = useAuth();

  const [rows, setRows] = useState<ExpiryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // Create / Edit modal
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<ExpiryRow | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  // Customer search (create mode)
  const [custSearch, setCustSearch] = useState('');
  const [custResults, setCustResults] = useState<{ id: string; company: string }[]>([]);
  const [showCustDrop, setShowCustDrop] = useState(false);
  const [custSearching, setCustSearching] = useState(false);
  const [custHighlight, setCustHighlight] = useState(-1);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<ExpiryRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Active/Inactive toggle
  const [togglingId, setTogglingId] = useState<number | null>(null);

  // Extend modal
  const [extendTarget, setExtendTarget] = useState<ExpiryRow | null>(null);
  const [extendDate, setExtendDate] = useState('');
  const [extendSaving, setExtendSaving] = useState(false);

  const [copiedId, setCopiedId] = useState<number | null>(null);

  // Generate Activity modal
  const [genRow, setGenRow] = useState<ExpiryRow | null>(null);
  const [genType, setGenType] = useState<'new' | 'renew'>('new');
  const [genForm, setGenForm] = useState<GenActivityForm>({ cycle: 'yearly', start_date: '', total_amount: '', notes: '' });
  const [genSaving, setGenSaving] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await tdlExpiryApi.getAll(page, PAGE_SIZE, search);
      if (res.success) {
        setRows(res.data || []);
        setTotal(res.total || 0);
      }
    } catch (e: any) {
      showError('Error', e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [page, search, showError]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setShowModal(true);
  };

  const openEdit = (r: ExpiryRow) => {
    setEditing(r);
    setForm({
      customer_name: r.customer_name,
      tdl_name: r.tdl_name,
      first_activation_date: toYMD(r.first_activation_date),
      total_amount: String(r.total_amount ?? ''),
      amc_amount: String(r.amc_amount ?? ''),
      billing_cycle: r.billing_cycle || 'yearly',
      start_date: toYMD(r.start_date),
      remark: r.remark || '',
      expiry_date: toYMD(r.expiry_date),
      release_version: r.release_version || '',
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditing(null);
    setCustSearch('');
    setCustResults([]);
    setShowCustDrop(false);
  };

  // Debounced customer search
  useEffect(() => {
    if (editing) return; // Only for create mode
    if (custSearch.length < 2) { setCustResults([]); setShowCustDrop(false); return; }
    const t = setTimeout(async () => {
      setCustSearching(true);
      try {
        const res = await customersApi.search(custSearch);
        const results = (res.data || res || []) as { id: string; company: string }[];
        setCustResults(results);
        setShowCustDrop(results.length > 0);
      } catch { setCustResults([]); }
      finally { setCustSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [custSearch, editing]);

  const openExtend = (r: ExpiryRow) => {
    setExtendTarget(r);
    setExtendDate(hasActiveTexpiry(r) ? toYMD(r.texpiry) : '');
  };

  const closeExtend = () => { setExtendTarget(null); setExtendDate(''); };

  const handleSave = async () => {
    if (!form.customer_name.trim()) { showError('Validation', 'Customer Name is required'); return; }
    if (!form.tdl_name.trim())      { showError('Validation', 'TDL Name is required'); return; }

    setSaving(true);
    try {
      const payload = {
        customer_name: form.customer_name.trim(),
        tdl_name: form.tdl_name.trim(),
        first_activation_date: form.first_activation_date || undefined,
        total_amount: form.total_amount ? parseFloat(form.total_amount) : 0,
        amc_amount: form.amc_amount ? parseFloat(form.amc_amount) : 0,
        billing_cycle: form.billing_cycle,
        start_date: form.start_date || undefined,
        remark: form.remark.trim() || undefined,
        expiry_date: form.expiry_date,
        release_version: form.release_version.trim() || undefined,
      };

      if (editing) {
        const res = await tdlExpiryApi.update(editing.id, payload);
        if (res.success) { showSuccess('Saved', 'Record updated'); closeModal(); fetchData(); }
        else showError('Error', res.message || 'Update failed');
      } else {
        const res = await tdlExpiryApi.create(payload);
        if (res.success) { showSuccess('Created', 'TDL expiry record created'); closeModal(); fetchData(); }
        else showError('Error', res.message || 'Create failed');
      }
    } catch (e: any) {
      showError('Error', e?.message || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await tdlExpiryApi.delete(deleteTarget.id);
      if (res.success) { showSuccess('Deleted', 'Record removed'); setDeleteTarget(null); fetchData(); }
      else showError('Error', res.message || 'Delete failed');
    } catch (e: any) {
      showError('Error', e?.message || 'Failed to delete');
    } finally {
      setDeleting(false);
    }
  };

  const handleToggleActive = async (row: ExpiryRow) => {
    const newState = !row.is_active;
    if (!window.confirm(`${newState ? 'Activate' : 'Deactivate'} token for ${row.customer_name} — ${row.tdl_name}? ${newState ? 'Tally will accept this TDL again.' : 'Tally will immediately reject this TDL.'}`)) return;
    setTogglingId(row.id);
    try {
      const res = await tdlExpiryApi.setActive(row.id, newState);
      if (res.success) {
        showSuccess(newState ? 'Activated' : 'Deactivated', res.message);
        fetchData();
      } else showError('Error', res.message || 'Failed');
    } catch (e: any) {
      showError('Error', e?.message || 'Failed');
    } finally {
      setTogglingId(null);
    }
  };

  const handleExtend = async () => {
    if (!extendTarget || !extendDate) { showError('Validation', 'Select a temporary extension date'); return; }
    if (extendDate <= toYMD(extendTarget.expiry_date)) {
      showError('Validation', 'TExpiry must be after the original expiry date');
      return;
    }
    setExtendSaving(true);
    try {
      const res = await tdlExpiryApi.update(extendTarget.id, { texpiry: extendDate } as any);
      if (res.success) {
        showSuccess('Extended', `TDL validity extended to ${fmt(extendDate)}`);
        closeExtend();
        fetchData();
      } else showError('Error', res.message || 'Failed to extend');
    } catch (e: any) {
      showError('Error', e?.message || 'Failed');
    } finally {
      setExtendSaving(false);
    }
  };

  const handleClearTexpiry = async () => {
    if (!extendTarget) return;
    setExtendSaving(true);
    try {
      const res = await tdlExpiryApi.update(extendTarget.id, { texpiry: null } as any);
      if (res.success) {
        showSuccess('Cleared', 'Extension removed');
        closeExtend();
        fetchData();
      } else showError('Error', res.message || 'Failed to clear');
    } catch (e: any) {
      showError('Error', e?.message || 'Failed');
    } finally {
      setExtendSaving(false);
    }
  };

  const copyToken = async (row: ExpiryRow) => {
    const url = tdlExpiryApi.publicCheckUrl(row.token);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(row.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      showError('Error', 'Could not copy to clipboard');
    }
  };

  const openGenActivity = (r: ExpiryRow) => {
    const isNew = !r.expiry_date;
    const today = new Date().toISOString().split('T')[0];
    // Pre-fill cycle from the record's stored billing_cycle
    const defaultCycle: BillingCycle = r.billing_cycle || 'yearly';
    // Pre-fill start date from the record's stored start_date for new, or day after expiry for renewal
    const defaultStart = isNew
      ? (r.start_date ? toYMD(r.start_date) : today)
      : (r.texpiry && toYMD(r.texpiry) > toYMD(r.expiry_date)
          ? (() => { const d = new Date(toYMD(r.expiry_date)); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0]; })()
          : today);
    const defaultTotal = isNew
      ? String(r.total_amount ?? '')
      : String(Math.round((Number(r.amc_amount) / 12) * CYCLE_MONTHS[defaultCycle]));
    setGenRow(r);
    setGenType(isNew ? 'new' : 'renew');
    setGenForm({ cycle: defaultCycle, start_date: defaultStart, total_amount: defaultTotal, notes: r.remark || '' });
  };

  const handleGenCycleChange = (cycle: BillingCycle) => {
    if (!genRow) return;
    const months = CYCLE_MONTHS[cycle];
    const total = genType === 'renew'
      ? String(Math.round((Number(genRow.amc_amount) / 12) * months))
      : genForm.total_amount;
    setGenForm(f => ({ ...f, cycle, total_amount: total }));
  };

  const handleGenSubmit = async () => {
    if (!genRow) return;
    if (!genForm.start_date) { showError('Validation', 'Start date is required'); return; }
    setGenSaving(true);
    try {
      const res = await tdlBillingApi.create({
        tdl_expiry_id: genRow.id,
        customer_name: genRow.customer_name,
        tdl_name: genRow.tdl_name,
        cycle: genForm.cycle,
        amc_amount: Number(genRow.amc_amount) || 0,
        total_amount: parseFloat(genForm.total_amount) || 0,
        start_date: genForm.start_date,
        notes: genForm.notes || undefined,
      });
      if (res) {
        showSuccess('Activity Created', `${genType === 'new' ? 'New' : 'Renewal'} billing activity saved · Expiry: ${fmt(calcExpiry(genForm.start_date, genForm.cycle))}`);
        setGenRow(null);
        fetchData();
      }
    } catch (e: any) {
      showError('Error', e?.message || 'Failed to create activity');
    } finally {
      setGenSaving(false);
    }
  };

  const pageNums = Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
    .reduce<(number | string)[]>((acc, p, i, arr) => {
      if (i > 0 && (p as number) - (arr[i - 1] as number) > 1) acc.push('...');
      acc.push(p);
      return acc;
    }, []);

  // Renewal info for extend modal
  const renewalStart = extendTarget ? addDays(toYMD(extendTarget.expiry_date), 1) : '';
  const extendedDays = extendTarget && extendDate ? daysBetween(toYMD(extendTarget.expiry_date), extendDate) : 0;

  return (
    <div className="min-h-screen bg-gray-100 p-3">
      <div className="bg-white rounded-lg shadow p-4 w-full">

        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <div>
            <h1 className="text-lg font-semibold text-gray-800">TDL Expiry</h1>
            <p className="text-xs text-gray-400 mt-0.5">Manage TDL licences — Tally reads expiry via token API</p>
          </div>
          {canCreate('tdl') && (
            <button onClick={openCreate}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded px-4 py-2">
              <Plus size={16} /> Create
            </button>
          )}
        </div>

        {/* Search */}
        <div className="relative mb-3 max-w-sm">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text" value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search customer / TDL name / release…"
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>

        {/* Table */}
        {loading ? (
          <div className="text-center py-12 text-gray-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-12 text-gray-400">No records found.</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50 text-[11px] text-gray-500 uppercase tracking-wide">
                    <th className="py-2.5 px-3 text-left w-10 border border-gray-200">#</th>
                    <th className="py-2.5 px-3 text-left border border-gray-200">Customer Name</th>
                    <th className="py-2.5 px-3 text-left border border-gray-200">TDL Name</th>
                    <th className="py-2.5 px-3 text-left w-28 border border-gray-200">1st Activation</th>
                    <th className="py-2.5 px-3 text-right w-24 border border-gray-200">Total Amt</th>
                    <th className="py-2.5 px-3 text-right w-24 border border-gray-200">AMC Amt</th>
                    <th className="py-2.5 px-3 text-left w-28 border border-gray-200">Expiry Date</th>
                    <th className="py-2.5 px-3 text-left w-28 border border-gray-200">T-Expiry</th>
                    <th className="py-2.5 px-3 text-left w-28 border border-gray-200">Effective Expiry</th>
                    <th className="py-2.5 px-3 text-left w-20 border border-gray-200">Release</th>
                    <th className="py-2.5 px-3 text-left border border-gray-200">Token / API URL</th>
                    <th className="py-2.5 px-3 text-center w-24 border border-gray-200">Activity</th>
                    {(canEdit('tdl') || canDelete('tdl')) && (
                      <th className="py-2.5 px-3 text-center w-28 border border-gray-200">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => {
                    const expiredOriginal = isExpiredDate(toYMD(r.expiry_date));
                    const activeTexpiry = hasActiveTexpiry(r);
                    // Effective status: if texpiry is active, the TDL is still valid until texpiry
                    const effectiveExpired = activeTexpiry
                      ? isExpiredDate(toYMD(r.texpiry))
                      : expiredOriginal;

                    return (
                      <tr key={r.id} className={`hover:bg-blue-50/20 ${!r.is_active ? 'opacity-50' : ''}`}>
                        <td className="py-2 px-3 text-gray-400 tabular-nums text-xs border border-gray-200">
                          {(page - 1) * PAGE_SIZE + idx + 1}
                        </td>
                        <td className="py-2 px-3 font-medium text-gray-800 border border-gray-200">{r.customer_name}</td>
                        <td className="py-2 px-3 text-gray-700 border border-gray-200">{r.tdl_name}</td>
                        <td className="py-2 px-3 text-gray-500 tabular-nums text-xs border border-gray-200">{fmt(r.first_activation_date)}</td>
                        <td className="py-2 px-3 text-right text-gray-700 tabular-nums font-mono text-xs border border-gray-200">
                          {r.total_amount ? `₹${Number(r.total_amount).toLocaleString('en-IN')}` : '—'}
                        </td>
                        <td className="py-2 px-3 text-right text-gray-700 tabular-nums font-mono text-xs border border-gray-200">
                          {r.amc_amount ? `₹${Number(r.amc_amount).toLocaleString('en-IN')}` : '—'}
                        </td>
                        {/* Expiry Date */}
                        <td className="py-2 px-3 tabular-nums text-xs border border-gray-200">
                          {!r.expiry_date
                            ? <span className="text-gray-300">—</span>
                            : <span className={`font-semibold ${activeTexpiry ? 'text-gray-400 line-through' : expiredOriginal ? 'text-red-600' : 'text-gray-700'}`}>
                                {fmt(r.expiry_date)}
                              </span>
                          }
                        </td>
                        {/* T-Expiry */}
                        <td className="py-2 px-3 tabular-nums text-xs border border-gray-200">
                          {activeTexpiry
                            ? <span className={`font-semibold ${isExpiredDate(toYMD(r.texpiry)) ? 'text-red-600' : 'text-amber-600'}`}>
                                {fmt(r.texpiry)}
                                <span className="ml-1 text-[10px] font-normal text-gray-400">+{daysBetween(toYMD(r.expiry_date), toYMD(r.texpiry))}d</span>
                              </span>
                            : <span className="text-gray-300">—</span>
                          }
                        </td>
                        {/* Effective Expiry */}
                        <td className="py-2 px-3 tabular-nums text-xs border border-gray-200">
                          {!r.expiry_date
                            ? <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">Pending</span>
                            : <span className={`font-semibold px-2 py-0.5 rounded-full ${effectiveExpired ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700'}`}>
                                {activeTexpiry ? fmt(r.texpiry) : fmt(r.expiry_date)}
                              </span>
                          }
                        </td>
                        <td className="py-2 px-3 text-gray-500 font-mono text-xs border border-gray-200">{r.release_version || '—'}</td>
                        <td className="py-2 px-3 border border-gray-200">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[10px] text-gray-400 truncate max-w-[100px]" title={r.token}>
                              {r.token.slice(0, 12)}…
                            </span>
                            <button onClick={() => copyToken(r)} title="Copy API URL"
                              className="text-gray-400 hover:text-blue-600 transition-colors p-0.5 shrink-0">
                              {copiedId === r.id ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                            </button>
                            <a href={tdlExpiryApi.publicCheckUrl(r.token)} target="_blank" rel="noreferrer"
                              title="Open API URL" className="text-gray-400 hover:text-blue-600 transition-colors p-0.5 shrink-0">
                              <ExternalLink size={12} />
                            </a>
                          </div>
                        </td>
                        <td className="py-2 px-3 text-center border border-gray-200" onClick={e => e.stopPropagation()}>
                          <button onClick={() => openGenActivity(r)}
                            title={!r.expiry_date ? 'Generate first billing activity' : 'Generate renewal activity'}
                            className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 whitespace-nowrap mx-auto">
                            <Zap size={11} />
                            {!r.expiry_date ? 'Activate' : 'Renew'}
                          </button>
                        </td>
                        {(canEdit('tdl') || canDelete('tdl')) && (
                          <td className="py-2 px-3 text-center border border-gray-200" onClick={e => e.stopPropagation()}>
                            <div className="flex justify-center gap-1.5">
                              {canEdit('tdl') && canShowExtend(r) && (
                                <button
                                  onClick={() => openExtend(r)}
                                  title={activeTexpiry ? 'Edit/Clear Extension' : 'Extend Expiry'}
                                  className={`p-1 ${activeTexpiry ? 'text-amber-500 hover:text-amber-700' : 'text-orange-400 hover:text-orange-600'}`}>
                                  <Clock size={14} />
                                </button>
                              )}
                              {canEdit('tdl') && (
                                <button
                                  onClick={() => handleToggleActive(r)}
                                  disabled={togglingId === r.id}
                                  title={r.is_active ? 'Deactivate token' : 'Activate token'}
                                  className={`text-xs font-semibold px-2 py-0.5 rounded-full border transition-colors ${
                                    r.is_active
                                      ? 'bg-green-50 text-green-700 border-green-200 hover:bg-red-50 hover:text-red-600 hover:border-red-200'
                                      : 'bg-red-50 text-red-600 border-red-200 hover:bg-green-50 hover:text-green-700 hover:border-green-200'
                                  } disabled:opacity-40`}>
                                  {togglingId === r.id ? '…' : r.is_active ? 'Active' : 'Inactive'}
                                </button>
                              )}
                              {canEdit('tdl') && (
                                <button onClick={() => openEdit(r)} title="Edit"
                                  className="text-blue-500 hover:text-blue-700 p-1"><Pencil size={14} /></button>
                              )}
                              {canDelete('tdl') && (
                                <button onClick={() => setDeleteTarget(r)} title="Delete"
                                  className="text-red-400 hover:text-red-600 p-1"><Trash2 size={14} /></button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-3 text-sm text-gray-500">
                <span>{total} record{total !== 1 ? 's' : ''} · Page {page} of {totalPages}</span>
                <div className="flex gap-1">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                    className="px-3 py-1 border border-gray-300 rounded disabled:opacity-40 hover:bg-gray-50">Prev</button>
                  {pageNums.map((p, i) => typeof p === 'string'
                    ? <span key={i} className="px-2 py-1 text-gray-400">…</span>
                    : <button key={p} onClick={() => setPage(p)}
                        className={`px-3 py-1 border rounded ${p === page ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 hover:bg-gray-50'}`}>{p}</button>
                  )}
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                    className="px-3 py-1 border border-gray-300 rounded disabled:opacity-40 hover:bg-gray-50">Next</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={closeModal}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">{editing ? 'Edit TDL Expiry' : 'Create TDL Expiry'}</h3>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-3">

              {/* Renewal banner — shown when editing a record that has active texpiry */}
              {editing && hasActiveTexpiry(editing) && (
                <div className="flex gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <Info size={15} className="text-amber-600 shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-800">
                    <p className="font-semibold mb-0.5">TExpiry active — {fmt(editing.texpiry)} (+{daysBetween(toYMD(editing.expiry_date), toYMD(editing.texpiry))} {daysBetween(toYMD(editing.expiry_date), toYMD(editing.texpiry)) === 1 ? 'day' : 'days'})</p>
                    <p>On renewal, set new Expiry Date starting from <strong>{fmt(addDays(toYMD(editing.expiry_date), 1))}</strong> — the extended days are credited to the new period.</p>
                  </div>
                </div>
              )}

              <div className="relative">
                <label className="block text-xs font-medium text-gray-500 mb-0.5">Customer Name *</label>
                {editing ? (
                  <input type="text" value={form.customer_name}
                    onChange={e => setForm(f => ({ ...f, customer_name: e.target.value }))}
                    className="w-full border border-gray-300 rounded text-sm py-1.5 px-2.5 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                ) : (
                  <>
                    <div className="relative">
                      <input
                        type="text"
                        autoFocus
                        value={custSearch}
                        onChange={e => {
                          setCustSearch(e.target.value);
                          setForm(f => ({ ...f, customer_name: e.target.value }));
                          setCustHighlight(-1);
                          setShowCustDrop(false);
                        }}
                        onFocus={() => { if (custResults.length > 0) setShowCustDrop(true); }}
                        onKeyDown={e => {
                          if (!showCustDrop || custResults.length === 0) return;
                          if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            setCustHighlight(h => Math.min(h + 1, custResults.length - 1));
                          } else if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            setCustHighlight(h => Math.max(h - 1, 0));
                          } else if (e.key === 'Enter' && custHighlight >= 0) {
                            e.preventDefault();
                            const c = custResults[custHighlight];
                            setForm(f => ({ ...f, customer_name: c.company }));
                            setCustSearch(c.company);
                            setShowCustDrop(false);
                            setCustHighlight(-1);
                          } else if (e.key === 'Escape') {
                            setShowCustDrop(false);
                            setCustHighlight(-1);
                          }
                        }}
                        placeholder="Search customer..."
                        className="w-full border border-gray-300 rounded text-sm py-1.5 px-2.5 pr-8 focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                      {custSearching && (
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">…</span>
                      )}
                      {!custSearching && form.customer_name && (
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-green-500 text-xs">✓</span>
                      )}
                    </div>
                    {showCustDrop && (
                      <ul className="absolute z-50 left-0 right-0 mt-0.5 bg-white border border-gray-200 rounded shadow-lg max-h-48 overflow-y-auto text-sm">
                        {custResults.map((c, i) => (
                          <li
                            key={c.id}
                            onMouseDown={e => e.preventDefault()}
                            onMouseEnter={() => setCustHighlight(i)}
                            onClick={() => {
                              setForm(f => ({ ...f, customer_name: c.company }));
                              setCustSearch(c.company);
                              setShowCustDrop(false);
                              setCustHighlight(-1);
                            }}
                            className={`px-3 py-2 cursor-pointer text-gray-800 ${i === custHighlight ? 'bg-blue-100' : 'hover:bg-blue-50'}`}
                          >
                            {c.company}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-0.5">TDL Name *</label>
                <input type="text" value={form.tdl_name}
                  onChange={e => setForm(f => ({ ...f, tdl_name: e.target.value }))}
                  placeholder="e.g. GST Auto-Fill v3"
                  className="w-full border border-gray-300 rounded text-sm py-1.5 px-2.5 focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-0.5">1st Activation Date</label>
                <div className="relative">
                  <div className="w-full border border-gray-300 rounded text-sm py-1.5 px-2.5 bg-white text-gray-800">
                    {form.first_activation_date ? fmt(form.first_activation_date) : <span className="text-gray-400">DD/MM/YYYY</span>}
                  </div>
                  <input type="date" value={form.first_activation_date}
                    onChange={e => setForm(f => ({ ...f, first_activation_date: e.target.value }))}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                </div>
              </div>
              {/* Expiry date — only shown when editing (set via Billing Activity on create) */}
              {editing && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-0.5">
                    Expiry Date
                    <span className="ml-1.5 text-blue-500 font-normal">(auto-set by Billing Activity)</span>
                  </label>
                  <div className="relative">
                    <div className="w-full border border-gray-300 rounded text-sm py-1.5 px-2.5 bg-white text-gray-800">
                      {form.expiry_date ? fmt(form.expiry_date) : <span className="text-gray-400">DD/MM/YYYY</span>}
                    </div>
                    <input type="date" value={form.expiry_date}
                      onChange={e => setForm(f => ({ ...f, expiry_date: e.target.value }))}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                  </div>
                </div>
              )}
              {!editing && (
                <div className="flex items-center gap-2 text-xs text-blue-600 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                  <Info size={13} className="shrink-0" />
                  Expiry date will be set automatically when you create a Billing Activity for this TDL.
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-0.5">Total Amount (₹)</label>
                  <input type="number" value={form.total_amount} min={0} step={0.01}
                    onChange={e => setForm(f => ({ ...f, total_amount: e.target.value }))}
                    placeholder="0.00"
                    className="w-full border border-gray-300 rounded text-sm py-1.5 px-2.5 focus:outline-none focus:ring-1 focus:ring-blue-400 font-mono" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-0.5">AMC Amount (₹)</label>
                  <input type="number" value={form.amc_amount} min={0} step={0.01}
                    onChange={e => setForm(f => ({ ...f, amc_amount: e.target.value }))}
                    placeholder="0.00"
                    className="w-full border border-gray-300 rounded text-sm py-1.5 px-2.5 focus:outline-none focus:ring-1 focus:ring-blue-400 font-mono" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Billing Cycle</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {(['monthly', 'quarterly', 'half_yearly', 'yearly'] as BillingCycle[]).map(c => (
                    <button key={c} type="button" onClick={() => setForm(f => ({ ...f, billing_cycle: c }))}
                      className={`py-1.5 rounded text-xs font-semibold border transition-colors ${form.billing_cycle === c ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:border-blue-300'}`}>
                      {CYCLE_LABELS[c]}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-0.5">Release</label>
                <input type="text" value={form.release_version}
                  onChange={e => setForm(f => ({ ...f, release_version: e.target.value }))}
                  placeholder="e.g. 6.6.3 or v2.1"
                  className="w-full border border-gray-300 rounded text-sm py-1.5 px-2.5 focus:outline-none focus:ring-1 focus:ring-blue-400 font-mono" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-0.5">Remark</label>
                <input type="text" value={form.remark}
                  onChange={e => setForm(f => ({ ...f, remark: e.target.value }))}
                  placeholder="Optional notes"
                  className="w-full border border-gray-300 rounded text-sm py-1.5 px-2.5 focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </div>
              {editing && (
                <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
                  <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Token / API URL</p>
                  <code className="text-[11px] text-blue-700 break-all">{tdlExpiryApi.publicCheckUrl(editing.token)}</code>
                  <p className="text-[10px] text-gray-400 mt-1">Configure this URL in Tally TDL to auto-fetch expiry. Token is permanent.</p>
                </div>
              )}
            </div>
            <div className="flex gap-2 px-5 pb-5">
              <button onClick={closeModal}
                className="flex-1 border border-gray-300 hover:bg-gray-50 text-gray-600 text-sm font-medium rounded-lg py-2">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium rounded-lg py-2">
                {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Extend Modal */}
      {extendTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={closeExtend}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center px-5 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Clock size={16} className="text-amber-500" />
                <h3 className="font-semibold text-gray-800">Extend TDL Validity</h3>
              </div>
              <button onClick={closeExtend} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>

            <div className="p-5 space-y-4">
              {/* Record info */}
              <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-500">Customer</span>
                  <span className="font-medium text-gray-800">{extendTarget.customer_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">TDL</span>
                  <span className="font-medium text-gray-700">{extendTarget.tdl_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Original Expiry</span>
                  <span className={`font-semibold ${isExpiredDate(toYMD(extendTarget.expiry_date)) ? 'text-red-600' : 'text-green-700'}`}>
                    {fmt(extendTarget.expiry_date)}
                  </span>
                </div>
                {hasActiveTexpiry(extendTarget) && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Current TExpiry</span>
                    <span className="font-semibold text-amber-700">{fmt(extendTarget.texpiry)}</span>
                  </div>
                )}
              </div>

              {/* TExpiry date picker */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Temporary Extension Date
                </label>
                <div className="relative">
                  <div className="w-full border border-gray-300 rounded text-sm py-1.5 px-2.5 bg-white text-gray-800">
                    {extendDate ? fmt(extendDate) : <span className="text-gray-400">DD/MM/YYYY</span>}
                  </div>
                  <input
                    type="date"
                    value={extendDate}
                    min={addDays(toYMD(extendTarget.expiry_date), 1)}
                    onChange={e => setExtendDate(e.target.value)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                </div>
                <p className="text-[11px] text-gray-400 mt-1">Must be after the original expiry date.</p>
              </div>

              {/* Live calculation */}
              {extendDate && extendDate > toYMD(extendTarget.expiry_date) && (
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 space-y-2 text-xs">
                  <div className="flex items-center gap-1.5 text-blue-700 font-semibold">
                    <Info size={13} />
                    Renewal Calculation
                  </div>
                  <div className="space-y-1 text-gray-700">
                    <div className="flex justify-between">
                      <span>Extended by</span>
                      <span className="font-semibold text-amber-700">+{extendedDays} day{extendedDays !== 1 ? 's' : ''}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Valid until</span>
                      <span className="font-semibold">{fmt(extendDate)}</span>
                    </div>
                    <div className="border-t border-blue-100 pt-2 mt-2">
                      <p className="text-gray-600 leading-relaxed">
                        On renewal, new activation starts from{' '}
                        <strong className="text-blue-800">{fmt(renewalStart)}</strong>{' '}
                        (day after original expiry). The {extendedDays} extended day{extendedDays !== 1 ? 's' : ''} are credited — no loss.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-2 px-5 pb-5">
              {hasActiveTexpiry(extendTarget) && (
                <button
                  onClick={handleClearTexpiry}
                  disabled={extendSaving}
                  className="px-3 py-2 text-sm text-red-500 border border-red-200 hover:bg-red-50 rounded-lg disabled:opacity-40">
                  Clear
                </button>
              )}
              <button onClick={closeExtend}
                className="flex-1 border border-gray-300 hover:bg-gray-50 text-gray-600 text-sm font-medium rounded-lg py-2">
                Cancel
              </button>
              <button
                onClick={handleExtend}
                disabled={extendSaving || !extendDate}
                className="flex-1 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white text-sm font-medium rounded-lg py-2">
                {extendSaving ? 'Saving…' : 'Save Extension'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Generate Activity Modal */}
      {genRow && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setGenRow(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center px-5 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Zap size={16} className="text-indigo-600" />
                <h3 className="font-semibold text-gray-800">Generate Billing Activity</h3>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${genType === 'new' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                  {genType === 'new' ? 'NEW' : 'RENEWAL'}
                </span>
              </div>
              <button onClick={() => setGenRow(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>

            <div className="p-5 space-y-4">
              {/* Customer / TDL info */}
              <div className="bg-gray-50 rounded-lg px-4 py-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-500">Customer</span>
                  <span className="font-semibold text-gray-800">{genRow.customer_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">TDL</span>
                  <span className="font-medium text-gray-700">{genRow.tdl_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">AMC Amount</span>
                  <span className="font-mono text-gray-700">₹{Number(genRow.amc_amount).toLocaleString('en-IN')}</span>
                </div>
              </div>

              {/* Cycle */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Billing Cycle</label>
                {genType === 'new' ? (
                  <div className="text-sm font-semibold text-gray-700 bg-gray-100 rounded px-3 py-2">
                    Yearly <span className="text-xs font-normal text-gray-400 ml-1">(fixed for new activations)</span>
                  </div>
                ) : (
                  <div className="grid grid-cols-4 gap-1.5">
                    {(['monthly', 'quarterly', 'half_yearly', 'yearly'] as BillingCycle[]).map(c => (
                      <button key={c} onClick={() => handleGenCycleChange(c)}
                        className={`py-1.5 rounded text-xs font-semibold border transition-colors ${genForm.cycle === c ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-300'}`}>
                        {CYCLE_LABELS[c]}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Start Date → Expiry */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-0.5">Start Date *</label>
                  <div className="relative">
                    <div className="w-full border border-gray-300 rounded text-sm py-1.5 px-2.5 bg-white">
                      {genForm.start_date ? fmt(genForm.start_date) : <span className="text-gray-400">Pick date</span>}
                    </div>
                    <input type="date" value={genForm.start_date}
                      onChange={e => setGenForm(f => ({ ...f, start_date: e.target.value }))}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-0.5">Expiry Date</label>
                  <div className="w-full border border-gray-200 rounded text-sm py-1.5 px-2.5 bg-gray-50 text-gray-700 font-semibold">
                    {genForm.start_date ? fmt(calcExpiry(genForm.start_date, genForm.cycle)) : <span className="text-gray-300 font-normal">—</span>}
                  </div>
                </div>
              </div>

              {/* Total Amount */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-0.5">
                  Total Amount (₹)
                  {genType === 'renew' && Number(genRow.amc_amount) > 0 && (
                    <span className="ml-1.5 text-gray-400 font-normal">
                      = ₹{genRow.amc_amount}/12 × {CYCLE_MONTHS[genForm.cycle]}m
                    </span>
                  )}
                </label>
                <input type="number" min={0} step={0.01}
                  value={genForm.total_amount}
                  onChange={e => setGenForm(f => ({ ...f, total_amount: e.target.value }))}
                  className="w-full border border-gray-300 rounded text-sm py-1.5 px-2.5 focus:outline-none focus:ring-1 focus:ring-indigo-400 font-mono" />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-0.5">Notes / Remark</label>
                <input type="text" value={genForm.notes}
                  onChange={e => setGenForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="Optional"
                  className="w-full border border-gray-300 rounded text-sm py-1.5 px-2.5 focus:outline-none focus:ring-1 focus:ring-indigo-400" />
              </div>
            </div>

            <div className="flex gap-2 px-5 pb-5">
              <button onClick={() => setGenRow(null)}
                className="flex-1 border border-gray-300 hover:bg-gray-50 text-gray-600 text-sm font-medium rounded-lg py-2">
                Cancel
              </button>
              <button onClick={handleGenSubmit} disabled={genSaving || !genForm.start_date}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-sm font-medium rounded-lg py-2">
                {genSaving ? 'Saving…' : `Create ${genType === 'new' ? 'Activation' : 'Renewal'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setDeleteTarget(null)}>
          <div className="bg-white rounded-xl shadow-2xl p-5 w-[400px]" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-800 mb-2">Delete Record</h3>
            <p className="text-sm text-gray-600 mb-4">
              Delete TDL expiry for <strong>{deleteTarget.customer_name}</strong> ({deleteTarget.tdl_name})?
              <br />
              <span className="text-[11px] text-red-500 mt-1 inline-block">
                Tally integrations using this token will stop working immediately.
              </span>
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteTarget(null)}
                className="px-4 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={handleDelete} disabled={deleting}
                className="px-4 py-1.5 text-sm text-white bg-red-500 hover:bg-red-600 disabled:bg-red-300 rounded-lg">
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TdlExpiry;
