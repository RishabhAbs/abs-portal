import React, { useState, useEffect, useRef } from 'react';
import { Plus, Pencil, Trash2, X, ChevronDown, Search } from 'lucide-react';
import { ledgerGroupApi } from '../services/api';
import { useToast } from '../components/Toast/Toast';
import { useAuth } from '../context/AuthContext';

interface LedgerGroupItem {
  id: number;
  name: string;
  parent_id: number | null;
  parent_name: string | null;
}

const PAGE_SIZE = 20;

const LedgerGroup: React.FC = () => {
  const { showSuccess, showError } = useToast();
  const { canCreate, canEdit, canDelete } = useAuth();
  const canAdd = canCreate('ledger_groups');
  const canMod = canEdit('ledger_groups');
  const canDel = canDelete('ledger_groups');
  const [groups, setGroups] = useState<LedgerGroupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [showPopup, setShowPopup] = useState(false);
  const [editing, setEditing] = useState<LedgerGroupItem | null>(null);
  const [form, setForm] = useState({ name: '', parent_id: null as number | null, parent_search: '' });
  const [saving, setSaving] = useState(false);

  const [parentOpen, setParentOpen] = useState(false);
  const parentRef = useRef<HTMLDivElement>(null);

  const [deleteTarget, setDeleteTarget] = useState<LedgerGroupItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchGroups = async () => {
    try {
      const res = await ledgerGroupApi.getAll();
      if (res.success) setGroups(res.data);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { fetchGroups(); }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (parentRef.current && !parentRef.current.contains(e.target as Node)) setParentOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = groups.filter(g =>
    g.name.toLowerCase().includes(search.toLowerCase()) ||
    (g.parent_name || '').toLowerCase().includes(search.toLowerCase())
  );
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleSearch = (val: string) => { setSearch(val); setPage(1); };

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', parent_id: null, parent_search: '' });
    setShowPopup(true);
  };

  const openEdit = (g: LedgerGroupItem) => {
    setEditing(g);
    setForm({ name: g.name, parent_id: g.parent_id, parent_search: g.parent_name || '' });
    setShowPopup(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { showError('Validation', 'Ledger name is required'); return; }
    setSaving(true);
    try {
      const payload = { name: form.name.trim(), parent_id: form.parent_id ?? null };
      if (editing) {
        const res = await ledgerGroupApi.update(editing.id, payload);
        if (res.success) { showSuccess('Success', 'Updated'); setShowPopup(false); fetchGroups(); }
      } else {
        const res = await ledgerGroupApi.create(payload);
        if (res.success) { showSuccess('Success', 'Created'); setShowPopup(false); fetchGroups(); }
      }
    } catch (e: any) { showError('Error', e.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await ledgerGroupApi.delete(deleteTarget.id);
      if (res.success) { showSuccess('Success', 'Deleted'); setDeleteTarget(null); fetchGroups(); }
    } catch (e: any) { showError('Error', e.message || 'Failed'); }
    finally { setDeleting(false); }
  };

  const parentOptions = groups.filter(g =>
    (!editing || g.id !== editing.id) &&
    g.name.toLowerCase().includes(form.parent_search.toLowerCase())
  );

  const selectParent = (g: LedgerGroupItem) => {
    setForm(f => ({ ...f, parent_id: g.id, parent_search: g.name }));
    setParentOpen(false);
  };

  const clearParent = () => setForm(f => ({ ...f, parent_id: null, parent_search: '' }));

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
          <h1 className="text-lg font-semibold text-gray-800">Ledger Groups</h1>
          {canAdd && (
            <button onClick={openCreate}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded px-4 py-2">
              <Plus size={16} /> Create Ledger
            </button>
          )}
        </div>

        {/* Search */}
        <div className="relative mb-3 max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={search} onChange={e => handleSearch(e.target.value)}
            placeholder="Search ledger groups..."
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400" />
        </div>

        {loading ? (
          <div className="text-center py-10 text-gray-400">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-10 text-gray-400">No results found.</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-[11px] text-gray-500 uppercase">
                    <th className="py-2.5 px-3 text-left w-[60px]">S.No</th>
                    <th className="py-2.5 px-3 text-left">Ledger Name</th>
                    <th className="py-2.5 px-3 text-left">Parent</th>
                    <th className="py-2.5 px-3 text-center w-[120px]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((g, idx) => (
                    <tr key={g.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="py-2.5 px-3 text-gray-400">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                      <td className="py-2.5 px-3 font-medium text-gray-800">{g.name}</td>
                      <td className="py-2.5 px-3 text-gray-500">
                        {g.parent_name || <span className="text-xs text-gray-400 italic">Primary</span>}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <div className="flex justify-center gap-2">
                          {canMod && <button onClick={() => openEdit(g)} title="Edit"
                            className="text-blue-500 hover:text-blue-700 p-1"><Pencil size={15} /></button>}
                          {canDel && <button onClick={() => setDeleteTarget(g)} title="Delete"
                            className="text-red-400 hover:text-red-600 p-1"><Trash2 size={15} /></button>}
                          {!canMod && !canDel && <span className="text-gray-300 text-xs italic">View only</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-3 text-sm text-gray-500">
                <span>{filtered.length} groups · Page {page} of {totalPages}</span>
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

      {/* Create / Edit Popup */}
      {showPopup && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center">
          <div className="bg-white rounded-lg shadow-xl p-5 w-[420px]">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-semibold text-gray-800">{editing ? 'Edit Ledger Group' : 'Create Ledger Group'}</h3>
              <button onClick={() => setShowPopup(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Ledger Name *</label>
                <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Current Assets"
                  className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  autoFocus />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Parent Group</label>
                <div className="relative" ref={parentRef}>
                  <div className="flex items-center border border-gray-300 rounded overflow-hidden">
                    <input type="text" value={form.parent_search}
                      onChange={e => { setForm(f => ({ ...f, parent_search: e.target.value, parent_id: null })); setParentOpen(true); }}
                      onFocus={() => setParentOpen(true)}
                      placeholder="Search & select parent..."
                      className="flex-1 text-sm py-1.5 px-2 focus:outline-none" />
                    {form.parent_id
                      ? <button onClick={clearParent} className="px-2 text-gray-400 hover:text-gray-600"><X size={14} /></button>
                      : <span className="px-2 text-gray-400"><ChevronDown size={14} /></span>}
                  </div>
                  {parentOpen && parentOptions.length > 0 && (
                    <div className="absolute z-10 w-full bg-white border border-gray-200 rounded shadow-lg mt-1 max-h-48 overflow-y-auto">
                      {parentOptions.map(g => (
                        <div key={g.id} onMouseDown={() => selectParent(g)}
                          className="px-3 py-2 text-sm hover:bg-blue-50 cursor-pointer flex items-center justify-between">
                          <span>{g.name}</span>
                          {g.parent_name && <span className="text-xs text-gray-400 ml-2">{g.parent_name}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <button onClick={handleSave} disabled={saving}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium rounded py-2 mt-1">
                {saving ? 'Saving...' : editing ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center">
          <div className="bg-white rounded-lg shadow-xl p-5 w-[380px]">
            <h3 className="font-semibold text-gray-800 mb-2">Delete Ledger Group</h3>
            <p className="text-sm text-gray-600 mb-4">Are you sure you want to delete <strong>{deleteTarget.name}</strong>? This cannot be undone.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteTarget(null)}
                className="px-4 py-1.5 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-50">Cancel</button>
              <button onClick={handleDelete} disabled={deleting}
                className="px-4 py-1.5 text-sm text-white bg-red-500 hover:bg-red-600 disabled:bg-red-300 rounded">
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LedgerGroup;
