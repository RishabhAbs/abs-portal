import React, { useState, useEffect, useRef } from 'react';
import { Plus, Pencil, Trash2, X, ChevronDown, Search, Lock, Settings, Power } from 'lucide-react';
import { vchTypeApi, vouchersApi } from '../services/api';
import { useToast } from '../components/Toast/Toast';
import { useAuth } from '../context/AuthContext';

interface PeriodRow { id?: number; applicable_from: string; particulars?: string; start_no?: number; period_type?: string; }

interface VchTypeItem {
  id: number;
  name: string;
  parent_id: number | null;
  parent_name: string | null;
  deemed_positive: 'YES' | 'NO' | null;
  is_system: number;
  numbering_mode: 'manual' | 'automatic';
  vch_width: number;
  numbering_periods: { applicable_from: string; start_no: number; period_type: string }[];
  prefix_periods: { applicable_from: string; particulars: string }[];
  suffix_periods: { applicable_from: string; particulars: string }[];
}

const PAGE_SIZE = 20;

const fmtDate = (d: string) => {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${parseInt(day)}-${months[parseInt(m)-1]}-${y.slice(2)}`;
};

// Inline editable cell for period tables
const PeriodCell: React.FC<{
  value: string; onChange: (v: string) => void; type?: string; placeholder?: string;
  options?: { value: string; label: string }[];
}> = ({ value, onChange, type = 'text', placeholder = '', options }) => {
  if (options) return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="w-full text-xs border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1">
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
  return (
    <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      className="w-full text-xs border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-blue-300 rounded px-1" />
  );
};

const VchType: React.FC = () => {
  const { showSuccess, showError } = useToast();
  const { canCreate, canEdit, canDelete } = useAuth();
  const canAdd = canCreate('vch_types');
  const canMod = canEdit('vch_types');
  const canDel = canDelete('vch_types');

  const [types, setTypes]     = useState<VchTypeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [page, setPage]       = useState(1);

  const [showPopup, setShowPopup] = useState(false);
  const [editing, setEditing]     = useState<VchTypeItem | null>(null);

  const defaultForm = () => ({
    name: '', parent_id: null as number | null, parent_search: '',
    deemed_positive: '' as 'YES' | 'NO' | '', deemed_auto: false,
    numbering_mode: 'manual' as 'manual' | 'automatic',
    vch_width: 3,
    numbering_periods: [] as { applicable_from: string; start_no: number; period_type: string }[],
    prefix_periods:    [] as { applicable_from: string; particulars: string }[],
    suffix_periods:    [] as { applicable_from: string; particulars: string }[],
  });

  const [form, setForm] = useState(defaultForm());
  const [saving, setSaving]         = useState(false);
  const [parentOpen, setParentOpen] = useState(false);
  const parentRef = useRef<HTMLDivElement>(null);
  const [deleteTarget, setDeleteTarget] = useState<VchTypeItem | null>(null);
  const [deleting, setDeleting]         = useState(false);

  // Numbering config history — snapshots taken automatically before each
  // save, so a bad prefix/suffix/numbering edit can be reviewed and restored.
  const [showAudit, setShowAudit]   = useState(false);
  const [auditList, setAuditList]   = useState<any[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  // Preview shown before retroactively re-wrapping already-saved voucher
  // numbers to match an edited prefix/suffix. Null when no preview is open.
  const [retrofitPreview, setRetrofitPreview] = useState<{
    params: { vch_type_id: number; old_prefix: string; old_suffix: string; new_prefix: string; new_suffix: string; from_date: string; to_date?: string };
    changed: { id: number; old: string; new: string }[];
    skipped: { id: number; vch_no: string }[];
  } | null>(null);
  const [retrofitBusy, setRetrofitBusy] = useState(false);

  const fetchTypes = async () => {
    try {
      const res = await vchTypeApi.getAll();
      if (res.success) setTypes(res.data);
    } catch {}
    setLoading(false);
  };
  useEffect(() => { fetchTypes(); }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (parentRef.current && !parentRef.current.contains(e.target as Node)) setParentOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered   = types.filter(t => t.name.toLowerCase().includes(search.toLowerCase()) || (t.parent_name || '').toLowerCase().includes(search.toLowerCase()));
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const openCreate = () => { setEditing(null); setForm(defaultForm()); setShowAudit(false); setAuditList([]); setShowPopup(true); };

  const openEdit = (t: VchTypeItem) => {
    setEditing(t);
    setForm({
      name: t.name, parent_id: t.parent_id, parent_search: t.parent_name || '',
      deemed_positive: t.deemed_positive ?? '', deemed_auto: false,
      numbering_mode: t.numbering_mode || 'manual',
      vch_width: t.vch_width || 3,
      numbering_periods: (t.numbering_periods || []).map(p => ({ ...p })),
      prefix_periods:    (t.prefix_periods || []).map(p => ({ ...p })),
      suffix_periods:    (t.suffix_periods || []).map(p => ({ ...p })),
    });
    setShowAudit(false);
    setAuditList([]);
    setShowPopup(true);
  };

  const loadAudit = async (typeId: number) => {
    setAuditLoading(true);
    try {
      const res = await vchTypeApi.getAudit(typeId);
      if (res.success) setAuditList(res.data);
    } catch {}
    setAuditLoading(false);
  };

  const toggleAudit = () => {
    const next = !showAudit;
    setShowAudit(next);
    if (next && editing && auditList.length === 0) loadAudit(editing.id);
  };

  // Loads a past snapshot into the form for review — does NOT save by
  // itself. The admin still has to click Update to confirm the restore,
  // same validated path as any other edit.
  const restoreSnapshot = (snapshot: any) => {
    setForm(f => ({
      ...f,
      numbering_mode: snapshot.numbering_mode || 'manual',
      vch_width: snapshot.vch_width || 3,
      numbering_periods: (snapshot.numbering_periods || []).map((p: any) => ({ ...p })),
      prefix_periods:    (snapshot.prefix_periods || []).map((p: any) => ({ ...p })),
      suffix_periods:    (snapshot.suffix_periods || []).map((p: any) => ({ ...p })),
    }));
    setShowAudit(false);
    showSuccess('Restored', 'Snapshot loaded into the form — review and click Update to confirm.');
  };

  const handleSave = async () => {
    if (!editing?.is_system && !form.name.trim()) { showError('Validation', 'Name is required'); return; }
    setSaving(true);
    try {
      const payload: any = {
        numbering_mode:     form.numbering_mode,
        vch_width:          form.vch_width,
        numbering_periods:  form.numbering_mode === 'automatic' ? form.numbering_periods : [],
        prefix_periods:     form.numbering_mode === 'automatic' ? form.prefix_periods : [],
        suffix_periods:     form.numbering_mode === 'automatic' ? form.suffix_periods : [],
      };
      if (!editing?.is_system) {
        payload.name            = form.name.trim();
        payload.parent_id       = form.parent_id ?? null;
        payload.deemed_positive = (form.deemed_positive as 'YES' | 'NO') || null;
      }
      if (editing) {
        const res = await vchTypeApi.update(editing.id, payload);
        if (res.success) {
          showSuccess('Updated', 'Voucher type updated');
          setShowPopup(false);
          fetchTypes();
          await maybeOfferRetrofit(editing, form);
        }
      } else {
        const res = await vchTypeApi.create(payload);
        if (res.success) { showSuccess('Created', 'Voucher type created'); setShowPopup(false); fetchTypes(); }
      }
    } catch (e: any) { showError('Error', e.message || 'Failed'); }
    finally { setSaving(false); }
  };

  // Finds the earliest applicable_from across all three period tables that
  // falls strictly after `after` — i.e. "until any other effective date
  // comes", matching how the numbering itself is period-bounded.
  const nextBoundaryAfter = (f: typeof form, after: string): string | undefined => {
    const dates = [...f.numbering_periods, ...f.prefix_periods, ...f.suffix_periods]
      .map(p => p.applicable_from).filter(d => d && d > after);
    return dates.length ? dates.sort()[0] : undefined;
  };

  // Fetches a retrofit preview for oldPrefix/oldSuffix -> the form's current
  // prefix/suffix and shows the confirmation dialog if anything would change.
  // silent=true (the automatic post-save check) skips the "nothing to do"
  // toasts — only the explicit manual button call surfaces those.
  const previewRetrofit = async (typeId: number, oldPrefix: string, oldSuffix: string, now: typeof form, silent: boolean) => {
    if (now.numbering_mode !== 'automatic') return;
    const newPrefix = now.prefix_periods[0]?.particulars || '';
    const newSuffix = now.suffix_periods[0]?.particulars || '';
    const fromDate  = now.prefix_periods[0]?.applicable_from || now.suffix_periods[0]?.applicable_from;
    if (!fromDate || (oldPrefix === newPrefix && oldSuffix === newSuffix)) {
      if (!silent) showError('Nothing to renumber', 'The current prefix/suffix already matches — no existing vouchers need changing.');
      return;
    }
    const toDate = nextBoundaryAfter(now, fromDate);
    const params = { vch_type_id: typeId, old_prefix: oldPrefix, old_suffix: oldSuffix, new_prefix: newPrefix, new_suffix: newSuffix, from_date: fromDate, to_date: toDate };
    try {
      const res = await vouchersApi.retrofitNumbering({ ...params, dry_run: true });
      if (res.success && res.data.changed.length > 0) {
        setRetrofitPreview({ params, changed: res.data.changed, skipped: res.data.skipped });
      } else if (!silent) {
        showError('Nothing to renumber', 'No already-saved vouchers matched the previous format in this period.');
      }
    } catch (e: any) { if (!silent) showError('Error', e.message || 'Failed to preview'); }
  };

  // After saving, if the (first) prefix or suffix text actually changed,
  // offer to re-wrap already-saved vouchers dated in that period to match —
  // preview only; nothing is touched until the admin explicitly confirms.
  const maybeOfferRetrofit = async (was: VchTypeItem, now: typeof form) => {
    const oldPrefix = was.prefix_periods?.[0]?.particulars || '';
    const oldSuffix = was.suffix_periods?.[0]?.particulars || '';
    await previewRetrofit(was.id, oldPrefix, oldSuffix, now, true);
  };

  // Manual trigger for a config that was already saved earlier (so there's
  // no "just changed" text to auto-detect) — assumes existing plain numbers
  // had no prefix/suffix, which is the common case for pre-existing vouchers.
  const manualRetrofit = () => {
    if (!editing) return;
    previewRetrofit(editing.id, '', '', form, false);
  };

  const applyRetrofit = async () => {
    if (!retrofitPreview) return;
    setRetrofitBusy(true);
    try {
      const res = await vouchersApi.retrofitNumbering({ ...retrofitPreview.params, dry_run: false });
      if (res.success) {
        showSuccess('Renumbered', `${res.data.changed.length} voucher(s) updated to the new format.`);
        setRetrofitPreview(null);
      }
    } catch (e: any) { showError('Error', e.message || 'Failed to apply'); }
    finally { setRetrofitBusy(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await vchTypeApi.delete(deleteTarget.id);
      if (res.success) { showSuccess('Deleted', 'Voucher type deleted'); setDeleteTarget(null); fetchTypes(); }
    } catch (e: any) { showError('Error', e.message || 'Failed'); }
    finally { setDeleting(false); }
  };

  const toggleActive = async (t: any) => {
    const next = !(Number(t.active) !== 0);
    try {
      const res = await vchTypeApi.setActive(t.id, next);
      if (res.success) { showSuccess('Success', next ? 'Activated' : 'Deactivated'); fetchTypes(); }
    } catch (e: any) { showError('Error', e.message || 'Failed'); }
  };

  const parentOptions = types.filter(t =>
    (!editing || t.id !== editing.id) &&
    t.name.toLowerCase().includes(form.parent_search.toLowerCase())
  );
  const selectParent = (t: VchTypeItem) => {
    setForm(f => ({ ...f, parent_id: t.id, parent_search: t.name, deemed_positive: t.deemed_positive ?? '', deemed_auto: true }));
    setParentOpen(false);
  };
  const clearParent = () => setForm(f => ({ ...f, parent_id: null, parent_search: '', deemed_positive: '', deemed_auto: false }));

  // Period table helpers
  const addPeriodRow = (field: 'numbering_periods' | 'prefix_periods' | 'suffix_periods') => {
    setForm(f => {
      const arr = [...(f[field] as any[])];
      const today = new Date().toISOString().split('T')[0];
      if (field === 'numbering_periods') arr.push({ applicable_from: today, start_no: 1, period_type: 'yearly' });
      else arr.push({ applicable_from: today, particulars: '' });
      return { ...f, [field]: arr };
    });
  };
  const updatePeriodRow = (field: 'numbering_periods' | 'prefix_periods' | 'suffix_periods', idx: number, key: string, val: any) => {
    setForm(f => {
      const arr = [...(f[field] as any[])];
      arr[idx] = { ...arr[idx], [key]: val };
      return { ...f, [field]: arr };
    });
  };
  const removePeriodRow = (field: 'numbering_periods' | 'prefix_periods' | 'suffix_periods', idx: number) => {
    setForm(f => { const arr = [...(f[field] as any[])]; arr.splice(idx, 1); return { ...f, [field]: arr }; });
  };

  const pageNums = Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
    .reduce<(number | string)[]>((acc, p, i, arr) => {
      if (i > 0 && (p as number) - (arr[i - 1] as number) > 1) acc.push('...');
      acc.push(p); return acc;
    }, []);

  // Derive preview from first applicable period row
  const previewPrefix = form.prefix_periods[0]?.particulars || '';
  const previewSuffix = form.suffix_periods[0]?.particulars || '';
  const previewStart  = form.numbering_periods[0]?.start_no ?? 1;
  const numPreview    = form.numbering_mode === 'automatic'
    ? `${previewPrefix}${String(previewStart).padStart(form.vch_width, '0')}${previewSuffix}` : null;

  return (
    <div className="min-h-screen bg-gray-100 p-3">
      <div className="bg-white rounded-lg shadow p-4 max-w-[900px] mx-auto">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-lg font-semibold text-gray-800">Voucher Types</h1>
          {canAdd && (
            <button onClick={openCreate}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded px-4 py-2">
              <Plus size={16} /> Add Type
            </button>
          )}
        </div>

        <div className="relative mb-3 max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search types..."
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400" />
        </div>

        {loading ? (
          <div className="text-center py-10 text-gray-400">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-10 text-gray-400">No results found.</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-[11px] text-gray-500 uppercase">
                    <th className="py-2.5 px-3 text-left w-[50px]">S.No</th>
                    <th className="py-2.5 px-3 text-left">Name</th>
                    <th className="py-2.5 px-3 text-left">Parent</th>
                    <th className="py-2.5 px-3 text-left">Numbering</th>
                    <th className="py-2.5 px-3 text-center w-[100px]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((t, idx) => (
                    <tr key={t.id} className={`border-t border-gray-100 hover:bg-gray-50 ${t.is_system ? 'bg-gray-50/40' : ''}`}>
                      <td className="py-2.5 px-3 text-gray-400">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                      <td className="py-2.5 px-3 font-medium text-gray-800 flex items-center gap-1.5">
                        {t.name}
                        {!!t.is_system && <Lock size={11} className="text-gray-300 flex-shrink-0" />}
                        {Number((t as any).active) === 0 && <span className="text-[10px] font-bold uppercase bg-gray-200 text-gray-500 rounded px-1.5 py-0.5">Inactive</span>}
                      </td>
                      <td className="py-2.5 px-3 text-gray-500">{t.parent_name || t.name}</td>
                      <td className="py-2.5 px-3">
                        {t.numbering_mode === 'automatic' ? (
                          <span className="text-[11px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                            Auto · {(t.prefix_periods?.[0]?.particulars || '')}
                            <span className="font-mono">{'0'.repeat(t.vch_width || 3)}</span>
                            {(t.suffix_periods?.[0]?.particulars || '')}
                          </span>
                        ) : (
                          <span className="text-[11px] text-gray-400 italic">Manual</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        {t.is_system ? (
                          <div className="flex justify-center items-center gap-1.5">
                            {canMod && <button onClick={() => openEdit(t)} title="Configure Numbering"
                              className="text-blue-400 hover:text-blue-600 p-1"><Settings size={14} /></button>}
                            <span className="text-[11px] text-gray-300 italic">system</span>
                          </div>
                        ) : (
                          <div className="flex justify-center gap-2">
                            {canMod && <button onClick={() => openEdit(t)} title="Edit"
                              className="text-blue-500 hover:text-blue-700 p-1"><Pencil size={15} /></button>}
                            {canMod && <button onClick={() => toggleActive(t)}
                              title={Number((t as any).active) !== 0 ? 'Deactivate' : 'Activate'}
                              className={`${Number((t as any).active) !== 0 ? 'text-amber-500 hover:text-amber-700' : 'text-emerald-500 hover:text-emerald-700'} p-1`}><Power size={15} /></button>}
                            {!canMod && <span className="text-gray-300 text-xs italic">View only</span>}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-3 text-sm text-gray-500">
                <span>{filtered.length} types · Page {page} of {totalPages}</span>
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
      {showPopup && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-[780px] max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">{editing ? 'Edit Voucher Type' : 'Create Voucher Type'}</h3>
              <button onClick={() => setShowPopup(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>

            <div className="p-5 space-y-4">
              {editing?.is_system ? (
                <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded p-2.5">
                  <Lock size={13} className="text-amber-500 flex-shrink-0" />
                  <span className="text-xs text-amber-700">System type — only numbering can be configured</span>
                </div>
              ) : null}

              {!editing?.is_system && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Name *</label>
                    <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="e.g. Tax Invoice" autoFocus
                      className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Parent</label>
                    <div className="relative" ref={parentRef}>
                      <div className="flex items-center border border-gray-300 rounded overflow-hidden">
                        <input type="text" value={form.parent_search}
                          onChange={e => { setForm(f => ({ ...f, parent_search: e.target.value, parent_id: null, deemed_auto: false })); setParentOpen(true); }}
                          onFocus={() => setParentOpen(true)} placeholder="Search & select parent…"
                          className="flex-1 text-sm py-1.5 px-2 focus:outline-none" />
                        {form.parent_id
                          ? <button onClick={clearParent} className="px-2 text-gray-400 hover:text-gray-600"><X size={14} /></button>
                          : <span className="px-2 text-gray-400"><ChevronDown size={14} /></span>}
                      </div>
                      {parentOpen && parentOptions.length > 0 && (
                        <div className="absolute z-10 w-full bg-white border border-gray-200 rounded shadow-lg mt-1 max-h-48 overflow-y-auto">
                          {parentOptions.map(t => (
                            <div key={t.id} onMouseDown={() => selectParent(t)}
                              className="px-3 py-2 text-sm hover:bg-blue-50 cursor-pointer">{t.name}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Numbering Mode */}
              <div className="flex items-center gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Voucher Numbering</label>
                  <div className="flex gap-2">
                    {(['manual', 'automatic'] as const).map(mode => (
                      <button key={mode} type="button" onClick={() => setForm(f => ({ ...f, numbering_mode: mode }))}
                        className={`px-4 py-1.5 text-sm rounded border font-medium capitalize transition-colors ${
                          form.numbering_mode === mode ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                        }`}>{mode}</button>
                    ))}
                  </div>
                </div>
                {form.numbering_mode === 'automatic' && (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Width (digits)</label>
                    <input type="number" min={1} max={10} value={form.vch_width}
                      onChange={e => setForm(f => ({ ...f, vch_width: Math.max(1, Math.min(10, parseInt(e.target.value) || 3)) }))}
                      className="w-20 border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  </div>
                )}
                {numPreview && (
                  <div className="bg-blue-50 border border-blue-200 rounded px-3 py-1.5 flex items-center gap-2">
                    <span className="text-xs text-blue-600">Preview:</span>
                    <span className="font-mono font-bold text-blue-800 text-sm">{numPreview}</span>
                  </div>
                )}
                {editing && form.numbering_mode === 'automatic' && (
                  <button type="button" onClick={manualRetrofit}
                    className="text-xs text-amber-700 hover:text-amber-900 underline">
                    Renumber existing vouchers to this format
                  </button>
                )}
                {editing && (
                  <button type="button" onClick={toggleAudit}
                    className="ml-auto text-xs text-gray-500 hover:text-blue-600 underline">
                    {showAudit ? 'Hide history' : 'View history'}
                  </button>
                )}
              </div>

              {/* Numbering config history — snapshots taken automatically before each save */}
              {editing && showAudit && (
                <div className="border border-gray-200 rounded overflow-hidden">
                  <div className="px-3 py-2 text-xs font-semibold text-gray-600 bg-gray-50">
                    Numbering History
                  </div>
                  {auditLoading ? (
                    <div className="px-3 py-3 text-xs text-gray-400">Loading…</div>
                  ) : auditList.length === 0 ? (
                    <div className="px-3 py-3 text-xs text-gray-400">No prior changes recorded yet.</div>
                  ) : (
                    <div className="divide-y divide-gray-100 max-h-56 overflow-y-auto">
                      {auditList.map(a => {
                        const s = a.snapshot || {};
                        const prefix = s.prefix_periods?.[0]?.particulars || '';
                        const suffix = s.suffix_periods?.[0]?.particulars || '';
                        const start  = s.numbering_periods?.[0]?.start_no ?? 1;
                        const preview = s.numbering_mode === 'automatic'
                          ? `${prefix}${String(start).padStart(s.vch_width || 3, '0')}${suffix}`
                          : 'Manual';
                        return (
                          <div key={a.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-blue-50/30">
                            <div>
                              <div className="text-gray-700">{new Date(a.changed_at).toLocaleString()}</div>
                              <div className="text-gray-400">{a.changed_by || 'Unknown'} · <span className="font-mono">{preview}</span></div>
                            </div>
                            <button onClick={() => restoreSnapshot(s)}
                              className="text-blue-600 hover:text-blue-800 font-medium shrink-0">Restore</button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Period tables — only when automatic */}
              {form.numbering_mode === 'automatic' && (
                <div className="border border-gray-200 rounded overflow-hidden">
                  {/* 3-column Tally-style header */}
                  <div className="grid grid-cols-3 divide-x divide-gray-200 bg-gray-50">
                    <div className="px-3 py-2 text-xs font-semibold text-gray-600 text-center">Restart Numbering</div>
                    <div className="px-3 py-2 text-xs font-semibold text-gray-600 text-center">Prefix Details</div>
                    <div className="px-3 py-2 text-xs font-semibold text-gray-600 text-center">Suffix Details</div>
                  </div>
                  <div className="grid grid-cols-3 divide-x divide-gray-200 bg-gray-50 border-t border-gray-100">
                    <div className="grid grid-cols-3 px-2 py-1">
                      <span className="text-[10px] text-gray-400 font-medium">Applicable From</span>
                      <span className="text-[10px] text-gray-400 font-medium">Starting No.</span>
                      <span className="text-[10px] text-gray-400 font-medium">Period</span>
                    </div>
                    <div className="grid grid-cols-2 px-2 py-1">
                      <span className="text-[10px] text-gray-400 font-medium">Applicable From</span>
                      <span className="text-[10px] text-gray-400 font-medium">Particulars</span>
                    </div>
                    <div className="grid grid-cols-2 px-2 py-1">
                      <span className="text-[10px] text-gray-400 font-medium">Applicable From</span>
                      <span className="text-[10px] text-gray-400 font-medium">Particulars</span>
                    </div>
                  </div>

                  {/* Rows — max length of any array */}
                  {Array.from({ length: Math.max(form.numbering_periods.length, form.prefix_periods.length, form.suffix_periods.length, 1) }).map((_, i) => {
                    const np = form.numbering_periods[i];
                    const pp = form.prefix_periods[i];
                    const sp = form.suffix_periods[i];
                    return (
                      <div key={i} className="grid grid-cols-3 divide-x divide-gray-100 border-t border-gray-100 hover:bg-blue-50/30 group">
                        {/* Restart numbering */}
                        <div className="grid grid-cols-3 gap-1 px-2 py-1.5 items-center">
                          {np ? <>
                            <PeriodCell value={np.applicable_from} type="date"
                              onChange={v => updatePeriodRow('numbering_periods', i, 'applicable_from', v)} />
                            <PeriodCell value={String(np.start_no)} type="number"
                              onChange={v => updatePeriodRow('numbering_periods', i, 'start_no', parseInt(v) || 1)} />
                            <PeriodCell value={np.period_type}
                              onChange={v => updatePeriodRow('numbering_periods', i, 'period_type', v)}
                              options={[{ value: 'yearly', label: 'Yearly' }, { value: 'manual', label: 'Manual' }]} />
                          </> : (
                            <button onClick={() => addPeriodRow('numbering_periods')}
                              className="col-span-3 text-xs text-blue-500 hover:text-blue-700 text-left px-1">+ Add</button>
                          )}
                        </div>
                        {/* Prefix */}
                        <div className="grid grid-cols-2 gap-1 px-2 py-1.5 items-center">
                          {pp ? <>
                            <PeriodCell value={pp.applicable_from} type="date"
                              onChange={v => updatePeriodRow('prefix_periods', i, 'applicable_from', v)} />
                            <PeriodCell value={pp.particulars} placeholder="e.g. INV/"
                              onChange={v => updatePeriodRow('prefix_periods', i, 'particulars', v)} />
                          </> : (
                            <button onClick={() => addPeriodRow('prefix_periods')}
                              className="col-span-2 text-xs text-blue-500 hover:text-blue-700 text-left px-1">+ Add</button>
                          )}
                        </div>
                        {/* Suffix */}
                        <div className="grid grid-cols-2 gap-1 px-2 py-1.5 items-center">
                          {sp ? <>
                            <PeriodCell value={sp.applicable_from} type="date"
                              onChange={v => updatePeriodRow('suffix_periods', i, 'applicable_from', v)} />
                            <PeriodCell value={sp.particulars} placeholder="e.g. /26"
                              onChange={v => updatePeriodRow('suffix_periods', i, 'particulars', v)} />
                          </> : (
                            <button onClick={() => addPeriodRow('suffix_periods')}
                              className="col-span-2 text-xs text-blue-500 hover:text-blue-700 text-left px-1">+ Add</button>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* Add row button */}
                  <div className="border-t border-gray-100 px-3 py-2 flex gap-4">
                    <button onClick={() => { addPeriodRow('numbering_periods'); addPeriodRow('prefix_periods'); addPeriodRow('suffix_periods'); }}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium">+ Add Period Row</button>
                    {(form.numbering_periods.length > 0 || form.prefix_periods.length > 0 || form.suffix_periods.length > 0) && (
                      <button onClick={() => {
                        const last = Math.max(form.numbering_periods.length, form.prefix_periods.length, form.suffix_periods.length) - 1;
                        if (form.numbering_periods[last]) removePeriodRow('numbering_periods', last);
                        if (form.prefix_periods[last]) removePeriodRow('prefix_periods', last);
                        if (form.suffix_periods[last]) removePeriodRow('suffix_periods', last);
                      }} className="text-xs text-red-400 hover:text-red-600">Remove last</button>
                    )}
                  </div>
                </div>
              )}

              <button onClick={handleSave} disabled={saving}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium rounded py-2">
                {saving ? 'Saving…' : editing ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center">
          <div className="bg-white rounded-lg shadow-xl p-5 w-[380px]">
            <h3 className="font-semibold text-gray-800 mb-2">Delete Voucher Type</h3>
            <p className="text-sm text-gray-600 mb-4">
              Are you sure you want to delete <strong>{deleteTarget.name}</strong>? This cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteTarget(null)}
                className="px-4 py-1.5 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-50">Cancel</button>
              <button onClick={handleDelete} disabled={deleting}
                className="px-4 py-1.5 text-sm text-white bg-red-500 hover:bg-red-600 disabled:bg-red-300 rounded">
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Retrofit already-saved voucher numbers to a changed prefix/suffix */}
      {retrofitPreview && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl p-5 w-[520px] max-w-full">
            <h3 className="font-semibold text-gray-800 mb-2">Apply new format to existing vouchers?</h3>
            <p className="text-sm text-gray-600 mb-3">
              You changed the prefix/suffix. <strong>{retrofitPreview.changed.length}</strong> already-saved voucher(s)
              in this period can be renamed to match — nothing has been changed yet.
            </p>
            <div className="border border-gray-200 rounded max-h-56 overflow-y-auto mb-2">
              {retrofitPreview.changed.map(c => (
                <div key={c.id} className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs border-b border-gray-100 last:border-0">
                  <span className="font-mono text-gray-500">{c.old}</span>
                  <span className="text-gray-300">→</span>
                  <span className="font-mono text-blue-700 font-medium">{c.new}</span>
                </div>
              ))}
            </div>
            {retrofitPreview.skipped.length > 0 && (
              <p className="text-xs text-amber-600 mb-3">
                {retrofitPreview.skipped.length} voucher(s) skipped — their number doesn't match the previous prefix/suffix pattern, so they were left untouched.
              </p>
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={() => setRetrofitPreview(null)} disabled={retrofitBusy}
                className="px-4 py-1.5 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-50">
                Leave as-is
              </button>
              <button onClick={applyRetrofit} disabled={retrofitBusy}
                className="px-4 py-1.5 text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 rounded">
                {retrofitBusy ? 'Applying…' : `Apply to ${retrofitPreview.changed.length} voucher(s)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VchType;
