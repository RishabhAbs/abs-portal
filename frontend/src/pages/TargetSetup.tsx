import React, { useState, useEffect, useMemo } from 'react';
import { targetsApi, usersApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast/Toast';
import { CheckCircle, Clock, Edit3, Save, X, ChevronDown, Hash, IndianRupee } from 'lucide-react';

const MONTHS = ['April','May','June','July','August','September','October','November','December','January','February','March'];
const TYPES = [
  { key: 'new_target', label: 'New' },
  { key: 'tss',        label: 'TSS' },
  { key: 'cloud',      label: 'Cloud' },
  { key: 'tdl',        label: 'TDL' },
  { key: 'app',        label: 'App' },
  { key: 'visit',      label: 'Visit' },
  { key: 'call',       label: 'Call' },
];

type UnitType = 'qty' | 'amount';

function currentFY() {
  const now = new Date();
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${year}-${String(year + 1).slice(2)}`;
}

function fyOptions() {
  const base = new Date().getFullYear();
  return [-1, 0, 1].map(offset => {
    const y = base + offset;
    return `${y}-${String(y + 1).slice(2)}`;
  });
}

// Convert flat rows [{month, new_target, tss,...}] → grid [type][month]
function rowsToGrid(rows: any[]) {
  const grid: Record<string, Record<string, number>> = {};
  for (const t of TYPES) grid[t.key] = {};
  for (const row of rows) {
    for (const t of TYPES) {
      grid[t.key][row.month] = row[t.key] || 0;
    }
  }
  return grid;
}

// Convert grid back to rows
function gridToRows(grid: Record<string, Record<string, number>>, rowMeta: Record<string, any>) {
  return MONTHS.map(month => {
    const row: any = { month };
    for (const t of TYPES) row[t.key] = grid[t.key]?.[month] || 0;
    if (rowMeta[month]?.id) row.id = rowMeta[month].id;
    return row;
  });
}

// Format a value for display based on unit type
function fmtValue(val: number, unit: UnitType): string {
  if (unit === 'amount') {
    if (!val) return '₹0';
    if (val >= 10000000) return `₹${(val / 10000000).toFixed(1)}Cr`;
    if (val >= 100000)   return `₹${(val / 100000).toFixed(1)}L`;
    if (val >= 1000)     return `₹${(val / 1000).toFixed(0)}K`;
    return `₹${val}`;
  }
  return String(val || 0);
}

// Format row total (amount types show abbreviated ₹)
function fmtTotal(val: number, unit: UnitType): string {
  return fmtValue(val, unit);
}

const statusBadge = (status: string) => {
  if (status === 'Approved') return <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-700">Approved</span>;
  if (status === 'Pending')  return <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-700">Pending</span>;
  return <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-gray-100 text-gray-500">Draft</span>;
};

const TargetSetup: React.FC = () => {
  const { user, isAdmin } = useAuth();
  const { showSuccess, showError } = useToast();
  const admin = isAdmin();

  const [fy, setFy] = useState(currentFY());
  const [selectedUser, setSelectedUser] = useState<string>(admin ? '' : (user?.name || ''));
  const [users, setUsers] = useState<any[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);

  // grid[typeKey][month] = value
  const [grid, setGrid] = useState<Record<string, Record<string, number>>>(() => rowsToGrid([]));
  // rowMeta[month] = { id, status }
  const [rowMeta, setRowMeta] = useState<Record<string, any>>({});
  // unitTypes[typeKey] = 'qty' | 'amount'
  const [unitTypes, setUnitTypes] = useState<Record<string, UnitType>>(() =>
    Object.fromEntries(TYPES.map(t => [t.key, 'qty' as UnitType]))
  );

  // Admin: user selector
  useEffect(() => {
    if (admin) {
      usersApi.getBasic().then(res => setUsers(Array.isArray(res) ? res : res?.data || [])).catch(() => {});
    }
  }, []);

  // Fetch targets + unit types when fy or selectedUser changes
  const fetchTargets = async () => {
    const uName = admin ? selectedUser : user?.name;
    if (!uName && !admin) return;
    setLoading(true);
    try {
      const [res, unitRes] = await Promise.all([
        targetsApi.get(fy, uName || undefined),
        uName ? targetsApi.getUnitTypes(fy, uName) : Promise.resolve({ data: {} }),
      ]);
      const data: any[] = res?.data || [];
      setRows(data);
      setGrid(rowsToGrid(data));
      const meta: Record<string, any> = {};
      for (const r of data) meta[r.month] = { id: r.id, status: r.status };
      setRowMeta(meta);

      // Merge fetched unit types with defaults (all 'qty')
      const fetched: Record<string, string> = unitRes?.data || {};
      setUnitTypes(Object.fromEntries(
        TYPES.map(t => [t.key, (fetched[t.key] as UnitType) || 'qty'])
      ));
    } catch {
      setRows([]); setGrid(rowsToGrid([]));
      setUnitTypes(Object.fromEntries(TYPES.map(t => [t.key, 'qty' as UnitType])));
    } finally { setLoading(false); setEditMode(false); }
  };

  useEffect(() => { fetchTargets(); }, [fy, selectedUser]);

  const handleCell = (typeKey: string, month: string, val: string) => {
    const n = parseInt(val) || 0;
    setGrid(prev => ({ ...prev, [typeKey]: { ...prev[typeKey], [month]: n } }));
  };

  const toggleUnit = (typeKey: string) => {
    setUnitTypes(prev => ({ ...prev, [typeKey]: prev[typeKey] === 'qty' ? 'amount' : 'qty' }));
  };

  // Row totals (per type, across all months)
  const rowTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const t of TYPES) {
      totals[t.key] = MONTHS.reduce((s, m) => s + (grid[t.key]?.[m] || 0), 0);
    }
    return totals;
  }, [grid]);

  // Overall status
  const overallStatus = useMemo(() => {
    const statuses = Object.values(rowMeta).map((m: any) => m?.status).filter(Boolean);
    if (!statuses.length) return null;
    if (statuses.every(s => s === 'Approved')) return 'Approved';
    if (statuses.some(s => s === 'Pending')) return 'Pending';
    return 'Draft';
  }, [rowMeta]);

  const handleSave = async () => {
    const uName = admin ? selectedUser : user?.name;
    if (!uName) { showError('Error', 'Select a user'); return; }
    setSaving(true);
    try {
      const payload = gridToRows(grid, rowMeta);
      // Save unit types first (stored on user_targets rows)
      await targetsApi.saveUnitTypes(uName, fy, unitTypes);
      // Then save grid
      if (admin) {
        await targetsApi.adminCreate(uName, fy, payload);
        showSuccess('Saved', 'Targets set and approved');
      } else {
        await targetsApi.save(fy, payload);
        showSuccess('Submitted', 'Targets submitted for admin approval');
      }
      await fetchTargets();
    } catch (e: any) {
      showError('Error', e.message || 'Failed to save');
    } finally { setSaving(false); }
  };

  const handleApproveAll = async () => {
    const uName = selectedUser;
    if (!uName) return;
    setSaving(true);
    try {
      await targetsApi.approveAll(uName, fy);
      showSuccess('Approved', 'All pending targets approved');
      await fetchTargets();
    } catch (e: any) {
      showError('Error', e.message || 'Failed');
    } finally { setSaving(false); }
  };

  const hasPending = Object.values(rowMeta).some((m: any) => m?.status === 'Pending');

  return (
    <div className="flex flex-col min-h-[calc(100dvh-64px)] bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-bold text-gray-900">Target Setup</h1>
          {overallStatus && statusBadge(overallStatus)}

          {/* FY Selector */}
          <div className="relative">
            <select value={fy} onChange={e => setFy(e.target.value)}
              className="pl-3 pr-8 py-1.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 appearance-none">
              {fyOptions().map(f => <option key={f} value={f}>FY {f}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          </div>

          {/* Admin: user selector */}
          {admin && (
            <div className="relative">
              <select value={selectedUser} onChange={e => setSelectedUser(e.target.value)}
                className="pl-3 pr-8 py-1.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-200 appearance-none">
                <option value="">— Select User —</option>
                {users.map(u => <option key={u.id} value={u.name}>{u.name}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            </div>
          )}
        </div>

        {admin && selectedUser && (
          <div className="flex items-center gap-2">
            {hasPending && !editMode && (
              <button onClick={handleApproveAll} disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-sm font-semibold rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50">
                <CheckCircle className="h-4 w-4" /> Approve All
              </button>
            )}

            {!editMode ? (
              <button onClick={() => setEditMode(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-colors">
                <Edit3 className="h-4 w-4" /> Edit / Set
              </button>
            ) : (
              <>
                <button onClick={() => { setEditMode(false); fetchTargets(); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-600 text-sm font-semibold rounded-lg hover:bg-gray-50">
                  <X className="h-4 w-4" /> Cancel
                </button>
                <button onClick={handleSave} disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50">
                  <Save className="h-4 w-4" /> {saving ? 'Saving...' : 'Save & Approve'}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Status banners */}
      {!admin && overallStatus === 'Pending' && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 text-sm text-amber-700 flex items-center gap-2">
          <Clock className="h-4 w-4 shrink-0" />
          Your targets are awaiting admin approval. You can still edit and resubmit.
        </div>
      )}
      {!admin && overallStatus === 'Approved' && (
        <div className="bg-emerald-50 border-b border-emerald-200 px-6 py-2 text-sm text-emerald-700 flex items-center gap-2">
          <CheckCircle className="h-4 w-4 shrink-0" />
          Your targets for FY {fy} have been approved.
        </div>
      )}

      {/* Unit type legend */}
      {editMode && (!admin || selectedUser) && (
        <div className="bg-blue-50 border-b border-blue-100 px-4 sm:px-6 py-2 text-xs text-blue-600 flex items-center gap-3">
          <span className="font-semibold">Click the type label to toggle unit:</span>
          <span className="flex items-center gap-1 px-2 py-0.5 bg-white border border-gray-300 rounded-full font-medium text-gray-600">
            <Hash className="h-3 w-3" /> Qty — count (e.g. 15 sales)
          </span>
          <span className="flex items-center gap-1 px-2 py-0.5 bg-white border border-violet-300 rounded-full font-medium text-violet-700">
            <IndianRupee className="h-3 w-3" /> Amount — rupees (e.g. ₹1.7L)
          </span>
        </div>
      )}

      {/* Grid */}
      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-48 text-gray-400 text-sm">Loading...</div>
        ) : (!admin || selectedUser) ? (
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-auto">
            <table className="w-full border-collapse text-sm" style={{ minWidth: '940px' }}>
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase tracking-wide sticky left-0 bg-gray-50 border-r border-gray-200 w-32">
                    Type
                    {editMode && <div className="text-[10px] font-normal text-gray-400 normal-case mt-0.5">tap to toggle unit</div>}
                  </th>
                  {MONTHS.map(m => (
                    <th key={m} className="px-2 py-3 text-center text-xs font-bold text-gray-600 uppercase tracking-wide min-w-[72px]">{m.slice(0,3)}</th>
                  ))}
                  <th className="px-3 py-3 text-center text-xs font-bold text-gray-700 uppercase tracking-wide bg-blue-50 border-l border-blue-100">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {TYPES.map((t, ti) => {
                  const unit = unitTypes[t.key] || 'qty';
                  const isAmount = unit === 'amount';
                  return (
                    <tr key={t.key} className={ti % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                      {/* Type label cell — clickable toggle in edit mode */}
                      <td className={`px-3 py-2 sticky left-0 border-r border-gray-200 ${ti % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                        {editMode ? (
                          <button
                            onClick={() => toggleUnit(t.key)}
                            title={`Currently: ${isAmount ? 'Amount (₹)' : 'Quantity (#)'}. Click to toggle.`}
                            className={`w-full flex items-center justify-between gap-1.5 px-2 py-1 rounded-lg border transition-colors ${
                              isAmount
                                ? 'border-violet-300 bg-violet-50 text-violet-700'
                                : 'border-gray-200 bg-gray-50 text-gray-700 hover:border-blue-300 hover:bg-blue-50'
                            }`}
                          >
                            <span className="font-semibold text-sm">{t.label}</span>
                            <span className={`flex items-center gap-0.5 text-[10px] font-bold rounded px-1 py-0.5 ${
                              isAmount ? 'bg-violet-100 text-violet-600' : 'bg-gray-100 text-gray-500'
                            }`}>
                              {isAmount ? <IndianRupee className="h-2.5 w-2.5" /> : <Hash className="h-2.5 w-2.5" />}
                              {isAmount ? 'Amt' : 'Qty'}
                            </span>
                          </button>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-gray-800">{t.label}</span>
                            <span className={`text-[10px] font-bold px-1 py-0.5 rounded ${
                              isAmount ? 'bg-violet-100 text-violet-600' : 'bg-gray-100 text-gray-400'
                            }`}>
                              {isAmount ? '₹' : '#'}
                            </span>
                          </div>
                        )}
                      </td>

                      {MONTHS.map(month => (
                        <td key={month} className="px-1.5 py-1.5 text-center">
                          {editMode ? (
                            <div className="relative inline-flex items-center">
                              {isAmount && (
                                <span className="absolute left-1.5 text-gray-400 text-xs pointer-events-none">₹</span>
                              )}
                              <input
                                type="number"
                                min="0"
                                value={grid[t.key]?.[month] || ''}
                                onChange={e => handleCell(t.key, month, e.target.value)}
                                placeholder="0"
                                className={`w-20 text-center border rounded-md py-1 text-sm focus:outline-none focus:ring-2 bg-blue-50 ${
                                  isAmount
                                    ? 'pl-4 pr-1 border-violet-300 focus:ring-violet-300 bg-violet-50'
                                    : 'px-1 border-blue-300 focus:ring-blue-300'
                                }`}
                              />
                            </div>
                          ) : (
                            <span className={`inline-block text-center py-1 rounded text-sm ${
                              grid[t.key]?.[month]
                                ? `font-semibold ${isAmount ? 'text-violet-700' : 'text-gray-800'}`
                                : 'text-gray-300'
                            }`}>
                              {fmtValue(grid[t.key]?.[month] || 0, unit)}
                            </span>
                          )}
                        </td>
                      ))}

                      <td className="px-3 py-2.5 text-center font-bold bg-blue-50 border-l border-blue-100">
                        <span className={isAmount ? 'text-violet-700' : 'text-blue-700'}>
                          {fmtTotal(rowTotals[t.key], unit)}
                        </span>
                      </td>
                    </tr>
                  );
                })}

                {/* Column totals row — only shown when all types are same unit (or always for qty) */}
                <tr className="bg-gray-100 border-t-2 border-gray-300">
                  <td className="px-4 py-2.5 font-bold text-gray-700 sticky left-0 bg-gray-100 border-r border-gray-200 text-xs uppercase">Total</td>
                  {MONTHS.map(month => {
                    // Only sum qty types in the col total; show — if mixed
                    const qtyTypes = TYPES.filter(t => (unitTypes[t.key] || 'qty') === 'qty');
                    const allSameUnit = TYPES.every(t => unitTypes[t.key] === unitTypes[TYPES[0].key]);
                    const colUnit = unitTypes[TYPES[0].key] || 'qty';
                    const colVal = allSameUnit
                      ? TYPES.reduce((s, t) => s + (grid[t.key]?.[month] || 0), 0)
                      : qtyTypes.reduce((s, t) => s + (grid[t.key]?.[month] || 0), 0);
                    return (
                      <td key={month} className="px-1.5 py-2.5 text-center font-bold text-gray-700 text-xs">
                        {allSameUnit ? fmtValue(colVal, colUnit) : (colVal || '—')}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2.5 text-center font-bold text-blue-800 bg-blue-100 border-l border-blue-200 text-sm">
                    {(() => {
                      const allSameUnit = TYPES.every(t => unitTypes[t.key] === unitTypes[TYPES[0].key]);
                      if (allSameUnit) {
                        const grand = TYPES.reduce((s, t) => s + rowTotals[t.key], 0);
                        return fmtValue(grand, unitTypes[TYPES[0].key] || 'qty');
                      }
                      return '—';
                    })()}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          /* Admin: no user selected — show all users summary */
          <AdminSummary fy={fy} users={users} onSelect={setSelectedUser} />
        )}
      </div>
    </div>
  );
};

// ── Admin Summary: list all users with their target status ──
const AdminSummary: React.FC<{ fy: string; users: any[]; onSelect: (u: string) => void }> = ({ fy, users, onSelect }) => {
  const [allRows, setAllRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const { showError, showSuccess } = useToast();

  useEffect(() => {
    setLoading(true);
    targetsApi.get(fy).then(res => setAllRows(res?.data || [])).catch(() => {}).finally(() => setLoading(false));
  }, [fy]);

  const byUser = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const r of allRows) {
      if (!map[r.user_name]) map[r.user_name] = [];
      map[r.user_name].push(r);
    }
    return map;
  }, [allRows]);

  const handleApproveUser = async (uName: string) => {
    try {
      await targetsApi.approveAll(uName, fy);
      showSuccess('Approved', `All targets approved for ${uName}`);
      const res = await targetsApi.get(fy);
      setAllRows(res?.data || []);
    } catch (e: any) { showError('Error', e.message); }
  };

  if (loading) return <div className="flex items-center justify-center h-48 text-gray-400 text-sm">Loading...</div>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">Select a user above to view/edit their full target grid. Summary of all users below:</p>
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-bold text-gray-600 uppercase">User</th>
              <th className="px-4 py-3 text-center text-xs font-bold text-gray-600 uppercase">Months Set</th>
              <th className="px-4 py-3 text-center text-xs font-bold text-gray-600 uppercase">Status</th>
              <th className="px-4 py-3 text-right text-xs font-bold text-gray-600 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {users.map(u => {
              const uRows = byUser[u.name] || [];
              const statuses = uRows.map((r: any) => r.status);
              const status = statuses.every((s: string) => s === 'Approved') ? 'Approved'
                : statuses.some((s: string) => s === 'Pending') ? 'Pending'
                : uRows.length > 0 ? 'Draft' : null;
              return (
                <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-semibold text-gray-900">{u.name}</td>
                  <td className="px-4 py-3 text-center text-gray-600">{uRows.length} / 12</td>
                  <td className="px-4 py-3 text-center">{status ? statusBadge(status) : <span className="text-gray-300 text-xs">Not set</span>}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {status === 'Pending' && (
                        <button onClick={() => handleApproveUser(u.name)}
                          className="px-2.5 py-1 bg-emerald-500 text-white text-xs font-bold rounded-lg hover:bg-emerald-600">
                          Approve
                        </button>
                      )}
                      <button onClick={() => onSelect(u.name)}
                        className="px-2.5 py-1 bg-blue-50 text-blue-700 text-xs font-bold rounded-lg hover:bg-blue-100 border border-blue-200">
                        {uRows.length ? 'Edit' : 'Set'}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {users.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">No users found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TargetSetup;
