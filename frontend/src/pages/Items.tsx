import React, { useState, useEffect, useRef } from 'react';
import { Plus, Pencil, Trash2, X, ChevronDown, Search } from 'lucide-react';
import { itemsApi } from '../services/api';
import { useToast } from '../components/Toast/Toast';
import { useAuth } from '../context/AuthContext';

interface Item {
  id: number;
  item_name: string;
  tally_flavour_id: number | null;
  flavour_name: string | null;
  batch: 'Yes' | 'No';
  gst: number;
  hsn: string;
  item_group_id: number | null;
  group_name: string | null;
  category_id: number | null;
  category_name: string | null;
  opening_qty: number;
  opening_rate: number;
  opening_value: number;
}

interface Flavour { id: number; name: string; }
interface ItemGroup { id: number; name: string; }
interface ItemCat { id: number; name: string; }
interface BatchRow { id: string; batch_name: string; qty: number | ''; rate: number | ''; amount: number | ''; }

let _uid = 0;
const uid = () => String(++_uid);
const emptyBatch = (): BatchRow => ({ id: uid(), batch_name: '', qty: '', rate: '', amount: '' });

const Items: React.FC = () => {
  const { showSuccess, showError } = useToast();
  const { canCreate, canEdit, canDelete } = useAuth();
  const canAdd = canCreate('items');
  const canMod = canEdit('items');
  const canDel = canDelete('items');
  const [items, setItems] = useState<Item[]>([]);
  const [flavours, setFlavours] = useState<Flavour[]>([]);
  const [groups, setGroups] = useState<ItemGroup[]>([]);
  const [categories, setCategories] = useState<ItemCat[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter states
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('');

  // Item form popup
  const [showPopup, setShowPopup] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [form, setForm] = useState({
    item_name: '',
    tally_flavour_id: null as number | null,
    batch: 'No' as 'Yes' | 'No',
    gst: '' as number | '',
    hsn: '',
    item_group_id: null as number | null,
    group_search: '',
    category_id: null as number | null,
    opening_qty: '' as number | '',
    opening_rate: '' as number | '',
    opening_value: '' as number | '',
  });
  const [saving, setSaving] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const groupDropRef = useRef<HTMLDivElement>(null);

  // Batch popup
  const [showBatchPopup, setShowBatchPopup] = useState(false);
  const [batchRows, setBatchRows] = useState<BatchRow[]>([emptyBatch()]);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<Item | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchItems = async () => {
    try {
      const res = await itemsApi.getAll();
      if (res.success) setItems(res.data);
    } catch { }
    setLoading(false);
  };

  const fetchGroups = async () => {
    try {
      const res = await itemsApi.getGroups();
      if (res.success) setGroups(res.data);
    } catch { }
  };

  useEffect(() => {
    fetchItems();
    fetchGroups();
    itemsApi.getFlavours().then(r => { if (r.success) setFlavours(r.data); }).catch(() => {});
    itemsApi.getCategories().then(r => { if (r.success) setCategories(r.data); }).catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (groupDropRef.current && !groupDropRef.current.contains(e.target as Node)) setGroupOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Auto-calc opening_value from qty × rate
  const handleQtyChange = (val: number | '', autoOpenBatch = false) => {
    const rate = Number(form.opening_rate) || 0;
    const qty = Number(val) || 0;
    setForm(f => ({
      ...f,
      opening_qty: val,
      opening_value: val === '' ? '' : parseFloat((qty * rate).toFixed(2)),
    }));
    if (autoOpenBatch && form.batch === 'Yes' && qty > 0) {
      setShowBatchPopup(true);
    }
  };
  const handleRateChange = (val: number | '') => {
    const qty = Number(form.opening_qty) || 0;
    const rate = Number(val) || 0;
    setForm(f => ({
      ...f,
      opening_rate: val,
      opening_value: val === '' ? '' : parseFloat((qty * rate).toFixed(2)),
    }));
  };

  // Batch row helpers
  const updateBatchRow = (id: string, field: keyof BatchRow, raw: string) => {
    setBatchRows(rows => rows.map(r => {
      if (r.id !== id) return r;
      if (field === 'batch_name') return { ...r, batch_name: raw };
      const num = raw === '' ? '' : Number(raw);
      if (field === 'qty' || field === 'rate') {
        const qty  = field === 'qty'  ? (num === '' ? 0 : num as number) : (Number(r.qty)  || 0);
        const rate = field === 'rate' ? (num === '' ? 0 : num as number) : (Number(r.rate) || 0);
        return { ...r, [field]: num, amount: parseFloat((qty * rate).toFixed(2)) };
      }
      return { ...r, [field]: num };
    }));
  };

  const batchTotalQty = batchRows.reduce((s, r) => s + (Number(r.qty) || 0), 0);
  const batchTotalAmt = batchRows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const targetQty = Number(form.opening_qty) || 0;
  const batchQtyMatch = Math.abs(batchTotalQty - targetQty) < 0.001;

  const openCreate = () => {
    setEditingItem(null);
    setForm({ item_name: '', tally_flavour_id: null, batch: 'No', gst: '', hsn: '', item_group_id: null, group_search: '', category_id: null, opening_qty: '', opening_rate: '', opening_value: '' });
    setBatchRows([emptyBatch()]);
    setShowPopup(true);
  };

  const openEdit = async (item: Item) => {
    setEditingItem(item);
    const grp = groups.find(g => g.id === item.item_group_id);
    setForm({
      item_name: item.item_name,
      tally_flavour_id: item.tally_flavour_id || null,
      batch: item.batch || 'No',
      gst: item.gst || '',
      hsn: item.hsn || '',
      item_group_id: item.item_group_id || null,
      group_search: grp?.name || '',
      category_id: item.category_id || null,
      opening_qty: item.opening_qty || '',
      opening_rate: item.opening_rate || '',
      opening_value: item.opening_value || '',
    });
    // Load existing batch rows if batch item
    if (item.batch === 'Yes') {
      try {
        const res = await itemsApi.getOpeningBatches(item.id);
        if (res.success && res.data.length > 0) {
          setBatchRows(res.data.map((b: any) => ({
            id: uid(),
            batch_name: b.batch_name || '',
            qty: Number(b.qty) || '',
            rate: Number(b.rate) || '',
            amount: Number(b.amount) || '',
          })));
        } else {
          setBatchRows([emptyBatch()]);
        }
      } catch { setBatchRows([emptyBatch()]); }
    } else {
      setBatchRows([emptyBatch()]);
    }
    setShowPopup(true);
  };

  const handleSave = async () => {
    if (!form.item_name.trim()) { showError('Validation', 'Item name is required'); return; }
    // If batch item with qty entered, batch must be filled and totals must match
    if (form.batch === 'Yes' && targetQty > 0 && !batchQtyMatch) {
      showError('Validation', `Batch total qty (${batchTotalQty}) must equal opening qty (${targetQty})`);
      return;
    }
    setSaving(true);
    try {
      const payload = {
        item_name: form.item_name,
        tally_flavour_id: form.tally_flavour_id,
        batch: form.batch,
        gst: Number(form.gst) || 0,
        hsn: form.hsn,
        item_group_id: form.item_group_id,
        category_id: form.category_id,
        opening_qty: Number(form.opening_qty) || 0,
        opening_rate: Number(form.opening_rate) || 0,
        opening_value: Number(form.opening_value) || 0,
      };

      let itemId: number;
      if (editingItem) {
        const res = await itemsApi.update(editingItem.id, payload);
        if (!res.success) return;
        itemId = editingItem.id;
        showSuccess('Success', 'Item updated');
      } else {
        const res = await itemsApi.create(payload);
        if (!res.success) return;
        itemId = res.data?.id;
        showSuccess('Success', 'Item created');
      }

      // Save opening entries to inventory_entries + batch (vch_id=NULL marks opening)
      if (itemId) {
        const qty = Number(form.opening_qty) || 0;
        if (form.batch === 'Yes') {
          const validBatches = batchRows.filter(r => (Number(r.qty) || 0) > 0);
          await itemsApi.saveOpeningBatches(itemId, validBatches.map(r => ({
            batch_name: r.batch_name,
            qty: Number(r.qty) || 0,
            rate: Number(r.rate) || 0,
            amount: Number(r.amount) || 0,
          })));
        } else {
          // batch=No: single opening entry, no batch name
          if (qty > 0) {
            await itemsApi.saveOpeningBatches(itemId, [{
              batch_name: '',
              qty,
              rate: Number(form.opening_rate) || 0,
              amount: Number(form.opening_value) || 0,
            }]);
          } else {
            await itemsApi.saveOpeningBatches(itemId, []);
          }
        }
      }

      setShowPopup(false);
      fetchItems();
    } catch (err: any) {
      showError('Error', err.message || 'Failed to save item');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await itemsApi.delete(deleteTarget.id);
      if (res.success) { showSuccess('Success', 'Item deleted'); setDeleteTarget(null); fetchItems(); }
    } catch (err: any) {
      showError('Error', err.message || 'Failed to delete item');
    } finally {
      setDeleting(false);
    }
  };

  const groupOptions = groups.filter(g => g.name.toLowerCase().includes(form.group_search.toLowerCase()));

  const filtered = items.filter(item => {
    const matchSearch = !search || item.item_name.toLowerCase().includes(search.toLowerCase());
    const matchGroup = !groupFilter || String(item.item_group_id) === groupFilter;
    return matchSearch && matchGroup;
  });

  return (
    <div className="min-h-screen bg-gray-100 p-3">
      <div className="bg-white rounded-lg shadow p-4 max-w-[1200px] mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-lg font-semibold text-gray-800">Items</h1>
          {canAdd && (
            <button onClick={openCreate} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded px-4 py-2">
              <Plus size={16} /> Add Item
            </button>
          )}
        </div>

        {/* Search & Filter bar */}
        <div className="flex gap-2 mb-3">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search items..."
              className="pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 w-56" />
          </div>
          <select value={groupFilter} onChange={e => setGroupFilter(e.target.value)}
            className="border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400">
            <option value="">All Groups</option>
            {groups.map(g => <option key={g.id} value={String(g.id)}>{g.name}</option>)}
          </select>
        </div>

        {/* Items Table */}
        {loading ? (
          <div className="text-center py-10 text-gray-400">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-10 text-gray-400">No items found. Click "Add Item" to create one.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-[11px] text-gray-500 uppercase">
                  <th className="py-2.5 px-3 text-left w-[40px]">S.No</th>
                  <th className="py-2.5 px-3 text-left">Item Name</th>
                  <th className="py-2.5 px-3 text-left w-[110px]">Group</th>
                  <th className="py-2.5 px-3 text-left w-[110px]">Category</th>
                  <th className="py-2.5 px-3 text-left w-[110px]">Flavour</th>
                  <th className="py-2.5 px-3 text-center w-[70px]">Batch</th>
                  <th className="py-2.5 px-3 text-right w-[70px]">GST %</th>
                  <th className="py-2.5 px-3 text-left w-[90px]">HSN</th>
                  <th className="py-2.5 px-3 text-right w-[90px]">Op. Qty</th>
                  <th className="py-2.5 px-3 text-right w-[100px]">Op. Value</th>
                  <th className="py-2.5 px-3 text-center w-[100px]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item, idx) => (
                  <tr key={item.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="py-2.5 px-3 text-gray-500">{idx + 1}</td>
                    <td className="py-2.5 px-3 font-medium text-gray-800">{item.item_name}</td>
                    <td className="py-2.5 px-3 text-gray-600">{item.group_name || '-'}</td>
                    <td className="py-2.5 px-3 text-gray-600">{item.category_name || '-'}</td>
                    <td className="py-2.5 px-3 text-gray-600">{item.flavour_name || '-'}</td>
                    <td className="py-2.5 px-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${item.batch === 'Yes' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {item.batch}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right text-gray-600">{item.gst || '-'}</td>
                    <td className="py-2.5 px-3 text-gray-600">{item.hsn || '-'}</td>
                    <td className="py-2.5 px-3 text-right text-gray-600">{item.opening_qty ? Number(item.opening_qty).toFixed(3) : '-'}</td>
                    <td className="py-2.5 px-3 text-right text-gray-600">{item.opening_value ? `₹${Number(item.opening_value).toFixed(2)}` : '-'}</td>
                    <td className="py-2.5 px-3 text-center">
                      <div className="flex justify-center gap-2">
                        {canMod && <button onClick={() => openEdit(item)} className="text-blue-500 hover:text-blue-700 p-1" title="Edit"><Pencil size={16} /></button>}
                        {canDel && <button onClick={() => setDeleteTarget(item)} className="text-red-400 hover:text-red-600 p-1" title="Delete"><Trash2 size={16} /></button>}
                        {!canMod && !canDel && <span className="text-gray-300 text-xs italic">View only</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create / Edit Popup */}
      {showPopup && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center">
          <div className="bg-white rounded-lg shadow-xl p-5 w-[500px] max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-semibold text-gray-800">{editingItem ? 'Edit Item' : 'New Item'}</h3>
              <button onClick={() => setShowPopup(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              {/* Item Name */}
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Item Name *</label>
                <input type="text" value={form.item_name} onChange={e => setForm(f => ({ ...f, item_name: e.target.value }))}
                  className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400" autoFocus />
              </div>

              {/* Item Group | Item Category */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Item Group</label>
                  <div className="relative" ref={groupDropRef}>
                    <div className="flex items-center border border-gray-300 rounded overflow-hidden">
                      <input type="text" value={form.group_search}
                        onChange={e => { setForm(f => ({ ...f, group_search: e.target.value, item_group_id: null })); setGroupOpen(true); }}
                        onFocus={() => setGroupOpen(true)} placeholder="Search group..."
                        className="flex-1 text-sm py-1.5 px-2 focus:outline-none min-w-0" />
                      {form.item_group_id
                        ? <button onClick={() => setForm(f => ({ ...f, item_group_id: null, group_search: '' }))} className="px-2 text-gray-400 hover:text-gray-600"><X size={14} /></button>
                        : <span className="px-2 text-gray-400"><ChevronDown size={14} /></span>}
                    </div>
                    {groupOpen && groupOptions.length > 0 && (
                      <div className="absolute z-10 w-full bg-white border border-gray-200 rounded shadow-lg mt-1 max-h-40 overflow-y-auto">
                        {groupOptions.map(g => (
                          <div key={g.id} onMouseDown={() => { setForm(f => ({ ...f, item_group_id: g.id, group_search: g.name })); setGroupOpen(false); }}
                            className="px-3 py-2 text-sm hover:bg-blue-50 cursor-pointer">{g.name}</div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Item Category</label>
                  <select value={form.category_id ?? ''}
                    onChange={e => setForm(f => ({ ...f, category_id: e.target.value ? Number(e.target.value) : null }))}
                    className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400">
                    <option value="">-- None --</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Tally Flavour | Batch */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Tally Flavour</label>
                  <select value={form.tally_flavour_id ?? ''}
                    onChange={e => setForm(f => ({ ...f, tally_flavour_id: e.target.value ? Number(e.target.value) : null }))}
                    className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400">
                    <option value="">-- None --</option>
                    {flavours.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Batch</label>
                  <select value={form.batch} onChange={e => setForm(f => ({ ...f, batch: e.target.value as 'Yes' | 'No' }))}
                    className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400">
                    <option value="No">No</option>
                    <option value="Yes">Yes</option>
                  </select>
                </div>
              </div>

              {/* GST % | HSN */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">GST %</label>
                  <input type="number" min={0} value={form.gst}
                    onChange={e => setForm(f => ({ ...f, gst: e.target.value === '' ? '' : Number(e.target.value) }))}
                    placeholder="0" className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">HSN Code</label>
                  <input type="text" value={form.hsn} onChange={e => setForm(f => ({ ...f, hsn: e.target.value }))}
                    className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                </div>
              </div>

              {/* Opening Balance */}
              <div className="border-t border-gray-100 pt-3">
                <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">Opening Balance</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Opening Qty</label>
                    <input type="number" min={0} step="0.001" value={form.opening_qty}
                      onChange={e => handleQtyChange(e.target.value === '' ? '' : Number(e.target.value))}
                      onBlur={e => {
                        const qty = Number(e.target.value) || 0;
                        if (form.batch === 'Yes' && qty > 0) setShowBatchPopup(true);
                      }}
                      placeholder="0.000"
                      className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Opening Rate</label>
                    <input type="number" min={0} step="0.01" value={form.opening_rate}
                      onChange={e => handleRateChange(e.target.value === '' ? '' : Number(e.target.value))}
                      placeholder="0.00"
                      className={`w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400 ${form.batch === 'Yes' ? 'bg-gray-50 text-gray-400' : ''}`}
                      readOnly={form.batch === 'Yes'} />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Opening Value</label>
                    <input type="number" min={0} step="0.01" value={form.opening_value}
                      onChange={e => setForm(f => ({ ...f, opening_value: e.target.value === '' ? '' : Number(e.target.value) }))}
                      placeholder="0.00"
                      className={`w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400 ${form.batch === 'Yes' ? 'bg-gray-50 text-gray-400' : 'bg-yellow-50'}`}
                      readOnly={form.batch === 'Yes'} />
                  </div>
                </div>
                {/* Show summary when batch rows filled */}
                {form.batch === 'Yes' && batchRows.some(r => (Number(r.qty) || 0) > 0) && (
                  <button onClick={() => setShowBatchPopup(true)}
                    className="mt-2 w-full border border-dashed border-blue-400 text-blue-600 text-sm rounded py-1.5 hover:bg-blue-50 transition-colors">
                    Batch Details · {batchRows.filter(r => (Number(r.qty) || 0) > 0).length} rows · Total Qty: {batchTotalQty.toFixed(3)}
                  </button>
                )}
              </div>

              <button onClick={handleSave} disabled={saving}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium rounded py-2 mt-1">
                {saving ? 'Saving...' : editingItem ? 'Update Item' : 'Create Item'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch Entry Popup */}
      {showBatchPopup && (
        <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center">
          <div className="bg-white rounded-lg shadow-2xl w-[620px] max-h-[85vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">
                Batch Entry — <span className="text-blue-600">{form.item_name || 'Item'}</span>
              </h3>
              <button onClick={() => setShowBatchPopup(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-y-auto px-4 pt-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] text-gray-500 uppercase bg-gray-50">
                    <th className="py-1.5 px-2 text-left w-8">#</th>
                    <th className="py-1.5 px-2 text-left">Serial / Batch No.</th>
                    <th className="py-1.5 px-2 text-right w-24">Qty</th>
                    <th className="py-1.5 px-2 text-right w-24">Rate</th>
                    <th className="py-1.5 px-2 text-right w-28">Amount</th>
                    <th className="py-1.5 px-2 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {batchRows.map((row, idx) => (
                    <tr key={row.id} className="border-t border-gray-100">
                      <td className="py-1.5 px-2 text-gray-400 text-xs">{idx + 1}</td>
                      <td className="py-1.5 px-2">
                        <input type="text" value={row.batch_name}
                          onChange={e => updateBatchRow(row.id, 'batch_name', e.target.value)}
                          placeholder="Batch / Serial no."
                          className="w-full border border-gray-200 rounded text-sm py-1 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                      </td>
                      <td className="py-1.5 px-2">
                        <input type="number" min={0} step="0.001" value={row.qty}
                          onChange={e => updateBatchRow(row.id, 'qty', e.target.value)}
                          placeholder="0"
                          className="w-full border border-gray-200 rounded text-sm py-1 px-2 text-right focus:outline-none focus:ring-1 focus:ring-blue-400" />
                      </td>
                      <td className="py-1.5 px-2">
                        <input type="number" min={0} step="0.01" value={row.rate}
                          onChange={e => updateBatchRow(row.id, 'rate', e.target.value)}
                          placeholder="0"
                          className="w-full border border-gray-200 rounded text-sm py-1 px-2 text-right focus:outline-none focus:ring-1 focus:ring-blue-400" />
                      </td>
                      <td className="py-1.5 px-2">
                        <input type="number" min={0} step="0.01" value={row.amount}
                          onChange={e => updateBatchRow(row.id, 'amount', e.target.value)}
                          placeholder="0"
                          className="w-full border border-gray-200 rounded text-sm py-1 px-2 text-right focus:outline-none focus:ring-1 focus:ring-blue-400 bg-yellow-50" />
                      </td>
                      <td className="py-1.5 px-1 text-center">
                        {batchRows.length > 1 && (
                          <button onClick={() => setBatchRows(rows => rows.filter(r => r.id !== row.id))}
                            className="text-red-400 hover:text-red-600"><X size={14} /></button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button onClick={() => setBatchRows(rows => [...rows, emptyBatch()])}
                className="flex items-center gap-1 text-xs text-green-600 hover:text-green-800 mt-2 mb-1">
                <Plus size={12} /> Add Serial No.
              </button>
            </div>

            {/* Footer */}
            <div className="px-4 py-3 border-t border-gray-100 bg-gray-50 rounded-b-lg">
              {/* Qty match indicator */}
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm text-gray-600">
                  Total Qty: <span className={`font-semibold ${batchQtyMatch || targetQty === 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {batchTotalQty.toFixed(3)}
                  </span>
                  {targetQty > 0 && !batchQtyMatch && (
                    <span className="text-xs text-red-400 ml-2">(need {targetQty.toFixed(3)})</span>
                  )}
                  <span className="mx-3 text-gray-300">|</span>
                  Total Amt: <span className="font-semibold text-gray-800">₹{batchTotalAmt.toFixed(2)}</span>
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowBatchPopup(false)}
                  className="px-4 py-1.5 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-100">Cancel</button>
                <button
                  onClick={() => {
                    if (targetQty > 0 && !batchQtyMatch) {
                      showError('Qty Mismatch', `Total batch qty (${batchTotalQty.toFixed(3)}) must equal opening qty (${targetQty.toFixed(3)})`);
                      return;
                    }
                    // Sync opening_value and rate from batch totals
                    const avgRate = batchTotalQty > 0 ? batchTotalAmt / batchTotalQty : 0;
                    setForm(f => ({
                      ...f,
                      opening_qty: batchTotalQty || f.opening_qty,
                      opening_rate: parseFloat(avgRate.toFixed(2)),
                      opening_value: parseFloat(batchTotalAmt.toFixed(2)),
                    }));
                    setShowBatchPopup(false);
                  }}
                  disabled={targetQty > 0 && !batchQtyMatch}
                  className="px-4 py-1.5 text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 rounded font-medium">
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center">
          <div className="bg-white rounded-lg shadow-xl p-5 w-[380px]">
            <h3 className="font-semibold text-gray-800 mb-2">Delete Item</h3>
            <p className="text-sm text-gray-600 mb-4">
              Are you sure you want to delete <strong>{deleteTarget.item_name}</strong>? This action cannot be undone.
            </p>
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

export default Items;
