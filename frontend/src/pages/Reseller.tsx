import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, X, Search } from 'lucide-react';
import { resellersApi } from '../services/api';
import { useToast } from '../components/Toast/Toast';

interface ResellerRow {
  id: number;
  name: string;
  mobile?: string;
  email?: string;
  pan?: string;
  address?: string;
  date?: string;
}

const PAGE_SIZE = 25;

const Reseller: React.FC = () => {
  const { showSuccess, showError } = useToast();

  const [rows, setRows] = useState<ResellerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // Modal: shared between create + edit. `editing` is the row being edited;
  // null when creating a new one.
  const [editing, setEditing] = useState<ResellerRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', mobile: '', email: '', address: '', pan: '' });
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<ResellerRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const res = await resellersApi.getAll();
      if (res.success) setRows(res.data || []);
    } catch (e: any) {
      showError('Error', e?.message || 'Failed to load resellers');
    }
    setLoading(false);
  }, [showError]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const filtered = rows.filter(r => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (r.name || '').toLowerCase().includes(q)
      || (r.mobile || '').toLowerCase().includes(q)
      || (r.email || '').toLowerCase().includes(q);
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const openCreate = () => {
    setEditing(null);
    setCreating(true);
    setForm({ name: '', mobile: '', email: '', address: '', pan: '' });
  };

  const openEdit = (r: ResellerRow) => {
    setEditing(r);
    setCreating(false);
    setForm({
      name: r.name || '',
      mobile: r.mobile || '',
      email: r.email || '',
      address: r.address || '',
      pan: r.pan || '',
    });
  };

  const closeModal = () => { setEditing(null); setCreating(false); };

  const handleSave = async () => {
    if (!form.name.trim()) { showError('Validation', 'Name is required'); return; }
    setSaving(true);
    try {
      if (creating) {
        const res = await resellersApi.create(form);
        if (res.success) {
          showSuccess('Created', `${form.name.trim()} added`);
          closeModal();
          fetchAll();
        } else {
          showError('Error', (res as any).message || 'Create failed');
        }
      } else if (editing) {
        const res = await resellersApi.update(editing.id, form);
        if (res.success) {
          showSuccess('Saved', `${form.name.trim()} updated`);
          closeModal();
          fetchAll();
        } else {
          showError('Error', (res as any).message || 'Update failed');
        }
      }
    } catch (e: any) { showError('Error', e?.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await resellersApi.delete(deleteTarget.id);
      if (res.success) {
        showSuccess('Deleted', `${deleteTarget.name} removed`);
        setDeleteTarget(null);
        fetchAll();
      } else {
        showError('Error', (res as any).message || 'Delete failed');
      }
    } catch (e: any) { showError('Error', e?.message || 'Failed to delete'); }
    finally { setDeleting(false); }
  };

  const pageNums = Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter(p => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
    .reduce<(number | string)[]>((acc, p, i, arr) => {
      if (i > 0 && (p as number) - (arr[i - 1] as number) > 1) acc.push('...');
      acc.push(p);
      return acc;
    }, []);

  return (
    <div className="min-h-screen bg-gray-100 p-3">
      <div className="bg-white rounded-lg shadow p-4 w-full">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-lg font-semibold text-gray-800">Resellers</h1>
          <button onClick={openCreate}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded px-4 py-2">
            <Plus size={16} /> Add Reseller
          </button>
        </div>

        <div className="relative mb-3 max-w-sm">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search name / mobile / email…"
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400" />
        </div>

        {loading ? (
          <div className="text-center py-10 text-gray-400">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-10 text-gray-400">No resellers found.</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-[11px] text-gray-500 uppercase">
                    <th className="py-2.5 px-3 text-left w-[60px]">S.No</th>
                    <th className="py-2.5 px-3 text-left">Name</th>
                    <th className="py-2.5 px-3 text-left w-[140px]">Mobile</th>
                    <th className="py-2.5 px-3 text-left w-[220px]">Email</th>
                    <th className="py-2.5 px-3 text-left w-[120px]">PAN</th>
                    <th className="py-2.5 px-3 text-left">Address</th>
                    <th className="py-2.5 px-3 text-center w-[110px]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((r, idx) => (
                    <tr key={r.id}
                      onClick={() => openEdit(r)}
                      className="border-t border-gray-100 hover:bg-blue-50 cursor-pointer">
                      <td className="py-2.5 px-3 text-gray-400 tabular-nums">{(safePage - 1) * PAGE_SIZE + idx + 1}</td>
                      <td className="py-2.5 px-3 font-medium text-gray-800">{r.name}</td>
                      <td className="py-2.5 px-3 text-gray-600 font-mono">{r.mobile || '—'}</td>
                      <td className="py-2.5 px-3 text-gray-600 truncate" title={r.email || ''}>{r.email || '—'}</td>
                      <td className="py-2.5 px-3 text-gray-600 font-mono">{r.pan || '—'}</td>
                      <td className="py-2.5 px-3 text-gray-600 truncate max-w-[260px]" title={r.address || ''}>{r.address || '—'}</td>
                      <td className="py-2.5 px-3 text-center" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-center gap-2">
                          <button onClick={() => openEdit(r)} title="Edit"
                            className="text-blue-500 hover:text-blue-700 p-1"><Pencil size={15} /></button>
                          <button onClick={() => setDeleteTarget(r)} title="Delete"
                            className="text-red-400 hover:text-red-600 p-1"><Trash2 size={15} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-3 text-sm text-gray-500">
                <span>{filtered.length} reseller{filtered.length !== 1 ? 's' : ''} · Page {safePage} of {totalPages}</span>
                <div className="flex gap-1">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}
                    className="px-3 py-1 border border-gray-300 rounded disabled:opacity-40 hover:bg-gray-50">Prev</button>
                  {pageNums.map((p, i) => typeof p === 'string'
                    ? <span key={i} className="px-2 py-1 text-gray-400">…</span>
                    : <button key={p} onClick={() => setPage(p)}
                        className={`px-3 py-1 border rounded ${p === safePage ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 hover:bg-gray-50'}`}>{p}</button>
                  )}
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}
                    className="px-3 py-1 border border-gray-300 rounded disabled:opacity-40 hover:bg-gray-50">Next</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Create / Edit Modal */}
      {(editing || creating) && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center" onClick={closeModal}>
          <div className="bg-white rounded-lg shadow-xl p-5 w-[480px]" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-semibold text-gray-800">{creating ? 'Create Reseller' : 'Edit Reseller'}</h3>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Name *</label>
                <input type="text" value={form.name} autoFocus
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Rakesh Chuhan"
                  className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Mobile</label>
                  <input type="text" value={form.mobile}
                    onChange={e => setForm(f => ({ ...f, mobile: e.target.value }))}
                    placeholder="10-digit number"
                    className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400 font-mono" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">PAN</label>
                  <input type="text" value={form.pan}
                    onChange={e => setForm(f => ({ ...f, pan: e.target.value.toUpperCase() }))}
                    placeholder="ABCDE1234F"
                    maxLength={10}
                    className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400 font-mono uppercase" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Email</label>
                <input type="email" value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="name@example.com"
                  className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Address</label>
                <textarea value={form.address}
                  onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                  rows={2}
                  placeholder="Street, city, state…"
                  className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none" />
              </div>

              <div className="flex gap-2 pt-1">
                <button onClick={closeModal}
                  className="flex-1 border border-gray-300 hover:bg-gray-50 text-gray-600 text-sm font-medium rounded py-2">
                  Cancel
                </button>
                <button onClick={handleSave} disabled={saving}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium rounded py-2">
                  {saving ? 'Saving…' : (creating ? 'Create' : 'Save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center" onClick={() => setDeleteTarget(null)}>
          <div className="bg-white rounded-lg shadow-xl p-5 w-[400px]" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-800 mb-2">Delete Reseller</h3>
            <p className="text-sm text-gray-600 mb-4">
              Delete <strong>{deleteTarget.name}</strong>? This cannot be undone.
              <br />
              <span className="text-[11px] text-gray-400 mt-1 inline-block">
                Resellers assigned to active customers can't be deleted — reassign them from the Group / Reseller Change page first.
              </span>
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteTarget(null)}
                className="px-4 py-1.5 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-50">
                Cancel
              </button>
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

export default Reseller;
