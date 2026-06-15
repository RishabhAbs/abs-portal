import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, RefreshCw, ChevronDown } from 'lucide-react';
import { leadRequirementsApi, usersApi } from '../services/api';
import { useToast } from '../components/Toast/Toast';
import { useAuth } from '../context/AuthContext';

const LeadDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showError, showSuccess } = useToast();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [lead, setLead] = useState<any>(null);
  const [requirements, setRequirements] = useState<any[]>([]);
  const [followups, setFollowups] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({});
  const [tab, setTab] = useState<'req' | 'followup' | 'done'>('req');
  const [cloudUsers, setCloudUsers] = useState<any[]>([]);
  const [expandedReq, setExpandedReq] = useState<number | null>(null);
  const [reqUpdates, setReqUpdates] = useState<Record<number, any[]>>({});

  const [modal, setModal] = useState<'addReq' | 'updateReq' | 'completeReq' | 'addFollowup' | null>(null);
  const [selectedReq, setSelectedReq] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  const [addReqForm, setAddReqForm] = useState({ description: '', assigned_to: '', priority: 'Medium', deadline: '' });
  const [updateReqForm, setUpdateReqForm] = useState({ remark: '', status: '', stage: '', next_followup_date: '' });
  const [completeReqForm, setCompleteReqForm] = useState({ remark: '', action: 'stop' as string, transfer_to: '' });
  const [followupForm, setFollowupForm] = useState({ content: '', followup_date: '' });

  const leadId = Number(id);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await leadRequirementsApi.getLeadDetail(leadId);
      if (res.success) { setLead(res.data.lead); setRequirements(res.data.requirements); setFollowups(res.data.followups); setStats(res.data.stats); }
    } catch (e: any) { showError('Error', e.message || 'Failed'); }
    finally { setLoading(false); }
  }, [leadId]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { usersApi.getBasic().then((r: any) => setCloudUsers(Array.isArray(r) ? r : r?.data || r?.users || [])).catch(() => {}); }, []);

  const loadTimeline = async (reqId: number) => {
    if (expandedReq === reqId) { setExpandedReq(null); return; }
    try { const r = await leadRequirementsApi.getRequirementUpdates(reqId); if (r.success) setReqUpdates(p => ({ ...p, [reqId]: r.data })); } catch {}
    setExpandedReq(reqId);
  };

  const handleAddReq = async () => {
    if (!addReqForm.description.trim()) { showError('Error', 'Enter a description'); return; }
    setSaving(true);
    try {
      const res = await leadRequirementsApi.addRequirement(leadId, { description: addReqForm.description, assigned_to: addReqForm.assigned_to || undefined, priority: addReqForm.priority, deadline: addReqForm.deadline || undefined });
      if (res?.success === false) { showError('Error', res.message || 'Failed to add'); return; }
      showSuccess('Success', 'Requirement added'); setModal(null); setAddReqForm({ description: '', assigned_to: '', priority: 'Medium', deadline: '' }); fetchData();
    } catch (e: any) { console.error('addReq error:', e); showError('Error', e.message || 'Failed to add requirement'); } finally { setSaving(false); }
  };

  const handleUpdateReq = async () => {
    if (!selectedReq) { console.error('No selectedReq'); return; }
    const stageChanged = updateReqForm.stage && updateReqForm.stage !== (selectedReq.stage || 'Pending');
    const statusChanged = updateReqForm.status && updateReqForm.status !== selectedReq.status;
    if (!updateReqForm.remark.trim() && !statusChanged && !stageChanged) {
      showError('Error', 'Enter a remark, change status, or change stage');
      return;
    }
    setSaving(true);
    try {
      const res = await leadRequirementsApi.updateRequirement(selectedReq.id, {
        status: updateReqForm.status || undefined,
        stage: updateReqForm.stage || undefined,
        remark: updateReqForm.remark || undefined,
        next_followup_date: updateReqForm.next_followup_date || undefined,
      });
      if (res?.success === false) { showError('Error', res.message || 'Failed to update'); return; }
      showSuccess('Success', 'Requirement updated'); setModal(null); fetchData();
    } catch (e: any) { console.error('updateReq error:', e); showError('Error', e.message || 'Failed to update requirement'); } finally { setSaving(false); }
  };

  const handleCompleteReq = async () => {
    if (!selectedReq) { console.error('No selectedReq'); return; }
    if ((completeReqForm.action === 'transfer' || completeReqForm.action === 'direct_transfer') && !completeReqForm.transfer_to) { showError('Error', 'Select a person to transfer to'); return; }
    setSaving(true);
    try {
      const res = await leadRequirementsApi.completeRequirement(selectedReq.id, { remark: completeReqForm.remark || undefined, action: completeReqForm.action, transfer_to: completeReqForm.transfer_to || undefined });
      if (res?.success === false) { showError('Error', res.message || 'Failed'); return; }
      showSuccess('Success', completeReqForm.action === 'stop' ? 'Requirement completed' : 'Requirement transferred'); setModal(null); setCompleteReqForm({ remark: '', action: 'stop', transfer_to: '' }); fetchData();
    } catch (e: any) { console.error('completeReq error:', e); showError('Error', e.message || 'Failed to complete requirement'); } finally { setSaving(false); }
  };

  const handleAddFollowup = async () => {
    if (!followupForm.content.trim()) { showError('Error', 'Enter follow-up content'); return; }
    setSaving(true);
    try {
      const res = await leadRequirementsApi.addFollowup(leadId, { content: followupForm.content, followup_date: followupForm.followup_date || undefined });
      if (res?.success === false) { showError('Error', res.message || 'Failed to add follow-up'); return; }
      showSuccess('Success', 'Follow-up added'); setModal(null); setFollowupForm({ content: '', followup_date: '' }); fetchData();
    } catch (e: any) { console.error('addFollowup error:', e); showError('Error', e.message || 'Failed to add follow-up'); } finally { setSaving(false); }
  };

  const markFollowupDone = async (fId: number) => {
    try {
      const res = await leadRequirementsApi.markFollowupDone(fId);
      if (res?.success === false) { showError('Error', res.message || 'Failed'); return; }
      showSuccess('Done', 'Follow-up marked as done'); fetchData();
    } catch (e: any) { console.error('markFollowupDone error:', e); showError('Error', e.message || 'Failed to mark as done'); }
  };

  const od = (d: string) => { if (!d) return 0; const x = Math.floor((Date.now() - new Date(d).getTime()) / 86400000); return x > 0 ? x : 0; };
  const fmt = (d: string) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';
  const fmtDt = (d: string) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

  const activeReqs = requirements.filter(r => r.status !== 'Completed' && r.status !== 'Cancelled');
  const completedReqs = requirements.filter(r => r.status === 'Completed');
  const pendingFu = followups.filter(f => f.status === 'Pending');
  const doneFu = followups.filter(f => f.status === 'Done');

  if (loading) return <div className="flex items-center justify-center h-40"><RefreshCw className="h-4 w-4 animate-spin text-gray-400" /></div>;
  if (!lead) return <div className="p-4 text-center text-xs text-gray-400">Not found</div>;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header — single compact row: back + name + info + stats + tabs + add button */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 shadow-sm px-4 py-1.5 flex items-center gap-4">
        <button onClick={() => navigate(-1)} className="p-1 hover:bg-gray-100 rounded">
          <ArrowLeft className="h-4 w-4 text-gray-500" />
        </button>
        <span className="text-sm font-bold text-gray-900 truncate max-w-[200px]">{lead.customer_name || lead.contact_person || 'Walk-in'}</span>
        <span className="text-xs text-gray-400 hidden sm:inline">{lead.mobile_no}</span>
        {lead.lead_type && <span className="text-xs text-gray-400 hidden md:inline">{lead.lead_type}</span>}
        {lead.taken_by && <span className="text-xs text-gray-400 hidden md:inline">{lead.taken_by}</span>}

        {/* Stats inline */}
        <div className="flex items-center gap-2 text-xs ml-2">
          <span className="text-blue-600 font-medium">{stats.pending || 0} Pending</span>
          {(stats.overdue || 0) > 0 && <span className="text-red-600 font-semibold">{stats.overdue} Overdue</span>}
          <span className="text-emerald-600 font-medium">{stats.completed || 0} Done</span>
        </div>

        {/* Tabs inline */}
        <div className="flex items-center gap-0.5 ml-auto border rounded-lg bg-gray-100 p-0.5">
          {([
            { k: 'req' as const, l: 'Requirements', c: activeReqs.length },
            { k: 'followup' as const, l: 'Follow-ups', c: pendingFu.length },
            { k: 'done' as const, l: 'Completed', c: completedReqs.length },
          ]).map(t => (
            <button key={t.k} onClick={() => setTab(t.k)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${tab === t.k ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {t.l} <span className={`ml-0.5 ${tab === t.k ? 'text-purple-500' : 'text-gray-400'}`}>{t.c}</span>
            </button>
          ))}
        </div>

        <button onClick={() => setModal(tab === 'followup' ? 'addFollowup' : 'addReq')}
          className="ml-2 px-3 py-1.5 bg-purple-600 text-white text-xs font-medium rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-1">
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
        <button onClick={fetchData} className="p-1 hover:bg-gray-100 rounded">
          <RefreshCw className="h-3.5 w-3.5 text-gray-400" />
        </button>
      </div>

      {/* Content — Table layout */}
      <div className="px-3 py-2">

        {/* Requirements Table */}
        {tab === 'req' && (
          activeReqs.length === 0 ? <div className="py-10 text-center text-sm text-gray-400">No active requirements</div> :
          <div className="bg-white rounded-lg border border-gray-200 overflow-auto">
            <table className="w-full text-xs text-left whitespace-nowrap">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-[11px] font-semibold text-gray-500 uppercase">
                  <th className="px-2 py-2 w-8">#</th>
                  <th className="px-2 py-2 min-w-[180px]">Requirement</th>
                  <th className="px-2 py-2">Creator</th>
                  <th className="px-2 py-2">Created At</th>
                  <th className="px-2 py-2">Assigned To</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Priority</th>
                  <th className="px-2 py-2">Deadline</th>
                  <th className="px-2 py-2">Overdue</th>
                  <th className="px-2 py-2 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {activeReqs.map((req, idx) => {
                  const overdue = od(req.deadline);
                  return (
                    <React.Fragment key={req.id}>
                      <tr className="hover:bg-gray-50 cursor-pointer" onClick={() => loadTimeline(req.id)}>
                        <td className="px-2 py-1.5 text-gray-400">{idx + 1}</td>
                        <td className="px-2 py-1.5 whitespace-normal max-w-[280px]">
                          <span className="font-medium text-gray-900">{req.description}</span>
                          {req.latest_remark && <span className="text-gray-400 ml-1 text-[11px]">— {req.latest_remark_by}: {req.latest_remark}</span>}
                          {req.update_count > 0 && <span className="text-gray-400 ml-1">({req.update_count} upd)</span>}
                        </td>
                        <td className="px-2 py-1.5 text-gray-600">{req.created_by || '—'}</td>
                        <td className="px-2 py-1.5 text-gray-500">{fmtDt(req.created_at)}</td>
                        <td className="px-2 py-1.5 text-gray-700 font-medium">{req.assigned_to || '—'}</td>
                        <td className="px-2 py-1.5">
                          <div className="flex flex-col gap-1 items-start">
                            {req.dev_completed_at ? (
                              <span
                                title={`Dev completed by ${req.dev_completed_by || '—'} on ${fmtDt(req.dev_completed_at)}`}
                                className="inline-block text-[11px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 border border-emerald-200"
                              >✓ Dev Done</span>
                            ) : (
                              <span className={`inline-block text-[11px] font-medium px-1.5 py-0.5 rounded ${req.status === 'In Progress' ? 'bg-blue-100 text-blue-700' : 'bg-yellow-100 text-yellow-700'}`}>{req.status}</span>
                            )}
                            {req.stage && req.stage !== 'Pending' && (
                              <span className="inline-block text-[10px] font-medium px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-100">{req.stage}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-1.5">
                          <span className={`inline-block text-[11px] font-medium px-1.5 py-0.5 rounded ${req.priority === 'Urgent' ? 'bg-red-100 text-red-700' : req.priority === 'High' ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-600'}`}>{req.priority}</span>
                        </td>
                        <td className="px-2 py-1.5 text-gray-600">{req.deadline ? fmt(req.deadline) : '—'}</td>
                        <td className="px-2 py-1.5">
                          {overdue > 0
                            ? <span className="text-[11px] font-bold text-red-600">{overdue}d</span>
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-2 py-1.5" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center gap-1 justify-center">
                            <button onClick={() => { setSelectedReq(req); setUpdateReqForm({ remark: '', status: req.status, stage: req.stage || 'Pending', next_followup_date: '' }); setModal('updateReq'); }}
                              className="px-2 py-1 text-[11px] font-medium text-blue-700 bg-blue-50 rounded hover:bg-blue-100 transition-colors">Update</button>
                            <button onClick={() => { setSelectedReq(req); setCompleteReqForm({ remark: '', action: 'stop', transfer_to: '' }); setModal('completeReq'); }}
                              className={`px-2 py-1 text-[11px] font-medium rounded transition-colors ${req.dev_completed_at ? 'text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm animate-pulse' : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'}`}
                              title={req.dev_completed_at ? 'Dev finished — click to finalize' : 'Mark done'}>
                              {req.dev_completed_at ? 'Finalize' : 'Done'}
                            </button>
                            <button onClick={() => { setSelectedReq(req); setCompleteReqForm({ remark: '', action: 'transfer', transfer_to: '' }); setModal('completeReq'); }}
                              className="px-2 py-1 text-[11px] font-medium text-amber-700 bg-amber-50 rounded hover:bg-amber-100 transition-colors">Transfer</button>
                          </div>
                        </td>
                      </tr>
                      {expandedReq === req.id && reqUpdates[req.id] && (
                        <tr>
                          <td></td>
                          <td colSpan={9} className="px-2 py-2 bg-gray-50">
                            <div className="pl-2 border-l-2 border-purple-300 space-y-1">
                              {reqUpdates[req.id].map(u => (
                                <div key={u.id} className="text-[11px]">
                                  <span className="text-gray-400">{fmtDt(u.created_at)}</span>{' '}
                                  <span className="font-medium text-gray-700">{u.created_by}:</span>{' '}
                                  <span className="text-gray-600">{u.update_type === 'StatusChange' ? `${u.old_value} → ${u.new_value}` : u.update_type === 'Transfer' ? `Transfer: ${u.old_value} → ${u.new_value}` : u.update_type === 'Assignment' ? `→ ${u.new_value}` : u.content || u.update_type}</span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Follow-ups Table */}
        {tab === 'followup' && (
          pendingFu.length === 0 && doneFu.length === 0 ? <div className="py-10 text-center text-sm text-gray-400">No follow-ups</div> :
          <div className="space-y-3">
            {pendingFu.length > 0 && (
              <div className="bg-white rounded-lg border border-gray-200 overflow-auto">
                <table className="w-full text-xs text-left whitespace-nowrap">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 text-[11px] font-semibold text-gray-500 uppercase">
                      <th className="px-2 py-2 w-8">#</th>
                      <th className="px-2 py-2 min-w-[180px]">Follow-up Details</th>
                      <th className="px-2 py-2">Created By</th>
                      <th className="px-2 py-2">Created At</th>
                      <th className="px-2 py-2">Follow-up Date</th>
                      <th className="px-2 py-2">Overdue</th>
                      <th className="px-2 py-2 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {pendingFu.map((f, idx) => {
                      const overdue = od(f.followup_date);
                      return (
                        <tr key={f.id} className="hover:bg-gray-50">
                          <td className="px-2 py-1.5 text-gray-400">{idx + 1}</td>
                          <td className="px-2 py-1.5 text-gray-900 whitespace-normal">{f.content}</td>
                          <td className="px-2 py-1.5 text-gray-600">{f.created_by}</td>
                          <td className="px-2 py-1.5 text-gray-500">{fmtDt(f.created_at)}</td>
                          <td className="px-2 py-1.5">
                            <span className={`text-[11px] font-medium ${overdue > 0 ? 'text-red-600' : 'text-blue-600'}`}>
                              {f.followup_date ? fmt(f.followup_date) : '—'}
                            </span>
                          </td>
                          <td className="px-2 py-1.5">
                            {overdue > 0 ? <span className="text-[11px] font-bold text-red-600">{overdue}d</span> : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <button onClick={() => markFollowupDone(f.id)}
                              className="px-2 py-1 text-[11px] font-medium text-white bg-emerald-600 rounded hover:bg-emerald-700 transition-colors">Done</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {doneFu.length > 0 && (
              <div>
                <h4 className="text-[11px] font-semibold text-gray-400 uppercase mb-1">Completed ({doneFu.length})</h4>
                <div className="bg-white rounded-lg border border-gray-200 overflow-auto">
                  <table className="w-full text-xs text-left whitespace-nowrap">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200 text-[11px] font-semibold text-gray-500 uppercase">
                        <th className="px-2 py-2 w-8">#</th>
                        <th className="px-2 py-2 min-w-[180px]">Details</th>
                        <th className="px-2 py-2">By</th>
                        <th className="px-2 py-2">Completed At</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {doneFu.map((f, idx) => (
                        <tr key={f.id} className="text-gray-400">
                          <td className="px-2 py-1.5">{idx + 1}</td>
                          <td className="px-2 py-1.5 whitespace-normal">{f.content}</td>
                          <td className="px-2 py-1.5">{f.created_by}</td>
                          <td className="px-2 py-1.5">{fmtDt(f.completed_at || f.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Completed Requirements Table */}
        {tab === 'done' && (
          completedReqs.length === 0 ? <div className="py-10 text-center text-sm text-gray-400">No completed requirements</div> :
          <div className="bg-white rounded-lg border border-gray-200 overflow-auto">
            <table className="w-full text-xs text-left whitespace-nowrap">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-[11px] font-semibold text-gray-500 uppercase">
                  <th className="px-2 py-2 w-8">#</th>
                  <th className="px-2 py-2 min-w-[180px]">Requirement</th>
                  <th className="px-2 py-2">Completed By</th>
                  <th className="px-2 py-2">Completed At</th>
                  <th className="px-2 py-2">Assigned To</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {completedReqs.map((req, idx) => (
                  <React.Fragment key={req.id}>
                    <tr className="hover:bg-gray-50 cursor-pointer" onClick={() => loadTimeline(req.id)}>
                      <td className="px-2 py-1.5 text-gray-400">{idx + 1}</td>
                      <td className="px-2 py-1.5 text-gray-700 whitespace-normal">{req.description}</td>
                      <td className="px-2 py-1.5 text-gray-600">{req.completed_by || '—'}</td>
                      <td className="px-2 py-1.5 text-gray-500">{fmtDt(req.completed_at)}</td>
                      <td className="px-2 py-1.5 text-gray-600">{req.assigned_to || '—'}</td>
                    </tr>
                    {expandedReq === req.id && reqUpdates[req.id] && (
                      <tr>
                        <td></td>
                        <td colSpan={4} className="px-2 py-2 bg-gray-50">
                          <div className="pl-2 border-l-2 border-emerald-300 space-y-1">
                            {reqUpdates[req.id].map(u => (
                              <div key={u.id} className="text-[11px]">
                                <span className="text-gray-400">{fmtDt(u.created_at)}</span>{' '}
                                <span className="font-medium text-gray-700">{u.created_by}:</span>{' '}
                                <span className="text-gray-600">{u.update_type === 'StatusChange' ? `${u.old_value} → ${u.new_value}` : u.content || u.update_type}</span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ═══ MODALS ═══ */}

      {modal === 'addReq' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 pb-24 md:pb-4 overflow-y-auto" onClick={() => setModal(null)}>
          <div className="w-full max-w-md bg-white rounded-2xl p-6 space-y-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-gray-900">Add Requirement</h3>
            <textarea placeholder="What needs to be done?" value={addReqForm.description}
              onChange={e => setAddReqForm(p => ({ ...p, description: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg p-3 text-sm text-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent" rows={3} autoFocus />
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Assign to</label>
                <select value={addReqForm.assigned_to} onChange={e => setAddReqForm(p => ({ ...p, assigned_to: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500">
                  <option value="">None</option>
                  {cloudUsers.map((u: any) => <option key={u.id || u.name} value={u.name}>{u.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Priority</label>
                <select value={addReqForm.priority} onChange={e => setAddReqForm(p => ({ ...p, priority: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500">
                  {['Low', 'Medium', 'High', 'Urgent'].map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Deadline</label>
                <input type="date" value={addReqForm.deadline} onChange={e => setAddReqForm(p => ({ ...p, deadline: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500" />
              </div>
            </div>
            <button onClick={handleAddReq} disabled={saving || !addReqForm.description.trim()}
              className="w-full py-3 bg-purple-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 hover:bg-purple-700 active:bg-purple-800 transition-colors">{saving ? 'Adding...' : 'Add Requirement'}</button>
          </div>
        </div>
      )}

      {modal === 'updateReq' && selectedReq && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 pb-24 md:pb-4 overflow-y-auto" onClick={() => setModal(null)}>
          <div className="w-full max-w-md bg-white rounded-2xl p-6 space-y-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div>
              <h3 className="text-base font-bold text-gray-900">Update Requirement</h3>
              <p className="text-sm text-gray-500 mt-0.5 truncate">{selectedReq.description}</p>
            </div>
            <textarea placeholder="Add a remark..." value={updateReqForm.remark}
              onChange={e => setUpdateReqForm(p => ({ ...p, remark: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg p-3 text-sm text-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent" rows={3} autoFocus />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
                <select value={updateReqForm.status} onChange={e => setUpdateReqForm(p => ({ ...p, status: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
                  {['Pending', 'In Progress'].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Update Type</label>
                <select value={updateReqForm.stage} onChange={e => setUpdateReqForm(p => ({ ...p, stage: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
                  {['Pending', 'Quotation', 'Advance Pending', 'Implementation', 'Billing', 'Customization', 'Followup'].map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Next Follow-up</label>
                <input type="date" value={updateReqForm.next_followup_date}
                  onChange={e => setUpdateReqForm(p => ({ ...p, next_followup_date: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
              </div>
            </div>
            <button onClick={handleUpdateReq} disabled={saving}
              className="w-full py-3 bg-purple-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 hover:bg-purple-700 active:bg-purple-800 transition-colors">{saving ? 'Saving...' : 'Save Update'}</button>
          </div>
        </div>
      )}

      {modal === 'completeReq' && selectedReq && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 pb-24 md:pb-4 overflow-y-auto" onClick={() => setModal(null)}>
          <div className="w-full max-w-md bg-white rounded-2xl p-6 space-y-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div>
              <h3 className="text-base font-bold text-gray-900">Complete Requirement</h3>
              <p className="text-sm text-gray-500 mt-0.5 truncate">{selectedReq.description}</p>
            </div>
            <textarea placeholder="Final remark..." value={completeReqForm.remark}
              onChange={e => setCompleteReqForm(p => ({ ...p, remark: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg p-3 text-sm text-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent" rows={3} />
            <div className="space-y-2">
              {[
                { v: 'stop', l: 'Mark as Complete', sub: 'I am the last person on this' },
                { v: 'transfer', l: 'Transfer to Next', sub: 'Hand off to someone else' },
                { v: 'direct_transfer', l: 'Direct Transfer', sub: 'Not my work, redirect it' },
              ].map(o => (
                <label key={o.v} className={`flex items-center gap-3 p-3 rounded-xl border-2 text-sm cursor-pointer transition-colors ${completeReqForm.action === o.v ? 'border-purple-400 bg-purple-50' : 'border-gray-200 hover:border-gray-300'}`}>
                  <input type="radio" name="act" value={o.v} checked={completeReqForm.action === o.v}
                    onChange={() => setCompleteReqForm(p => ({ ...p, action: o.v }))} className="accent-purple-600 w-4 h-4" />
                  <div>
                    <div className="font-medium text-gray-900">{o.l}</div>
                    <div className="text-xs text-gray-500">{o.sub}</div>
                  </div>
                </label>
              ))}
            </div>
            {(completeReqForm.action === 'transfer' || completeReqForm.action === 'direct_transfer') && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Transfer to</label>
                <select value={completeReqForm.transfer_to} onChange={e => setCompleteReqForm(p => ({ ...p, transfer_to: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
                  <option value="">Select a person</option>
                  {cloudUsers.map((u: any) => <option key={u.id || u.name} value={u.name}>{u.name}</option>)}
                </select>
              </div>
            )}
            <button onClick={handleCompleteReq} disabled={saving}
              className={`w-full py-3 text-white rounded-xl text-sm font-semibold disabled:opacity-50 transition-colors ${completeReqForm.action === 'stop' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-600 hover:bg-amber-700'}`}>
              {saving ? 'Processing...' : completeReqForm.action === 'stop' ? 'Complete' : 'Transfer'}
            </button>
          </div>
        </div>
      )}

      {modal === 'addFollowup' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 pb-24 md:pb-4 overflow-y-auto" onClick={() => setModal(null)}>
          <div className="w-full max-w-md bg-white rounded-2xl p-6 space-y-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-gray-900">Add Follow-up</h3>
            <textarea placeholder="What do you need to follow up on?" value={followupForm.content}
              onChange={e => setFollowupForm(p => ({ ...p, content: e.target.value }))}
              className="w-full border border-gray-300 rounded-lg p-3 text-sm text-gray-900 resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent" rows={3} autoFocus />
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Follow-up Date</label>
              <input type="date" value={followupForm.followup_date} onChange={e => setFollowupForm(p => ({ ...p, followup_date: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
            </div>
            <button onClick={handleAddFollowup} disabled={saving || !followupForm.content.trim()}
              className="w-full py-3 bg-purple-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 hover:bg-purple-700 active:bg-purple-800 transition-colors">{saving ? 'Saving...' : 'Add Follow-up'}</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default LeadDetail;
