import React, { useState, useEffect, useRef } from 'react';
import { Plus, Pencil, Trash2, X, ChevronDown, Search, FileText } from 'lucide-react';
import { ledgerGroupApi, otherLedgerApi, customersApi, vouchersApi } from '../services/api';
import { useToast } from '../components/Toast/Toast';
import { useAuth } from '../context/AuthContext';

const PAGE_SIZE = 25;

interface LedgerGroup { id: number; name: string; }
interface LedgerItem {
  id: number;
  company: string;
  ledgergroup: number;
  ledgergroup_name?: string;
  opening_balance?: number;
  opening_balance_type?: 'Dr' | 'Cr';
  billbybill?: 'Yes' | 'No';
}

const OtherLedger: React.FC = () => {
  const { showSuccess, showError } = useToast();
  const { canCreate, canEdit, canDelete } = useAuth();
  const canAdd = canCreate('other_ledgers');
  const canMod = canEdit('other_ledgers');
  const canDel = canDelete('other_ledgers');
  // Sundry Debtors group id — parties must be created via Customers page,
  // never from this screen.
  const SUNDRY_DEBTORS_ID = 26;
  const [items, setItems] = useState<LedgerItem[]>([]);
  const [ledgerGroups, setLedgerGroups] = useState<LedgerGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // Modal state — same modal handles Create + Edit. In Edit mode `editing`
  // holds the row, name field is read-only, and group/opening balance can
  // change. In Create mode `editing` is null, `creating` is true, and the
  // user enters a name + picks a (non-Sundry-Debtor) group.
  const [editing, setEditing] = useState<LedgerItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: '',
    ledgergroup_id: null as number | null,
    group_search: '',
    opening_balance: 0,
    opening_balance_type: 'Dr' as 'Dr' | 'Cr',
    billbybill: 'No' as 'Yes' | 'No',
  });
  const [saving, setSaving] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const groupRef = useRef<HTMLDivElement>(null);

  const [deleteTarget, setDeleteTarget] = useState<LedgerItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Opening-balance bill allocation popup. `openingBills` is the editable
  // list (Type / Ref / Date / Amount / Cr or Dr) and is loaded from the
  // backend whenever the user opens an existing ledger. Saved on submit.
  type OpeningBill = {
    id: string;       // local UI key
    type: 'New' | 'Agst' | 'On Account';
    bill_name: string;
    bill_date: string;
    amount: number;
    refOpen?: boolean; // when the pending-refs dropdown is open for this row
  };
  const [openingAllocOpen, setOpeningAllocOpen] = useState(false);
  const [openingBills, setOpeningBills]         = useState<OpeningBill[]>([]);
  const [openingAllocSaving, setOpeningAllocSaving] = useState(false);
  // Pending refs (existing bills against this ledger, e.g. from prior
  // voucher entries). Fetched once when the popup opens; the dropdown
  // filters the cached list client-side per row.
  const [pendingRefs, setPendingRefs] = useState<Array<{ billname: string; amount: number; vch_date: string; vch_no: string }>>([]);

  const uid = () => Math.random().toString(36).slice(2);
  const blankOpeningBill = (): OpeningBill => ({
    id: uid(), type: 'New', bill_name: '', bill_date: new Date().toISOString().slice(0, 10), amount: 0,
  });

  const openOpeningAlloc = async () => {
    if (!editing?.id) return;
    try {
      const [allocRes, refRes] = await Promise.all([
        customersApi.getOpeningBills(String(editing.id)),
        // Pending refs feed the typeahead dropdown — populated mostly by
        // any prior voucher-side bill allocations against this ledger.
        // For a brand-new ledger this will return an empty list and the
        // dropdown shows "No pending bills found".
        vouchersApi.getPendingRefs(editing.id, form.opening_balance_type === 'Cr' ? 'Cr' : 'Dr')
          .catch(() => ({ success: false, data: [] as any[] })),
      ]);
      const existing = allocRes.success && allocRes.data?.bills?.length
        ? allocRes.data.bills.map((b: any) => ({
            id: uid(),
            type: (b.ref_type === 'On Account' ? 'On Account' : 'New') as OpeningBill['type'],
            bill_name: b.bill_name || '',
            bill_date: b.bill_date ? String(b.bill_date).split('T')[0] : '',
            amount: Number(b.amount) || 0,
          }))
        : [{ ...blankOpeningBill(), amount: form.opening_balance }];
      setOpeningBills(existing);
      setPendingRefs(refRes?.data || []);
      setOpeningAllocOpen(true);
    } catch {
      showError('Error', 'Failed to load opening allocation');
    }
  };

  const openingAllocated = openingBills.reduce((s, b) => s + (Number(b.amount) || 0), 0);
  const openingAllocBalanced = Math.abs(openingAllocated - form.opening_balance) < 0.01;

  const saveOpeningAlloc = async () => {
    if (!editing?.id) return;
    if (!openingAllocBalanced) {
      showError('Validation', `Allocated ${openingAllocated.toFixed(2)} doesn't match opening ${form.opening_balance.toFixed(2)}`);
      return;
    }
    if (openingBills.some(b => !b.bill_name.trim() && b.amount > 0)) {
      showError('Validation', 'Each row needs a bill / reference number');
      return;
    }
    setOpeningAllocSaving(true);
    try {
      await customersApi.saveOpeningBills(String(editing.id),
        openingBills
          .filter(b => b.bill_name.trim() && Number(b.amount) > 0)
          .map(b => ({
            bill_name: b.bill_name.trim(),
            bill_date: b.bill_date || null,
            amount:    Number(b.amount) || 0,
            ref_type:  b.type === 'On Account' ? 'On Account' : 'Bill',
          })),
      );
      showSuccess('Saved', 'Opening balance bill allocation saved');
      setOpeningAllocOpen(false);
    } catch (e: any) {
      showError('Error', e?.message || 'Failed to save allocation');
    } finally { setOpeningAllocSaving(false); }
  };

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [ledRes, itemRes] = await Promise.all([
        ledgerGroupApi.getAll(),
        otherLedgerApi.getAll(),
      ]);
      if (ledRes.success) setLedgerGroups(ledRes.data);
      if (itemRes.success) setItems(itemRes.data);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (groupRef.current && !groupRef.current.contains(e.target as Node)) setGroupOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = items.filter(i =>
    i.company.toLowerCase().includes(search.toLowerCase()) ||
    (i.ledgergroup_name || '').toLowerCase().includes(search.toLowerCase())
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // Group dropdown — in Create mode hide Sundry Debtors so the user can't
  // pick it. (Edit mode keeps the option visible only because an existing
  // party row with group=26 should still display its current group when
  // opened, but the backend rejects creating new ones.)
  const groupOptions = ledgerGroups
    .filter(g => !creating || g.id !== SUNDRY_DEBTORS_ID)
    .filter(g => g.name.toLowerCase().includes(form.group_search.toLowerCase()));

  const selectGroup = (g: LedgerGroup) => {
    setForm(f => ({ ...f, ledgergroup_id: g.id, group_search: g.name }));
    setGroupOpen(false);
  };

  const openCreate = () => {
    setEditing(null);
    setCreating(true);
    setForm({
      name: '',
      ledgergroup_id: null,
      group_search: '',
      opening_balance: 0,
      opening_balance_type: 'Dr',
      billbybill: 'No',
    });
  };

  const openEdit = (item: LedgerItem) => {
    const grp = ledgerGroups.find(g => g.id === item.ledgergroup);
    setEditing(item);
    setCreating(false);
    setForm({
      name: item.company,
      ledgergroup_id: item.ledgergroup,
      group_search: grp?.name || '',
      opening_balance: item.opening_balance ?? 0,
      opening_balance_type: item.opening_balance_type ?? 'Dr',
      billbybill: item.billbybill === 'Yes' ? 'Yes' : 'No',
    });
  };

  const closeModal = () => { setEditing(null); setCreating(false); };

  const handleSave = async () => {
    if (!form.ledgergroup_id) { showError('Validation', 'Ledger group is required'); return; }
    if (creating) {
      if (!form.name.trim()) { showError('Validation', 'Name is required'); return; }
      if (form.ledgergroup_id === SUNDRY_DEBTORS_ID) {
        showError('Not allowed', 'Sundry Debtors must be created from the Customers page.');
        return;
      }
    }
    setSaving(true);
    try {
      if (creating) {
        const res = await otherLedgerApi.create({
          company: form.name.trim(),
          ledgergroup: form.ledgergroup_id,
          opening_balance: form.opening_balance,
          opening_balance_type: form.opening_balance_type,
          billbybill: form.billbybill,
        });
        if (res.success) {
          showSuccess('Created', `${form.name.trim()} added`);
          closeModal();
          fetchAll();
        }
      } else if (editing) {
        const res = await otherLedgerApi.update(editing.id, {
          ledgergroup: form.ledgergroup_id,
          opening_balance: form.opening_balance,
          opening_balance_type: form.opening_balance_type,
          billbybill: form.billbybill,
        });
        if (res.success) {
          showSuccess('Saved', `${editing.company} updated`);
          closeModal();
          fetchAll();
        }
      }
    } catch (e: any) { showError('Error', e.message || 'Failed'); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await otherLedgerApi.delete(deleteTarget.id);
      if (res.success) {
        showSuccess('Deleted', `${deleteTarget.company} removed`);
        setDeleteTarget(null);
        fetchAll();
      }
    } catch (e: any) { showError('Error', e.message || 'Failed to delete'); }
    finally { setDeleting(false); }
  };

  const pageNums = Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter(p => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
    .reduce<(number | string)[]>((acc, p, i, arr) => {
      if (i > 0 && (p as number) - (arr[i - 1] as number) > 1) acc.push('...');
      acc.push(p);
      return acc;
    }, []);

  const formatBalance = (item: LedgerItem) => {
    const bal = Number(item.opening_balance ?? 0);
    if (!bal) return <span className="text-gray-300">—</span>;
    const type = item.opening_balance_type ?? 'Dr';
    return (
      <span className={`tabular-nums font-medium ${type === 'Cr' ? 'text-emerald-700' : 'text-red-600'}`}>
        ₹{bal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        <span className="text-[11px] text-gray-400 font-normal ml-1">{type}</span>
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-gray-100 p-3">
      <div className="bg-white rounded-lg shadow p-4 w-full">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-lg font-semibold text-gray-800">Ledgers</h1>
          <div className="flex items-center gap-3">
            <div className="text-xs text-gray-500 hidden md:block">
              Click any row to edit its <span className="font-semibold">group</span> or <span className="font-semibold">opening balance</span>.
            </div>
            {canAdd && (
              <button onClick={openCreate}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded px-4 py-2">
                <Plus size={16} /> Create Ledger
              </button>
            )}
          </div>
        </div>

        <div className="relative mb-3 max-w-sm">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search ledgers / groups…"
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400" />
        </div>

        {loading ? (
          <div className="text-center py-10 text-gray-400">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-10 text-gray-400">No ledgers found.</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-[11px] text-gray-500 uppercase">
                    <th className="py-2.5 px-3 text-left w-[60px]">S.No</th>
                    <th className="py-2.5 px-3 text-left">Name</th>
                    <th className="py-2.5 px-3 text-left w-[260px]">Ledger Group</th>
                    <th className="py-2.5 px-3 text-center w-[110px]">Bill by Bill</th>
                    <th className="py-2.5 px-3 text-right w-[180px]">Opening Balance</th>
                    <th className="py-2.5 px-3 text-center w-[110px]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((item, idx) => (
                    <tr key={item.id}
                      onClick={() => canMod && openEdit(item)}
                      className={`border-t border-gray-100 ${canMod ? 'hover:bg-blue-50 cursor-pointer' : ''}`}>
                      <td className="py-2.5 px-3 text-gray-400 tabular-nums">{(safePage - 1) * PAGE_SIZE + idx + 1}</td>
                      <td className="py-2.5 px-3 font-medium text-gray-800">{item.company}</td>
                      <td className="py-2.5 px-3 text-gray-600">{item.ledgergroup_name || '—'}</td>
                      <td className="py-2.5 px-3 text-center text-gray-700">
                        {item.billbybill === 'Yes' ? 'Yes' : 'No'}
                      </td>
                      <td className="py-2.5 px-3 text-right">{formatBalance(item)}</td>
                      <td className="py-2.5 px-3 text-center" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-center gap-2">
                          {canMod && <button onClick={() => openEdit(item)} title="Edit"
                            className="text-blue-500 hover:text-blue-700 p-1"><Pencil size={15} /></button>}
                          {canDel && <button onClick={() => setDeleteTarget(item)} title="Delete"
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
                <span>{filtered.length} ledger{filtered.length !== 1 ? 's' : ''} · Page {safePage} of {totalPages}</span>
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

      {/* Create / Edit Popup */}
      {(editing || creating) && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center" onClick={closeModal}>
          <div className="bg-white rounded-lg shadow-xl p-5 w-[440px]" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="font-semibold text-gray-800">{creating ? 'Create Ledger' : 'Edit Ledger'}</h3>
                {editing && <p className="text-sm text-gray-500 truncate max-w-[340px]">{editing.company}</p>}
                {creating && <p className="text-xs text-amber-700">Sundry Debtors must be created from the Customers page.</p>}
              </div>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              {creating && (
                <div>
                  <label className="block text-xs text-gray-500 mb-0.5">Name *</label>
                  <input type="text" value={form.name} autoFocus
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Bank Charges, Office Rent…"
                    className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                </div>
              )}
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Ledger Group *</label>
                <div className="relative" ref={groupRef}>
                  <div className="flex items-center border border-gray-300 rounded overflow-hidden">
                    <input type="text" value={form.group_search}
                      onChange={e => { setForm(f => ({ ...f, group_search: e.target.value, ledgergroup_id: null })); setGroupOpen(true); }}
                      onFocus={() => setGroupOpen(true)}
                      placeholder="Search & select group…"
                      className="flex-1 text-sm py-1.5 px-2 focus:outline-none" />
                    <span className="px-2 text-gray-400"><ChevronDown size={14} /></span>
                  </div>
                  {groupOpen && groupOptions.length > 0 && (
                    <div className="absolute z-10 w-full bg-white border border-gray-200 rounded shadow-lg mt-1 max-h-48 overflow-y-auto">
                      {groupOptions.map(g => (
                        <div key={g.id} onMouseDown={() => selectGroup(g)}
                          className={`px-3 py-2 text-sm cursor-pointer ${form.ledgergroup_id === g.id ? 'bg-blue-100 text-blue-700' : 'hover:bg-blue-50'}`}>
                          {g.name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Bill-by-bill toggle. When Yes, vouchers against this ledger
                  must be allocated to a specific bill (so outstanding works
                  per-invoice). When No, the ledger is treated as a running
                  balance — appropriate for Sales / Bank / GST / Roundoff.
                  Sits ABOVE Opening Balance so the user knows whether the
                  opening will need a bill split before they enter the value. */}
              <div className="border-t border-gray-100 pt-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Bill by Bill</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">Track outstanding per invoice for this ledger.</p>
                  </div>
                  <div className="flex border border-gray-300 rounded overflow-hidden text-sm">
                    <button type="button"
                      onClick={() => setForm(f => ({ ...f, billbybill: 'Yes' }))}
                      className={`px-4 py-1.5 font-medium transition-colors ${form.billbybill === 'Yes' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>Yes</button>
                    <button type="button"
                      onClick={() => setForm(f => ({ ...f, billbybill: 'No' }))}
                      className={`px-4 py-1.5 font-medium transition-colors ${form.billbybill === 'No' ? 'bg-gray-700 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>No</button>
                  </div>
                </div>
              </div>

              <div className="border-t border-gray-100 pt-3">
                <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">Opening Balance</p>
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-0.5">Amount</label>
                    <input
                      type="number" min={0} step="0.01"
                      value={form.opening_balance}
                      onChange={e => setForm(f => ({ ...f, opening_balance: Number(e.target.value) }))}
                      onBlur={() => {
                        // When billbybill=Yes and the user has set a non-zero
                        // opening, auto-open the bill allocation popup so
                        // they can split it into invoices in one flow.
                        if (form.billbybill === 'Yes' && form.opening_balance > 0 && editing?.id && !openingAllocOpen) {
                          openOpeningAlloc();
                        }
                      }}
                      className="w-full border border-gray-300 rounded text-sm py-1.5 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400 tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Type</label>
                    <div className="flex border border-gray-300 rounded overflow-hidden text-sm">
                      <button type="button"
                        onClick={() => setForm(f => ({ ...f, opening_balance_type: 'Dr' }))}
                        className={`px-4 py-1.5 font-medium transition-colors ${form.opening_balance_type === 'Dr' ? 'bg-red-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>Dr</button>
                      <button type="button"
                        onClick={() => setForm(f => ({ ...f, opening_balance_type: 'Cr' }))}
                        className={`px-4 py-1.5 font-medium transition-colors ${form.opening_balance_type === 'Cr' ? 'bg-green-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>Cr</button>
                    </div>
                  </div>
                </div>
                {/* Bill-allocation handle — only shown for billbybill=Yes
                    ledgers that have already been saved (we need a real id
                    to attach the allocation to). Brand-new ledgers see a
                    hint instead. */}
                {form.billbybill === 'Yes' && form.opening_balance > 0 && (
                  <div className="mt-2">
                    {editing?.id ? (
                      <button type="button" onClick={openOpeningAlloc}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border ${
                          openingAllocBalanced
                            ? 'border-green-300 bg-green-50 text-green-700 hover:bg-green-100'
                            : 'border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100'
                        }`}>
                        <FileText size={12} />
                        {openingAllocBalanced
                          ? `Bill allocated: ₹${form.opening_balance.toLocaleString('en-IN')}`
                          : 'Allocate opening to bills'}
                      </button>
                    ) : (
                      <p className="text-[11px] text-gray-500 italic">Save the ledger first, then re-open to allocate the opening balance to specific bills.</p>
                    )}
                  </div>
                )}
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

      {/* Opening-balance bill allocation popup. Mirrors the voucher's Bill
          Allocation modal layout (#, Type, Ref / Bill No., Date, Amount,
          Cr/Dr) so the user gets the same flow they already know from the
          voucher entry form. */}
      {openingAllocOpen && editing && (
        <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl">
            <div className="flex justify-between items-center px-5 py-3 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">
                Bill Allocation — Opening Balance
                <span className="ml-2 text-sm font-normal text-gray-500">{editing.company}</span>
              </h3>
              <button onClick={() => setOpeningAllocOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>

            <div className="p-5">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-[11px] text-gray-500 uppercase">
                  <tr>
                    <th className="py-2 px-2 text-left w-10">#</th>
                    <th className="py-2 px-2 text-left w-32">Type</th>
                    <th className="py-2 px-2 text-left">Ref / Bill No.</th>
                    <th className="py-2 px-2 text-left w-36">Date</th>
                    <th className="py-2 px-2 text-right w-28">Amount</th>
                    <th className="py-2 px-2 text-center w-16">Cr/Dr</th>
                    <th className="py-2 px-2 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {openingBills.map((row, idx) => (
                    <tr key={row.id} className="border-t border-gray-100">
                      <td className="py-1.5 px-2 text-gray-400 text-xs">{idx + 1}</td>
                      <td className="py-1.5 px-1">
                        <select value={row.type}
                          onChange={e => setOpeningBills(p => p.map(r => r.id === row.id ? { ...r, type: e.target.value as OpeningBill['type'] } : r))}
                          className="w-full border border-gray-200 rounded text-sm py-1 px-1 focus:outline-none focus:ring-1 focus:ring-blue-400">
                          <option value="New">New</option>
                          <option value="Agst">Agst</option>
                          <option value="On Account">On Account</option>
                        </select>
                      </td>
                      <td className="py-1.5 px-1 relative">
                        <input type="text" value={row.bill_name}
                          onFocus={() => setOpeningBills(p => p.map(r => r.id === row.id ? { ...r, refOpen: true } : { ...r, refOpen: false }))}
                          onBlur={() => setTimeout(() => setOpeningBills(p => p.map(r => r.id === row.id ? { ...r, refOpen: false } : r)), 200)}
                          onChange={e => setOpeningBills(p => p.map(r => r.id === row.id ? { ...r, bill_name: e.target.value, refOpen: true } : r))}
                          placeholder="e.g. INV-001"
                          className="w-full border border-gray-200 rounded text-sm py-1 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                        {/* Pending-refs dropdown — filtered client-side
                            against the cache pulled when the popup opened.
                            Click to fill the row from an existing bill;
                            otherwise the user just types a fresh ref. */}
                        {row.refOpen && (() => {
                          const q = (row.bill_name || '').trim().toLowerCase();
                          const filtered = pendingRefs
                            .filter(r => !openingBills.some(b => b.id !== row.id && b.bill_name === r.billname))
                            .filter(r => !q || r.billname.toLowerCase().includes(q))
                            .slice(0, 8);
                          return (
                            <div className="absolute top-full left-1 right-1 mt-1 bg-white border border-gray-200 rounded shadow-lg z-10 max-h-56 overflow-auto">
                              <div className="grid grid-cols-[1fr_88px_88px_44px] gap-2 px-3 py-1.5 bg-gray-50 border-b border-gray-100 text-[10px] font-semibold text-gray-500 uppercase">
                                <span>Bill No.</span>
                                <span>Date</span>
                                <span className="text-right">Amount</span>
                                <span className="text-center">Cr/Dr</span>
                              </div>
                              {filtered.length === 0 ? (
                                <div className="px-3 py-3 text-[12px] text-gray-400 italic text-center">No pending bills found</div>
                              ) : filtered.map((r, idx) => {
                                const drcr = Number(r.amount) >= 0 ? 'Dr' : 'Cr';
                                const dt = r.vch_date ? new Date(r.vch_date) : null;
                                const dtStr = dt ? `${String(dt.getDate()).padStart(2, '0')}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getFullYear()).slice(2)}` : '—';
                                return (
                                  <button key={`${r.billname}-${idx}`} type="button"
                                    onMouseDown={e => {
                                      e.preventDefault();
                                      setOpeningBills(p => p.map(x => x.id === row.id ? {
                                        ...x,
                                        type: 'Agst',
                                        bill_name: r.billname,
                                        bill_date: r.vch_date ? String(r.vch_date).split('T')[0] : x.bill_date,
                                        amount: Math.abs(Number(r.amount) || 0),
                                        refOpen: false,
                                      } : x));
                                    }}
                                    className="w-full text-left grid grid-cols-[1fr_88px_88px_44px] gap-2 px-3 py-1.5 hover:bg-blue-50 text-[12px] border-b border-gray-50 last:border-b-0">
                                    <span className="font-medium text-gray-800 truncate">{r.billname}</span>
                                    <span className="text-gray-500 tabular-nums">{dtStr}</span>
                                    <span className="text-right tabular-nums">{Math.abs(Number(r.amount) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                                    <span className={`text-center text-[10px] font-semibold ${drcr === 'Dr' ? 'text-red-600' : 'text-green-600'}`}>{drcr}</span>
                                  </button>
                                );
                              })}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="py-1.5 px-1">
                        <input type="date" value={row.bill_date}
                          onChange={e => setOpeningBills(p => p.map(r => r.id === row.id ? { ...r, bill_date: e.target.value } : r))}
                          className="w-full border border-gray-200 rounded text-sm py-1 px-2 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                      </td>
                      <td className="py-1.5 px-1">
                        <input type="number" step="any" value={row.amount || ''}
                          onChange={e => setOpeningBills(p => p.map(r => r.id === row.id ? { ...r, amount: Number(e.target.value) || 0 } : r))}
                          className="w-full border border-gray-200 rounded text-sm py-1 px-2 text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-blue-400" />
                      </td>
                      <td className="py-1.5 px-1 text-center">
                        <span className={`inline-block px-2 py-0.5 text-[11px] font-semibold rounded border ${
                          form.opening_balance_type === 'Dr'
                            ? 'border-red-300 bg-red-50 text-red-700'
                            : 'border-green-300 bg-green-50 text-green-700'
                        }`}>
                          {form.opening_balance_type}
                        </span>
                      </td>
                      <td className="py-1.5 px-1 text-center">
                        {openingBills.length > 1 && (
                          <button onClick={() => setOpeningBills(p => p.filter(r => r.id !== row.id))}
                            className="text-red-400 hover:text-red-600"><X size={14} /></button>
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-gray-100">
                    <td colSpan={7} className="py-1.5 px-2">
                      <button onClick={() => setOpeningBills(p => [...p, blankOpeningBill()])}
                        className="flex items-center gap-1 text-xs text-green-600 hover:text-green-800">
                        <Plus size={12} /> Add Reference
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-gray-100 bg-gray-50 text-[13px]">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                <div>
                  <span className="text-gray-500">Grand Total:</span>{' '}
                  <strong className="tabular-nums">{form.opening_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong>
                  <span className={`ml-1 text-xs ${form.opening_balance_type === 'Dr' ? 'text-red-600' : 'text-green-600'}`}>{form.opening_balance_type}.</span>
                </div>
                <div>
                  <span className="text-gray-500">Allocated:</span>{' '}
                  <strong className={`tabular-nums ${openingAllocBalanced ? 'text-green-700' : 'text-orange-600'}`}>
                    {openingAllocated.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </strong>
                </div>
                <div>
                  <span className="text-gray-500">Balance:</span>{' '}
                  <strong className={`tabular-nums ${openingAllocBalanced ? 'text-green-700' : 'text-red-600'}`}>
                    {(form.opening_balance - openingAllocated).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </strong>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setOpeningAllocOpen(false)}
                  className="px-4 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50">
                  Cancel
                </button>
                <button onClick={saveOpeningAlloc} disabled={openingAllocSaving || !openingAllocBalanced}
                  className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded">
                  {openingAllocSaving ? 'Saving…' : 'Done'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center" onClick={() => setDeleteTarget(null)}>
          <div className="bg-white rounded-lg shadow-xl p-5 w-[400px]" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-800 mb-2">Delete Ledger</h3>
            <p className="text-sm text-gray-600 mb-4">
              Delete <strong>{deleteTarget.company}</strong>? This cannot be undone.
              {deleteTarget.ledgergroup === 26 && (
                <span className="block mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                  Sundry Debtor (party) ledgers can't be deleted from here — manage them in the Customers page.
                </span>
              )}
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

export default OtherLedger;
