import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Search, X, CheckCircle, Trash2, Pencil } from 'lucide-react';
import { tdlBillingApi } from '../services/api';
import { useToast } from '../components/Toast/Toast';
import { useAuth } from '../context/AuthContext';

interface BillingRow {
  id: number;
  tdl_expiry_id: number;
  customer_name: string;
  tdl_name: string;
  type: 'new' | 'renew';
  cycle: string;
  amc_amount: number;
  total_amount: number;
  start_date: string;
  expiry_date: string;
  notes: string | null;
  created_at: string;
}

interface CustomerOption { customer_name: string; tdl_count: number }
interface TdlOption {
  id: number;
  tdl_name: string;
  expiry_date: string | null;
  billing_count: number;
  last_billing_expiry: string | null;
}

const CYCLES = [
  { value: 'monthly',     label: 'Monthly',     months: 1  },
  { value: 'quarterly',   label: 'Quarterly',   months: 3  },
  { value: 'half_yearly', label: 'Half Yearly', months: 6  },
  { value: 'yearly',      label: 'Yearly',      months: 12 },
] as const;

const PAGE_SIZE = 25;

const toYMD = (d: string | null) => (d ? d.split('T')[0] : '');
const fmt = (d: string | null) => {
  if (!d) return '—';
  const [y, m, day] = d.split('T')[0].split('-');
  return `${day}/${m}/${y}`;
};
const calcExpiry = (startDate: string, cycle: string) => {
  const d = new Date(startDate);
  switch (cycle) {
    case 'monthly':     d.setMonth(d.getMonth() + 1); break;
    case 'quarterly':   d.setMonth(d.getMonth() + 3); break;
    case 'half_yearly': d.setMonth(d.getMonth() + 6); break;
    case 'yearly':      d.setFullYear(d.getFullYear() + 1); break;
  }
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
};

const CYCLE_LABEL: Record<string, string> = {
  monthly: 'Monthly', quarterly: 'Quarterly',
  half_yearly: 'Half Yearly', yearly: 'Yearly',
};

const CYCLE_MONTHS: Record<string, number> = {
  monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12,
};

// AMC = Annual Maintenance Charge → pro-rate by cycle
const autoTotal = (amc: string, cycle: string) => {
  const a = parseFloat(amc);
  if (!a || !cycle || !CYCLE_MONTHS[cycle]) return '';
  return (a * CYCLE_MONTHS[cycle] / 12).toFixed(2);
};

const TdlBilling: React.FC = () => {
  const { showSuccess, showError } = useToast();
  const { canCreate, canView } = useAuth();

  // Table state
  const [rows, setRows] = useState<BillingRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BillingRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Edit modal
  const [editTarget, setEditTarget] = useState<BillingRow | null>(null);
  const [editForm, setEditForm] = useState({ cycle: '', start_date: '', amc_amount: '', total_amount: '', notes: '' });
  const [editExpiry, setEditExpiry] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  // Step 1 — customer
  const [customerSearch, setCustomerSearch] = useState('');
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [showCustomerDrop, setShowCustomerDrop] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState('');

  // Step 2 — TDL
  const [tdls, setTdls] = useState<TdlOption[]>([]);
  const [tdlsLoading, setTdlsLoading] = useState(false);
  const [selectedTdlId, setSelectedTdlId] = useState<number | null>(null);
  const selectedTdl = tdls.find(t => t.id === selectedTdlId) ?? null;

  // Step 3 — cycle + calculated dates
  const [cycle, setCycle] = useState('');
  const [prepareType, setPrepareType] = useState<'new' | 'renew' | null>(null);
  const [autoStartDate, setAutoStartDate] = useState('');
  const [startDateOverride, setStartDateOverride] = useState('');
  const [lastExpiry, setLastExpiry] = useState<string | null>(null);
  const [prepareLoading, setPrepareLoading] = useState(false);

  // Step 4 — amounts
  const [amcAmount, setAmcAmount] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [notes, setNotes] = useState('');

  const customerInputRef = useRef<HTMLInputElement>(null);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Derived: effective start date and expiry
  const effectiveStart = startDateOverride || autoStartDate;
  const effectiveExpiry = effectiveStart && cycle ? calcExpiry(effectiveStart, cycle) : '';

  // ── Fetch table data ────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await tdlBillingApi.getAll(page, PAGE_SIZE, search);
      if (res.success) { setRows(res.data || []); setTotal(res.total || 0); }
    } catch (e: any) {
      showError('Error', e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [page, search, showError]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Customer search ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!showModal) return;
    tdlBillingApi.getCustomers(customerSearch).then(res => {
      if (res.success) setCustomers(res.data || []);
    }).catch(() => {});
  }, [customerSearch, showModal]);

  // ── TDLs for selected customer ──────────────────────────────────────────────
  useEffect(() => {
    if (!selectedCustomer) { setTdls([]); setSelectedTdlId(null); return; }
    setTdlsLoading(true);
    tdlBillingApi.getTdlsByCustomer(selectedCustomer).then(res => {
      if (res.success) setTdls(res.data || []);
    }).catch(() => {}).finally(() => setTdlsLoading(false));
  }, [selectedCustomer]);

  // ── Prepare (type + start date) when TDL selected ─────────────────────────
  useEffect(() => {
    if (!selectedTdlId) { setPrepareType(null); setAutoStartDate(''); setLastExpiry(null); return; }
    setPrepareLoading(true);
    tdlBillingApi.prepare(selectedTdlId, 'yearly').then(res => {
      if (res.success) {
        setPrepareType(res.type);
        setAutoStartDate(res.start_date);
        setLastExpiry(res.last_expiry);
        setStartDateOverride('');
      }
    }).catch(() => {}).finally(() => setPrepareLoading(false));
  }, [selectedTdlId]);

  // ── Modal open/close ────────────────────────────────────────────────────────
  const openModal = () => {
    setCustomerSearch(''); setSelectedCustomer(''); setCustomers([]);
    setTdls([]); setSelectedTdlId(null);
    setCycle(''); setPrepareType(null); setAutoStartDate(''); setStartDateOverride(''); setLastExpiry(null);
    setAmcAmount(''); setTotalAmount(''); setNotes('');
    setShowModal(true);
    setTimeout(() => customerInputRef.current?.focus(), 100);
  };
  const closeModal = () => setShowModal(false);

  const selectCustomer = (name: string) => {
    setSelectedCustomer(name);
    setCustomerSearch(name);
    setShowCustomerDrop(false);
    setSelectedTdlId(null);
    setCycle('');
  };

  // ── Save ────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!selectedCustomer) { showError('Validation', 'Select a customer'); return; }
    if (!selectedTdlId || !selectedTdl) { showError('Validation', 'Select a TDL'); return; }
    if (!cycle) { showError('Validation', 'Select a billing cycle'); return; }
    if (!effectiveStart) { showError('Validation', 'Start date is required'); return; }

    setSaving(true);
    try {
      const payload = {
        tdl_expiry_id: selectedTdlId,
        customer_name: selectedCustomer,
        tdl_name: selectedTdl.tdl_name,
        cycle,
        amc_amount: amcAmount ? parseFloat(amcAmount) : 0,
        total_amount: totalAmount ? parseFloat(totalAmount) : 0,
        start_date: startDateOverride || undefined,
        notes: notes.trim() || undefined,
      };
      const res = await tdlBillingApi.create(payload);
      if (res.success) {
        showSuccess('Created', 'Billing activity recorded and expiry updated');
        closeModal();
        fetchData();
      } else {
        showError('Error', res.message || 'Failed to create');
      }
    } catch (e: any) {
      showError('Error', e?.message || 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (r: BillingRow) => {
    setEditTarget(r);
    const f = {
      cycle: r.cycle,
      start_date: toYMD(r.start_date),
      amc_amount: String(r.amc_amount ?? ''),
      total_amount: String(r.total_amount ?? ''),
      notes: r.notes || '',
    };
    setEditForm(f);
    setEditExpiry(calcExpiry(toYMD(r.start_date), r.cycle));
  };

  const handleEditFormChange = (patch: Partial<typeof editForm>) => {
    setEditForm(prev => {
      const next = { ...prev, ...patch };
      if (next.cycle && next.start_date) setEditExpiry(calcExpiry(next.start_date, next.cycle));
      if ('amc_amount' in patch || 'cycle' in patch) {
        const t = autoTotal(next.amc_amount, next.cycle);
        if (t) next.total_amount = t;
      }
      return next;
    });
  };

  const handleEditSave = async () => {
    if (!editTarget) return;
    setEditSaving(true);
    try {
      const res = await tdlBillingApi.update(editTarget.id, {
        cycle: editForm.cycle,
        start_date: editForm.start_date,
        amc_amount: editForm.amc_amount ? parseFloat(editForm.amc_amount) : 0,
        total_amount: editForm.total_amount ? parseFloat(editForm.total_amount) : 0,
        notes: editForm.notes || undefined,
      });
      if (res.success) {
        showSuccess('Updated', 'Billing activity updated');
        setEditTarget(null);
        fetchData();
      } else showError('Error', res.message || 'Update failed');
    } catch (e: any) {
      showError('Error', e?.message || 'Failed');
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await tdlBillingApi.delete(deleteTarget.id);
      if (res.success) {
        showSuccess('Deleted', 'Billing activity removed');
        setDeleteTarget(null);
        fetchData();
      } else showError('Error', res.message || 'Delete failed');
    } catch (e: any) {
      showError('Error', e?.message || 'Failed to delete');
    } finally {
      setDeleting(false);
    }
  };

  const pageNums = Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
    .reduce<(number | string)[]>((acc, p, i, arr) => {
      if (i > 0 && (p as number) - (arr[i - 1] as number) > 1) acc.push('...');
      acc.push(p);
      return acc;
    }, []);

  return (
    <div className="min-h-screen bg-gray-100 p-3">
      <div className="bg-white rounded-lg shadow p-4 w-full">

        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <div>
            <h1 className="text-lg font-semibold text-gray-800">TDL Billing Activity</h1>
            <p className="text-xs text-gray-400 mt-0.5">Track renewal cycles — expiry auto-syncs to TDL record</p>
          </div>
          {canCreate('tdl') && (
            <button onClick={openModal}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded px-4 py-2">
              <Plus size={16} /> Create Activity
            </button>
          )}
        </div>

        {/* Search */}
        <div className="relative mb-3 max-w-sm">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text" value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search customer / TDL name…"
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>

        {/* Table */}
        {loading ? (
          <div className="text-center py-12 text-gray-400">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-12 text-gray-400">No billing activities yet.</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-[11px] text-gray-500 uppercase tracking-wide">
                    <th className="py-2.5 px-3 text-left w-10">#</th>
                    <th className="py-2.5 px-3 text-left">Customer</th>
                    <th className="py-2.5 px-3 text-left">TDL Name</th>
                    <th className="py-2.5 px-3 text-left w-20">Type</th>
                    <th className="py-2.5 px-3 text-left w-24">Cycle</th>
                    <th className="py-2.5 px-3 text-right w-28">AMC</th>
                    <th className="py-2.5 px-3 text-left w-28">Start Date</th>
                    <th className="py-2.5 px-3 text-left w-28">Expiry Date</th>
                    <th className="py-2.5 px-3 text-right w-28">Total</th>
                    <th className="py-2.5 px-3 text-left w-32">Created</th>
                    <th className="py-2.5 px-3 text-center w-16"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50/80">
                      <td className="py-2.5 px-3 text-gray-400 tabular-nums">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                      <td className="py-2.5 px-3 font-medium text-gray-800">{r.customer_name}</td>
                      <td className="py-2.5 px-3 text-gray-700">{r.tdl_name}</td>
                      <td className="py-2.5 px-3 text-xs font-medium text-gray-500">
                        {r.type === 'new' ? 'New' : 'Renew'}
                      </td>
                      <td className="py-2.5 px-3 text-gray-600">{CYCLE_LABEL[r.cycle] || r.cycle}</td>
                      <td className="py-2.5 px-3 text-right text-gray-700 font-mono text-xs">
                        {r.amc_amount ? `₹${Number(r.amc_amount).toLocaleString('en-IN')}` : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-gray-600 tabular-nums">{fmt(r.start_date)}</td>
                      <td className={`py-2.5 px-3 tabular-nums text-sm font-medium ${
                        toYMD(r.expiry_date) < new Date().toISOString().split('T')[0]
                          ? 'text-red-500' : 'text-gray-700'
                      }`}>
                        {fmt(r.expiry_date)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-gray-700 font-mono text-xs">
                        {r.total_amount ? `₹${Number(r.total_amount).toLocaleString('en-IN')}` : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-gray-400 text-xs tabular-nums">
                        {new Date(r.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <div className="flex justify-center gap-1">
                          <button onClick={() => openEdit(r)} title="Edit"
                            className="text-blue-400 hover:text-blue-600 p-1 transition-colors">
                            <Pencil size={14} />
                          </button>
                          <button onClick={() => setDeleteTarget(r)} title="Delete"
                            className="text-red-400 hover:text-red-600 p-1 transition-colors">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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

      {/* ── Edit Modal ── */}
      {editTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setEditTarget(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center px-6 py-4 border-b border-gray-100">
              <div>
                <h3 className="font-semibold text-gray-800">Edit Billing Activity</h3>
                <p className="text-xs text-gray-400 mt-0.5">{editTarget.customer_name} — {editTarget.tdl_name}</p>
              </div>
              <button onClick={() => setEditTarget(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>

            <div className="p-6 space-y-4">
              {/* Type badge + period summary */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold px-3 py-1 rounded-full ${
                    editTarget.type === 'new' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'
                  }`}>
                    {editTarget.type === 'new' ? '✦ NEW ACTIVATION' : '↻ RENEWAL'}
                  </span>
                </div>
                {/* Live period preview */}
                <div className={`text-xs px-3 py-1.5 rounded-lg font-mono ${
                  editExpiry && editForm.start_date
                    ? 'bg-blue-50 text-blue-700'
                    : 'bg-gray-50 text-gray-400'
                }`}>
                  {editForm.start_date && editExpiry
                    ? <>{fmt(editForm.start_date)} <span className="text-gray-400 mx-1">→</span> {fmt(editExpiry)} <span className="text-gray-400 ml-1">({CYCLE_LABEL[editForm.cycle] || editForm.cycle})</span></>
                    : 'Select cycle & start date'
                  }
                </div>
              </div>

              {/* Cycle */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Billing Cycle</label>
                <div className="grid grid-cols-4 gap-2">
                  {CYCLES.map(c => (
                    <button key={c.value} onClick={() => handleEditFormChange({ cycle: c.value })}
                      className={`py-2 text-sm font-semibold rounded-lg border-2 transition-all ${
                        editForm.cycle === c.value
                          ? 'border-blue-500 bg-blue-600 text-white'
                          : 'border-gray-200 text-gray-600 hover:border-blue-300'
                      }`}>
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1.5">Start Date</label>
                  <div className="relative">
                    <div className="w-full border-2 border-gray-200 rounded-lg text-sm py-2 px-3 bg-white text-gray-800">
                      {editForm.start_date ? fmt(editForm.start_date) : <span className="text-gray-400">DD/MM/YYYY</span>}
                    </div>
                    <input type="date" value={editForm.start_date}
                      onChange={e => handleEditFormChange({ start_date: e.target.value })}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1.5">
                    Expiry Date <span className="text-gray-400 font-normal">(calculated)</span>
                  </label>
                  <div className="w-full border-2 border-green-200 bg-green-50 rounded-lg text-sm py-2 px-3 font-mono font-bold text-green-800 tabular-nums">
                    {editExpiry ? fmt(editExpiry) : '—'}
                  </div>
                </div>
              </div>

              {/* Amounts */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1.5">AMC Amount (₹)</label>
                  <input type="number" value={editForm.amc_amount} min={0} step={0.01}
                    onChange={e => handleEditFormChange({ amc_amount: e.target.value })}
                    placeholder="0.00"
                    className="w-full border-2 border-gray-200 rounded-lg text-sm py-2 px-3 focus:outline-none focus:border-blue-400 font-mono" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1.5">Total Amount (₹)</label>
                  <input type="number" value={editForm.total_amount} min={0} step={0.01}
                    onChange={e => handleEditFormChange({ total_amount: e.target.value })}
                    placeholder="0.00"
                    className="w-full border-2 border-gray-200 rounded-lg text-sm py-2 px-3 focus:outline-none focus:border-blue-400 font-mono" />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1.5">Notes</label>
                <input type="text" value={editForm.notes}
                  onChange={e => handleEditFormChange({ notes: e.target.value })}
                  placeholder="e.g. Paid by cheque, invoice #123…"
                  className="w-full border-2 border-gray-200 rounded-lg text-sm py-2 px-3 focus:outline-none focus:border-blue-400" />
              </div>
            </div>

            <div className="flex gap-2 px-6 pb-5">
              <button onClick={() => setEditTarget(null)}
                className="flex-1 border-2 border-gray-200 hover:bg-gray-50 text-gray-600 text-sm font-semibold rounded-lg py-2">
                Cancel
              </button>
              <button onClick={handleEditSave} disabled={editSaving}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-semibold rounded-lg py-2">
                {editSaving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirm ── */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setDeleteTarget(null)}>
          <div className="bg-white rounded-xl shadow-2xl p-5 w-[420px]" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-800 mb-1">Delete Billing Activity</h3>
            <p className="text-sm text-gray-600 mb-1">
              Remove this record for <strong>{deleteTarget.customer_name}</strong> — <strong>{deleteTarget.tdl_name}</strong>?
            </p>
            <p className="text-xs text-gray-500 mb-1">
              Period: {fmt(deleteTarget.start_date)} → {fmt(deleteTarget.expiry_date)} ({CYCLE_LABEL[deleteTarget.cycle]})
            </p>
            <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-100 rounded px-3 py-2 mt-3 mb-4">
              The TDL expiry date will be rolled back to the previous billing record (or cleared if this is the only one).
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

      {/* ── Create Modal ── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={closeModal}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl" onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="flex justify-between items-center px-6 py-4 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <h3 className="font-semibold text-gray-800">New Billing Activity</h3>
                {prepareType && !prepareLoading && (
                  <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                    prepareType === 'new' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                  }`}>
                    {prepareType === 'new' ? '✦ NEW ACTIVATION' : '↻ RENEWAL'}
                  </span>
                )}
                {prepareType === 'renew' && lastExpiry && !prepareLoading && (
                  <span className="text-xs text-gray-400">prev. expiry: <strong className="text-gray-600">{fmt(lastExpiry)}</strong></span>
                )}
              </div>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>

            {/* Form body */}
            <div className="p-6 space-y-4">

              {/* Row 1: Customer | TDL | Start Date */}
              <div className="grid grid-cols-3 gap-4">

                {/* Customer Name */}
                <div className="relative">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Customer Name *</label>
                  <div className="relative">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    <input
                      ref={customerInputRef}
                      type="text"
                      value={customerSearch}
                      onChange={e => { setCustomerSearch(e.target.value); setShowCustomerDrop(true); }}
                      onFocus={() => { if (customers.length > 0) setShowCustomerDrop(true); }}
                      placeholder="Search customer…"
                      className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow"
                    />
                  </div>
                  {showCustomerDrop && customers.length > 0 && (
                    <ul className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-100 rounded-xl shadow-xl overflow-hidden max-h-52 overflow-y-auto">
                      {customers
                        .filter(c => c.customer_name.toLowerCase().includes(customerSearch.toLowerCase()))
                        .map((c, i, arr) => (
                          <li key={c.customer_name}
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => selectCustomer(c.customer_name)}
                            className={`flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-blue-50 transition-colors ${i < arr.length - 1 ? 'border-b border-gray-50' : ''}`}>
                            <span className="text-sm font-medium text-gray-800">{c.customer_name}</span>
                            <span className="text-[10px] text-gray-400 tabular-nums">
                              {c.tdl_count} TDL{c.tdl_count !== 1 ? 's' : ''}
                            </span>
                          </li>
                        ))
                      }
                    </ul>
                  )}
                  {selectedCustomer && (
                    <p className="text-[11px] text-green-600 mt-1 flex items-center gap-1 font-medium">
                      <CheckCircle size={11} /> {selectedCustomer}
                    </p>
                  )}
                </div>

                {/* TDL Name */}
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">TDL Name *</label>
                  {!selectedCustomer ? (
                    <div className="w-full border border-gray-200 bg-gray-50 rounded-lg text-sm py-2 px-3 text-gray-400 cursor-not-allowed">
                      Select customer first
                    </div>
                  ) : tdlsLoading ? (
                    <div className="w-full border border-gray-200 bg-gray-50 rounded-lg text-sm py-2 px-3 text-gray-400">Loading…</div>
                  ) : (
                    <select
                      value={selectedTdlId ?? ''}
                      onChange={e => { setSelectedTdlId(e.target.value ? Number(e.target.value) : null); setCycle(''); }}
                      className="w-full border border-gray-200 rounded-lg text-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white appearance-none transition-shadow"
                    >
                      <option value="">Select TDL…</option>
                      {tdls.map(t => (
                        <option key={t.id} value={t.id}>
                          {t.tdl_name} — {t.billing_count > 0 ? 'Renew' : 'New'}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Start Date */}
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                    Start Date
                    {prepareType === 'renew' && <span className="text-blue-400 font-normal normal-case ml-1">(auto)</span>}
                  </label>
                  <div className="relative">
                    <div className={`w-full border rounded text-sm py-1.5 px-2.5 ${
                      !selectedTdlId ? 'bg-gray-50 text-gray-400 border-gray-200' : 'bg-white text-gray-800 border-gray-300'
                    }`}>
                      {(startDateOverride || autoStartDate) ? fmt(startDateOverride || autoStartDate) : <span className="text-gray-400">DD/MM/YYYY</span>}
                    </div>
                    {selectedTdlId && (
                      <input
                        type="date"
                        value={startDateOverride || autoStartDate}
                        onChange={e => setStartDateOverride(e.target.value)}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                    )}
                  </div>
                  {startDateOverride && startDateOverride !== autoStartDate && (
                    <button onClick={() => setStartDateOverride('')}
                      className="text-[10px] text-blue-500 mt-0.5 hover:underline">
                      Reset to auto ({fmt(autoStartDate)})
                    </button>
                  )}
                </div>
              </div>

              {/* Row 2: Cycle | Expiry | AMC | Total */}
              <div className="grid grid-cols-4 gap-4">

                {/* Cycle */}
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Cycle *</label>
                  <select
                    value={cycle}
                    onChange={e => {
                      setCycle(e.target.value);
                      const t = autoTotal(amcAmount, e.target.value);
                      if (t) setTotalAmount(t);
                    }}
                    disabled={!selectedTdlId}
                    className="w-full border border-gray-200 rounded-lg text-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white appearance-none disabled:bg-gray-50 disabled:text-gray-400 transition-shadow"
                  >
                    <option value="">Select…</option>
                    {CYCLES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>

                {/* Expiry */}
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Expiry Date</label>
                  <div className={`w-full border rounded-lg text-sm py-2 px-3 font-mono font-semibold tabular-nums ${
                    effectiveExpiry
                      ? 'border-gray-200 bg-gray-50 text-gray-800'
                      : 'border-gray-200 bg-gray-50 text-gray-400'
                  }`}>
                    {effectiveExpiry ? fmt(effectiveExpiry) : '—'}
                  </div>
                </div>

                {/* AMC */}
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">AMC (₹ / year)</label>
                  <input
                    type="number" value={amcAmount} min={0} step={0.01}
                    onChange={e => {
                      setAmcAmount(e.target.value);
                      const t = autoTotal(e.target.value, cycle);
                      if (t) setTotalAmount(t);
                    }}
                    placeholder="0.00"
                    className="w-full border border-gray-200 rounded-lg text-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono transition-shadow"
                  />
                </div>

                {/* Total */}
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Total (₹)</label>
                  <input
                    type="number" value={totalAmount} min={0} step={0.01}
                    onChange={e => setTotalAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full border border-gray-200 rounded-lg text-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono transition-shadow"
                  />
                </div>
              </div>

              {/* Row 3: Remark */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Remark</label>
                <input
                  type="text" value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="e.g. Paid by cheque, invoice #123…"
                  className="w-full border border-gray-200 rounded-lg text-sm py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex gap-2 px-6 pb-5">
              <button onClick={closeModal}
                className="px-6 border border-gray-300 hover:bg-gray-50 text-gray-600 text-sm font-medium rounded-lg py-2">
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !selectedTdlId || !cycle || !effectiveStart}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg py-2">
                {saving ? 'Saving…' : 'Create Activity'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TdlBilling;
