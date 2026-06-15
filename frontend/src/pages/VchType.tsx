import React, { useState, useEffect, useRef } from 'react';
import { Plus, Pencil, Trash2, X, ChevronDown, Search, Lock } from 'lucide-react';
import { vchTypeApi } from '../services/api';
import { useToast } from '../components/Toast/Toast';
import { useAuth } from '../context/AuthContext';

interface VchTypeItem {
  id: number;
  name: string;
  parent_id: number | null;
  parent_name: string | null;
  deemed_positive: 'YES' | 'NO' | null;
  is_system: number;
}

const PAGE_SIZE = 20;


const DeemedBadge: React.FC<{ value: 'YES' | 'NO' | null }> = ({ value }) => {
  if (!value) return <span className="text-xs text-gray-300 italic">—</span>;
  return (
    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${value === 'YES' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
      {value}
    </span>
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
  const [form, setForm] = useState({
    name: '',
    parent_id: null as number | null,
    parent_search: '',
    deemed_positive: '' as 'YES' | 'NO' | '',
    deemed_auto: false,   // true = value came from parent, false = manually set
  });
  const [saving, setSaving]         = useState(false);
  const [parentOpen, setParentOpen] = useState(false);
  const parentRef = useRef<HTMLDivElement>(null);

  const [deleteTarget, setDeleteTarget] = useState<VchTypeItem | null>(null);
  const [deleting, setDeleting]         = useState(false);

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

  const filtered = types.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    (t.parent_name || '').toLowerCase().includes(search.toLowerCase())
  );
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', parent_id: null, parent_search: '', deemed_positive: '', deemed_auto: false });
    setShowPopup(true);
  };

  const openEdit = (t: VchTypeItem) => {
    setEditing(t);
    setForm({
      name: t.name,
      parent_id: t.parent_id,
      parent_search: t.parent_name || '',
      deemed_positive: t.deemed_positive ?? '',
      deemed_auto: false,
    });
    setShowPopup(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { showError('Validation', 'Name is required'); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        parent_id: form.parent_id ?? null,
        deemed_positive: (form.deemed_positive as 'YES' | 'NO') || null,
      };
      if (editing) {
        const res = await vchTypeApi.update(editing.id, payload);
        if (res.success) { showSuccess('Updated', 'Voucher type updated'); setShowPopup(false); fetchTypes(); }
      } else {
        const res = await vchTypeApi.create(payload);
        if (res.success) { showSuccess('Created', 'Voucher type created'); setShowPopup(false); fetchTypes(); }
      }
    } catch (e: any) { showError('Error', e.message || 'Failed'); }
    finally { setSaving(false); }
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

  const parentOptions = types.filter(t =>
    (!editing || t.id !== editing.id) &&
    t.name.toLowerCase().includes(form.parent_search.toLowerCase())
  );

  const selectParent = (t: VchTypeItem) => {
    // Auto-apply deemed_positive from selected parent
    const autoDeemed = t.deemed_positive ?? '';
    setForm(f => ({
      ...f,
      parent_id: t.id,
      parent_search: t.name,
      deemed_positive: autoDeemed,
      deemed_auto: true,
    }));
    setParentOpen(false);
  };

  const clearParent = () => setForm(f => ({
    ...f,
    parent_id: null,
    parent_search: '',
    deemed_positive: '',
    deemed_auto: false,
  }));

  const pageNums = Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
    .reduce<(number | string)[]>((acc, p, i, arr) => {
      if (i > 0 && (p as number) - (arr[i - 1] as number) > 1) acc.push('...');
      acc.push(p);
      return acc;
    }, []);

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
                      </td>
                      <td className="py-2.5 px-3 text-gray-500">{t.parent_name || t.name}</td>
                      <td className="py-2.5 px-3 text-center">
                        {t.is_system ? (
                          <span className="text-[11px] text-gray-300 italic">system</span>
                        ) : (
                          <div className="flex justify-center gap-2">
                            {canMod && <button onClick={() => openEdit(t)} title="Edit"
                              className="text-blue-500 hover:text-blue-700 p-1"><Pencil size={15} /></button>}
                            {canDel && <button onClick={() => setDeleteTarget(t)} title="Delete"
                              className="text-red-400 hover:text-red-600 p-1"><Trash2 size={15} /></button>}
                            {!canMod && !canDel && <span className="text-gray-300 text-xs italic">View only</span>}
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
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center">
          <div className="bg-white rounded-lg shadow-xl p-5 w-[420px]">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-semibold text-gray-800">{editing ? 'Edit Voucher Type' : 'Create Voucher Type'}</h3>
              <button onClick={() => setShowPopup(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Name *</label>
                <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Sales Return" autoFocus
                  className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Parent</label>
                <div className="relative" ref={parentRef}>
                  <div className="flex items-center border border-gray-300 rounded overflow-hidden">
                    <input type="text" value={form.parent_search}
                      onChange={e => { setForm(f => ({ ...f, parent_search: e.target.value, parent_id: null, deemed_auto: false })); setParentOpen(true); }}
                      onFocus={() => setParentOpen(true)}
                      placeholder="Search & select parent…"
                      className="flex-1 text-sm py-1.5 px-2 focus:outline-none" />
                    {form.parent_id
                      ? <button onClick={clearParent} className="px-2 text-gray-400 hover:text-gray-600"><X size={14} /></button>
                      : <span className="px-2 text-gray-400"><ChevronDown size={14} /></span>}
                  </div>
                  {parentOpen && parentOptions.length > 0 && (
                    <div className="absolute z-10 w-full bg-white border border-gray-200 rounded shadow-lg mt-1 max-h-48 overflow-y-auto">
                      {parentOptions.map(t => (
                        <div key={t.id} onMouseDown={() => selectParent(t)}
                          className="px-3 py-2 text-sm hover:bg-blue-50 cursor-pointer">
                          {t.name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>


              <button onClick={handleSave} disabled={saving}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium rounded py-2 mt-1">
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
    </div>
  );
};

export default VchType;
