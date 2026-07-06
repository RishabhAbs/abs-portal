import React, { useEffect, useState, useRef } from 'react';
import { Search } from 'lucide-react';
import { groupChangeApi, resellersApi, customersApi } from '../services/api';
import { useToast } from '../components/Toast/Toast';

export default function GroupTransfer() {
  const { showSuccess, showError } = useToast();
  const [oldGroups, setOldGroups] = useState<any[]>([]);
  const [ledgerGroups, setLedgerGroups] = useState<any[]>([]);
  const [resellers, setResellers] = useState<any[]>([]);

  const [oldGroupId, setOldGroupId] = useState<string>('');
  const [newLedgerGroupId, setNewLedgerGroupId] = useState<string>('');
  const [resellerSearch, setResellerSearch] = useState('');
  const [resellerId, setResellerId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewRows, setPreviewRows] = useState<any[]>([]);
  const [previewTotal, setPreviewTotal] = useState<number | null>(null);
  // Customer list states
  const [customers, setCustomers] = useState<any[]>([]);
  const [custPage, setCustPage] = useState(1);
  const [custLimit, setCustLimit] = useState(25);
  const [custTotal, setCustTotal] = useState<number | null>(null);
  const [custSearch, setCustSearch] = useState('');
  const [custLoading, setCustLoading] = useState(false);

  const resellerRef = useRef<HTMLDivElement>(null);
  const [showResellerDropdown, setShowResellerDropdown] = useState(false);
  const oldGroupRef = useRef<HTMLDivElement>(null);
  const [oldGroupSearch, setOldGroupSearch] = useState('');
  const [showOldGroupDropdown, setShowOldGroupDropdown] = useState(false);

  useEffect(() => {
    // Fetch cloud users (old groups), ledger groups and resellers
    groupChangeApi.getUsers()
      .then(res => setOldGroups(res.data || []))
      .catch(() => showError('Load failed', 'Could not load old groups'));
    groupChangeApi.getLedgerGroups()
      .then(res => setLedgerGroups(res.data || []))
      .catch(() => showError('Load failed', 'Could not load ledger groups'));
    groupChangeApi.getResellers().then(res => setResellers(res.data || [])).catch(() => {});
  }, [showError]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (resellerRef.current && !resellerRef.current.contains(target)) setShowResellerDropdown(false);
      if (oldGroupRef.current && !oldGroupRef.current.contains(target)) setShowOldGroupDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filteredResellers = resellers.filter(r => !resellerSearch || (r.name || '').toLowerCase().includes(resellerSearch.toLowerCase()));

  const handleSubmit = async () => {
    if (!oldGroupId) return showError('Validation', 'Select old group');
    if (!newLedgerGroupId) return showError('Validation', 'Select destination ledger group');
    if (!window.confirm('Proceed with transferring ledgers from selected old group to the new ledger group?')) return;
    setSubmitting(true);
    try {
      const res = await groupChangeApi.transferLedgerGroup(oldGroupId, Number(newLedgerGroupId), resellerId ? Number(resellerId) : null);
      showSuccess('Done', res.message || `Transferred ${res.transferred || 0}`);
    } catch (err: any) { showError('Error', err.message || 'Transfer failed'); }
    finally { setSubmitting(false); }
  };

  const loadCustomers = async (page = custPage, limit = custLimit, search = custSearch) => {
    setCustLoading(true);
    try {
      const res = await customersApi.getAll(page, limit, search, 'all');
      setCustomers(res.data || []);
      setCustTotal(res.total ?? null);
      setCustPage(res.page || page);
      setCustLimit(res.limit || limit);
    } catch (err: any) {
      showError('Error', err.message || 'Failed to load customers');
    } finally {
      setCustLoading(false);
    }
  };

  useEffect(() => { loadCustomers(1, custLimit, custSearch); }, []);

  const handlePreview = async () => {
    if (!oldGroupId) return showError('Validation', 'Select old group');
    setPreviewLoading(true);
    try {
      const res = await groupChangeApi.previewLedgerGroup(oldGroupId, 500, resellerId ? Number(resellerId) : undefined);
      setPreviewRows(res.rows || []);
      setPreviewTotal(res.total ?? (res.rows || []).length);
    } catch (err: any) {
      showError('Error', err.message || 'Preview failed');
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <div className="space-y-4 pb-20">
      <h1 className="text-lg md:text-2xl font-bold text-gray-900 mt-2 px-1">Group Transfer (Ledger Group)</h1>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div ref={oldGroupRef} className="relative">
            <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Old Group</label>
            <input
              value={showOldGroupDropdown ? oldGroupSearch : (oldGroups.find(u => String(u.id) === String(oldGroupId))?.name || (oldGroupId ? `#${oldGroupId}` : '— Select Old Group —'))}
              onChange={e => { setOldGroupSearch(e.target.value); setShowOldGroupDropdown(true); setOldGroupId(''); }}
              onFocus={() => setShowOldGroupDropdown(true)}
              placeholder="Search cloud group"
              className="w-full py-2 px-3 border rounded-lg"
            />
            {showOldGroupDropdown && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border rounded shadow max-h-56 overflow-y-auto z-50">
                <div onClick={() => { setOldGroupId(''); setOldGroupSearch(''); setShowOldGroupDropdown(false); }} className="px-3 py-2 hover:bg-gray-50 cursor-pointer italic text-gray-500">— None / Remove —</div>
                {oldGroups.filter(g => !oldGroupSearch || (g.name || '').toLowerCase().includes(oldGroupSearch.toLowerCase()) || String(g.id).includes(oldGroupSearch)).length === 0 ? (
                  <div className="px-3 py-2 text-gray-400">No groups</div>
                ) : oldGroups.filter(g => !oldGroupSearch || (g.name || '').toLowerCase().includes(oldGroupSearch.toLowerCase()) || String(g.id).includes(oldGroupSearch)).map(g => (
                  <div key={g.id} onClick={() => { setOldGroupId(String(g.id)); setOldGroupSearch(''); setShowOldGroupDropdown(false); }} className="px-3 py-2 hover:bg-gray-50 cursor-pointer">{g.name} {g.old_id ? `(${g.old_id})` : ''} <span className="text-gray-400">#{g.id}</span></div>
                ))}
              </div>
            )}
          </div>

          <div ref={resellerRef} className="relative">
            <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Reseller (optional)</label>
            <input value={showResellerDropdown ? resellerSearch : (resellers.find(r => String(r.id) === String(resellerId))?.name || (resellerId ? `#${resellerId}` : '— None —'))}
              onChange={e => { setResellerSearch(e.target.value); setShowResellerDropdown(true); setResellerId(''); }}
              onFocus={() => setShowResellerDropdown(true)} className="w-full py-2 px-3 border rounded-lg" />
            {showResellerDropdown && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border rounded shadow max-h-56 overflow-y-auto z-50">
                <div onClick={() => { setResellerId(''); setResellerSearch(''); setShowResellerDropdown(false); }} className="px-3 py-2 hover:bg-gray-50 cursor-pointer italic text-gray-500">— None / Remove —</div>
                {filteredResellers.length === 0 ? (
                  <div className="px-3 py-2 text-gray-400">No resellers</div>
                ) : filteredResellers.map(r => (
                  <div key={r.id} onClick={() => { setResellerId(String(r.id)); setResellerSearch(''); setShowResellerDropdown(false); }} className="px-3 py-2 hover:bg-gray-50 cursor-pointer">{r.name}</div>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-600 uppercase mb-1">Destination Ledger Group</label>
            <select value={newLedgerGroupId} onChange={e => setNewLedgerGroupId(e.target.value)} className="w-full py-2 px-3 border rounded-lg">
              <option value="">-- Select Ledger Group --</option>
              {ledgerGroups.map(g => <option key={g.id} value={g.id}>{g.name || g.label || g.id}</option>)}
            </select>
          </div>
        </div>

        <div className="mt-3">
          <button onClick={handlePreview} disabled={previewLoading} className="mr-3 px-4 py-2 bg-gray-200 text-gray-800 rounded-lg font-bold hover:bg-gray-300 disabled:opacity-50">{previewLoading ? 'Previewing...' : 'Preview'}</button>
          <button onClick={handleSubmit} disabled={submitting} className="px-4 py-2 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 disabled:opacity-50">{submitting ? 'Processing...' : 'Transfer'}</button>
        </div>
      </div>

      {previewTotal !== null && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mt-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold">Preview — Affected customers: {previewTotal}</h2>
            <button onClick={() => { setPreviewTotal(null); setPreviewRows([]); }} className="text-sm text-gray-500">Clear</button>
          </div>
          <div className="mt-2 max-h-64 overflow-y-auto text-sm">
            {previewRows.length === 0 ? (
              <div className="text-gray-500 italic">No rows returned (server limit or none found).</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-600">
                    <th className="pr-4">ID</th>
                    <th className="pr-4">Company</th>
                    <th className="pr-4">LedgerGroup</th>
                    <th className="pr-4">Reseller</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map(r => (
                    <tr key={r.id} className="border-t">
                      <td className="py-1 pr-4">{r.id}</td>
                      <td className="py-1 pr-4">{r.company}</td>
                      <td className="py-1 pr-4">{r.ledgergroup}</td>
                      <td className="py-1 pr-4">{r.resellerid ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Customer List */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mt-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold">All Customers</h2>
          <div className="flex items-center gap-2">
            <input value={custSearch} onChange={e => setCustSearch(e.target.value)} placeholder="Search company / id" className="py-1 px-2 border rounded" />
            <button onClick={() => loadCustomers(1, custLimit, custSearch)} className="px-3 py-1 bg-gray-200 rounded">Search</button>
            <select value={custLimit} onChange={e => { setCustLimit(Number(e.target.value)); loadCustomers(1, Number(e.target.value), custSearch); }} className="py-1 px-2 border rounded">
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
          </div>
        </div>
        <div className="mt-3">
          {custLoading ? (
            <div className="text-gray-500">Loading...</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-600">
                  <th className="pr-4">ID</th>
                  <th className="pr-4">Company</th>
                  <th className="pr-4">Cloud Group</th>
                  <th className="pr-4">LedgerGroup</th>
                  <th className="pr-4">Reseller</th>
                </tr>
              </thead>
              <tbody>
                {customers.map(c => (
                  <tr key={c.id} className="border-t">
                    <td className="py-1 pr-4">{c.id}</td>
                    <td className="py-1 pr-4">{c.company}</td>
                    <td className="py-1 pr-4">{c.cloud_group_id ?? '—'}</td>
                    <td className="py-1 pr-4">{c.ledgergroup ?? '—'}</td>
                    <td className="py-1 pr-4">{c.resellerid ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="flex items-center justify-between mt-3">
            <div className="text-sm text-gray-600">{custTotal !== null ? `Total: ${custTotal}` : ''}</div>
            <div className="flex items-center gap-2">
              <button disabled={custPage <= 1} onClick={() => loadCustomers(custPage - 1, custLimit, custSearch)} className="px-3 py-1 border rounded disabled:opacity-50">Prev</button>
              <div className="px-2">Page {custPage}</div>
              <button disabled={custTotal !== null && custPage * custLimit >= custTotal} onClick={() => loadCustomers(custPage + 1, custLimit, custSearch)} className="px-3 py-1 border rounded disabled:opacity-50">Next</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
