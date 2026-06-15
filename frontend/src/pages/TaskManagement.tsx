import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, Save, Plus, Trash2, Calendar, User, Clock, CheckCircle2, AlertCircle, RefreshCw, X, Navigation } from 'lucide-react';
import { useToast } from '../components/Toast/Toast';
import { tdlApi, adminsApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import DateInput from '../components/DateInput/DateInput';

interface Task {
    id?: number;
    user_name: string;
    task_type: string;
    allotment_date: string;
    deadline: string;
    completion_date: string;
    status: string;
    remark?: string;
    assigned_by?: string;
}

const TaskManagement: React.FC = () => {
    const { tdlId, reqId } = useParams();
    const navigate = useNavigate();
    const { showSuccess, showError } = useToast();
    const { user, canCreate, canEdit, canDelete, canViewHistory } = useAuth();

    // We fetch the whole TDL Master to get context, but filter for the specific requirement
    const [tdlRequest, setTdlRequest] = useState<any>(null);
    const [requirement, setRequirement] = useState<any>(null);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [admins, setAdmins] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    // History Modal State
    const [selectedTaskForHistory, setSelectedTaskForHistory] = useState<Task | null>(null);
    const [taskHistory, setTaskHistory] = useState<any[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [expandedTaskIndex, setExpandedTaskIndex] = useState<number | null>(null);

    const fetchData = async () => {
        if (!tdlId || !reqId) return;
        setLoading(true);
        try {
            const [dataResult, adminsResult] = await Promise.allSettled([
                tdlApi.getCustomizationById(tdlId),
                adminsApi.getAll()
            ]);

            if (dataResult.status === 'rejected') {
                showError('Error', 'You do not have permission to view this customization');
                navigate(-1);
                return;
            }

            const data = dataResult.value;
            const adminsRes = adminsResult.status === 'fulfilled' ? adminsResult.value : [];
            setTdlRequest(data);
            setAdmins(adminsRes || []);

            const req = data.requirements?.find((r: any) => r.id === parseInt(reqId));
            if (req) {
                setRequirement(req);
                setTasks(req.tasks || []);
            } else {
                showError('Error', 'Requirement not found');
                navigate(-1);
            }
        } catch (error) {
            showError('Error', 'Failed to load data');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [tdlId, reqId]);

    const handleSave = async () => {
        if (!reqId) return;
        try {
            await tdlApi.manageTasks(parseInt(reqId), tasks);
            showSuccess('Success', 'Tasks updated successfully');
            fetchData(); // Reload to ensure IDs are synced
        } catch (error) {
            showError('Error', 'Failed to save tasks');
        }
    };

    const addTask = () => {
        setTasks([...tasks, {
            user_name: '',
            task_type: 'Development',
            allotment_date: new Date().toISOString().split('T')[0],
            deadline: '',
            completion_date: '',
            status: 'In Progress',
            remark: '',
            assigned_by: user?.name || 'Admin'
        }]);
    };

    const removeTask = (index: number) => {
        const n = [...tasks];
        n.splice(index, 1);
        setTasks(n);
    };

    const updateTask = (index: number, field: keyof Task, value: any) => {
        const n = [...tasks];
        (n[index] as any)[field] = value;

        // Auto-set completion date if status changes
        if (field === 'status') {
            if (value === 'Completed') {
                n[index].completion_date = new Date().toISOString().split('T')[0];
            } else {
                n[index].completion_date = '';
            }
        }

        setTasks(n);
    };

    const openHistory = async (task: Task) => {
        if (!task.id) {
            showError('Notice', 'Save task first to view history');
            return;
        }
        setSelectedTaskForHistory(task);
        setHistoryLoading(true);
        try {
            const history = await tdlApi.getTaskHistory(task.id);
            setTaskHistory(history);
        } catch (error) {
            console.error(error);
            showError('Error', 'Failed to load history');
        } finally {
            setHistoryLoading(false);
        }
    };

    const getIconForChange = (type: string) => {
        switch (type) {
            case 'STATUS': return <RefreshCw className="h-4 w-4 text-orange-500" />;
            case 'CREATED': return <CheckCircle2 className="h-4 w-4 text-green-500" />;
            case 'REMARK': return <AlertCircle className="h-4 w-4 text-blue-500" />;
            default: return <Clock className="h-4 w-4 text-gray-500" />;
        }
    };

    if (loading) return <div className="flex h-screen items-center justify-center">Loading...</div>;

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
            {/* Header */}
            <div className="bg-white border-b px-3 md:px-6 py-2.5 md:py-4 flex items-center justify-between sticky top-0 z-10 shadow-sm">
                <div className="flex items-center gap-2 md:gap-4 min-w-0 flex-1">
                    <button onClick={() => navigate(-1)} className="p-1.5 md:p-2 hover:bg-gray-100 rounded-full transition-colors shrink-0">
                        <ChevronLeft className="h-5 w-5 md:h-6 md:w-6 text-gray-600" />
                    </button>
                    <div className="min-w-0">
                        <h1 className="text-base md:text-xl font-bold text-gray-800 flex items-center gap-2">
                            Tasks
                            <span className="text-xs font-normal text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded border">#{tdlId}</span>
                        </h1>
                        <p className="text-xs md:text-sm text-gray-600 truncate max-w-[200px] md:max-w-2xl">{requirement?.requirement}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 md:gap-3 shrink-0">
                    <button
                        onClick={() => window.open('/visit/map', '_blank')}
                        className="hidden md:flex items-center gap-2 bg-indigo-600 text-white px-5 py-2 rounded shadow-md hover:bg-indigo-700 transition font-bold"
                    >
                        <Navigation className="h-4 w-4" /> Open Route Map
                    </button>
                    {canCreate('tasks') && <button onClick={addTask} className="md:hidden flex items-center gap-1 text-xs bg-white border border-blue-400 text-blue-600 px-2.5 py-1.5 rounded font-bold">
                        <Plus className="h-3.5 w-3.5" /> Add
                    </button>}
                    {canEdit('tasks') && <button
                        onClick={handleSave}
                        className="flex items-center gap-1.5 bg-blue-600 text-white px-3 md:px-6 py-1.5 md:py-2 rounded shadow-md hover:bg-blue-700 transition font-bold text-sm md:text-base"
                    >
                        <Save className="h-4 w-4" /> <span className="hidden md:inline">Save Changes</span><span className="md:hidden">Save</span>
                    </button>}
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 p-3 md:p-6 overflow-auto">
                {/* Stats Summary */}
                <div className="bg-white rounded border border-gray-300 mb-3 md:mb-6 overflow-hidden">
                    <div className="bg-gray-100 px-3 md:px-4 py-1.5 md:py-2 border-b border-gray-300 font-bold text-gray-700 uppercase text-[10px] md:text-xs tracking-wider">
                        Project Status
                    </div>
                    <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div className="border border-gray-200 p-3 rounded bg-gray-50">
                            <span className="block text-gray-500 text-xs uppercase font-bold mb-1">Development Status</span>
                            <span className="font-bold text-blue-700">{requirement?.stats?.development_percent || 0}% Completed</span>
                        </div>
                        <div className="border border-gray-200 p-3 rounded bg-gray-50">
                            <span className="block text-gray-500 text-xs uppercase font-bold mb-1">Implementation Status</span>
                            <span className="font-bold text-purple-700">{requirement?.stats?.implementation_percent || 0}% Completed</span>
                        </div>
                        <div className="border border-gray-200 p-3 rounded bg-gray-50">
                            <span className="block text-gray-500 text-xs uppercase font-bold mb-1">Overdue</span>
                            <span className="font-bold text-red-600">{requirement?.stats?.overdue_days || 0} Days</span>
                        </div>
                        <div className="border border-gray-200 p-3 rounded bg-gray-50">
                            <span className="block text-gray-500 text-xs uppercase font-bold mb-1">Total Tasks</span>
                            <span className="font-bold text-gray-800">{tasks.length}</span>
                        </div>
                    </div>
                </div>

                {/* Task Table — Desktop */}
                <div className="hidden md:block bg-white border border-gray-300 rounded shadow-sm overflow-hidden min-h-[400px]">
                    <div className="flex justify-between items-center bg-gray-100 px-4 py-2 border-b border-gray-300">
                        <h2 className="font-bold text-gray-700 text-sm uppercase tracking-wider">Detailed Task Report</h2>
                        {canCreate('tasks') && <button onClick={addTask} className="flex items-center gap-1 text-xs bg-white border border-blue-300 text-blue-600 px-3 py-1 rounded hover:bg-blue-50 font-bold">
                            <Plus className="h-3 w-3" /> Add New Task
                        </button>}
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left border-collapse">
                            <thead className="bg-gray-50 text-gray-700 font-bold uppercase text-xs">
                                <tr>
                                    <th className="border-b border-r border-gray-300 px-4 py-3 w-10 text-center">#</th>
                                    <th className="border-b border-r border-gray-300 px-4 py-3 w-40">Allocated To</th>
                                    <th className="border-b border-r border-gray-300 px-4 py-3 w-40">Assigned By</th>
                                    <th className="border-b border-r border-gray-300 px-4 py-3 w-32">Task Type</th>
                                    <th className="border-b border-r border-gray-300 px-4 py-3 w-36">Allocated Date</th>
                                    <th className="border-b border-r border-gray-300 px-4 py-3 w-36 bg-yellow-50">Deadline</th>
                                    <th className="border-b border-r border-gray-300 px-4 py-3 w-36">Completion Date</th>
                                    <th className="border-b border-r border-gray-300 px-4 py-3 w-32">Status</th>
                                    <th className="border-b border-r border-gray-300 px-4 py-3">Remark</th>
                                    <th className="border-b border-gray-300 px-4 py-3 w-16 text-center">History</th>
                                    <th className="border-b border-gray-300 px-4 py-3 w-16 text-center">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                                {tasks.map((task, index) => (
                                    <tr key={index} className="hover:bg-blue-50/30 transition-colors">
                                        <td className="px-4 py-2 border-r border-gray-200 text-center text-gray-500 font-mono text-xs">{index + 1}</td>
                                        <td className="px-4 py-2 border-r border-gray-200">
                                            <div className="flex items-center gap-2">
                                                <User className="h-3 w-3 text-gray-400" />
                                                <select
                                                    value={task.user_name}
                                                    onChange={e => updateTask(index, 'user_name', e.target.value)}
                                                    className="w-full bg-transparent outline-none border-b border-transparent focus:border-blue-500 text-gray-800 font-medium cursor-pointer"
                                                >
                                                    <option value="">Select User</option>
                                                    {admins.map((admin: any) => (
                                                        <option key={admin.id} value={admin.name}>{admin.name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </td>
                                        <td className="px-4 py-2 border-r border-gray-200">
                                            <span className="text-xs text-gray-600 font-medium">{task.assigned_by || '-'}</span>
                                        </td>
                                        <td className="px-4 py-2 border-r border-gray-200">
                                            <select
                                                value={task.task_type}
                                                onChange={e => updateTask(index, 'task_type', e.target.value)}
                                                className="w-full bg-transparent outline-none cursor-pointer"
                                            >
                                                <option value="Development">Development</option>
                                                <option value="Implementation">Implementation</option>
                                            </select>
                                        </td>
                                        <td className="px-4 py-2 border-r border-gray-200">
                                            <DateInput
                                                value={task.allotment_date}
                                                onChange={val => updateTask(index, 'allotment_date', val)}
                                                className="w-full bg-transparent outline-none text-gray-600 border-none p-0 focus:ring-0"
                                            />
                                        </td>
                                        <td className="px-4 py-2 border-r border-gray-200">
                                            <DateInput
                                                value={task.deadline}
                                                onChange={val => updateTask(index, 'deadline', val)}
                                                className="w-full bg-transparent outline-none text-gray-800 font-bold border-none p-0 focus:ring-0"
                                            />
                                        </td>
                                        <td className="px-4 py-2 border-r border-gray-200">
                                            <DateInput
                                                value={task.completion_date}
                                                onChange={val => updateTask(index, 'completion_date', val)}
                                                className="w-full bg-transparent outline-none text-gray-600 border-none p-0 focus:ring-0"
                                            />
                                        </td>
                                        <td className="px-4 py-2 border-r border-gray-200">
                                            <select
                                                value={task.status}
                                                onChange={e => updateTask(index, 'status', e.target.value)}
                                                className={`w-full bg-transparent outline-none font-bold uppercase text-xs py-1 rounded
                                                    ${task.status === 'Completed' ? 'text-green-600' :
                                                        task.status === 'In Progress' ? 'text-blue-600' :
                                                            'text-gray-500'}`}
                                            >
                                                <option value="Pending">Pending</option>
                                                <option value="In Progress">Processing</option>
                                                <option value="Completed">Completed</option>
                                            </select>
                                        </td>
                                        <td className="px-4 py-2 border-r border-gray-200">
                                            <input
                                                type="text"
                                                value={task.remark || ''}
                                                onChange={e => updateTask(index, 'remark', e.target.value)}
                                                className="w-full bg-transparent outline-none text-gray-600 italic text-xs"
                                                placeholder="Add notes..."
                                            />
                                        </td>
                                        <td className="px-4 py-2 text-center border-r border-gray-200">
                                            {canViewHistory('tasks') && <button onClick={() => openHistory(task)} className="p-1.5 text-blue-600 hover:bg-blue-100 rounded-full">
                                                <Clock className="h-4 w-4" />
                                            </button>}
                                        </td>
                                        <td className="px-4 py-2 text-center">
                                            {canDelete('tasks') && <button
                                                onClick={() => removeTask(index)}
                                                className="text-gray-400 hover:text-red-500 transition-colors p-1"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </button>}
                                        </td>
                                    </tr>
                                ))}
                                {tasks.length === 0 && (
                                    <tr>
                                        <td colSpan={11} className="p-8 text-center text-gray-400 italic bg-gray-50">
                                            No tasks found. Click "Add New Task" to begin.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    <div className="bg-gray-50 px-4 py-2 border-t border-gray-300 text-xs text-center text-gray-500">
                        End of Report
                    </div>
                </div>

                {/* Task Cards — Mobile */}
                <div className="md:hidden space-y-2.5">
                  {tasks.length === 0 ? (
                    <div className="py-8 text-center text-sm text-gray-400 italic">No tasks found. Tap "Add" to begin.</div>
                  ) : tasks.map((task, index) => {
                    const isOverdue = task.deadline && new Date(task.deadline) < new Date() && task.status !== 'Completed';
                    const isExpanded = expandedTaskIndex === index;
                    return (
                      <div key={index} className={`bg-white rounded-xl border shadow-sm ${isOverdue ? 'border-red-300' : 'border-gray-200'}`}>
                        <div
                          className="p-3 cursor-pointer active:bg-gray-50 select-none"
                          onClick={() => setExpandedTaskIndex(isExpanded ? null : index)}
                        >
                          {/* Row 1: User Name | Assigned By */}
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm font-bold text-gray-900 truncate flex-1">
                              {task.user_name || <span className="text-gray-400">Unassigned</span>}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-xs text-gray-500">{task.assigned_by || '—'}</span>
                              <ChevronLeft className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${isExpanded ? '-rotate-90' : ''}`} />
                            </div>
                          </div>

                          {/* Row 2: Task Type | Status | Deadline */}
                          <div className="flex items-center gap-2 mt-1.5 text-xs">
                            <span className="text-gray-700 font-medium">{task.task_type}</span>
                            <span className="text-gray-300">|</span>
                            <span className={`font-bold ${task.status === 'Completed' ? 'text-green-600' : task.status === 'In Progress' ? 'text-blue-600' : 'text-gray-500'}`}>
                              {task.status === 'In Progress' ? 'Processing' : task.status}
                            </span>
                            <span className="text-gray-300">|</span>
                            <span className={isOverdue ? 'text-red-600 font-bold' : 'text-gray-600'}>
                              {task.deadline ? new Date(task.deadline).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : 'No deadline'}
                            </span>
                            {isOverdue && <span className="text-[10px] bg-red-100 text-red-700 px-1 rounded font-bold">OVERDUE</span>}
                          </div>

                          {/* Row 3: Remark */}
                          {task.remark && (
                            <div className="mt-1.5 text-xs text-gray-600 italic line-clamp-2">{task.remark}</div>
                          )}
                        </div>

                        {/* Expanded: Editable Fields */}
                        {isExpanded && (
                          <div className="border-t border-gray-100 p-3 space-y-3 bg-gray-50/50">
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-[10px] text-gray-500 uppercase font-bold block mb-0.5">Assigned To</label>
                                <select value={task.user_name} onChange={e => updateTask(index, 'user_name', e.target.value)}
                                  className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white">
                                  <option value="">Select</option>
                                  {admins.map((a: any) => <option key={a.id} value={a.name}>{a.name}</option>)}
                                </select>
                              </div>
                              <div>
                                <label className="text-[10px] text-gray-500 uppercase font-bold block mb-0.5">Task Type</label>
                                <select value={task.task_type} onChange={e => updateTask(index, 'task_type', e.target.value)}
                                  className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white">
                                  <option value="Development">Development</option>
                                  <option value="Implementation">Implementation</option>
                                </select>
                              </div>
                              <div>
                                <label className="text-[10px] text-gray-500 uppercase font-bold block mb-0.5">Status</label>
                                <select value={task.status} onChange={e => updateTask(index, 'status', e.target.value)}
                                  className={`w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white font-bold ${task.status === 'Completed' ? 'text-green-600' : task.status === 'In Progress' ? 'text-blue-600' : 'text-gray-600'}`}>
                                  <option value="Pending">Pending</option>
                                  <option value="In Progress">Processing</option>
                                  <option value="Completed">Completed</option>
                                </select>
                              </div>
                              <div>
                                <label className="text-[10px] text-gray-500 uppercase font-bold block mb-0.5">Deadline</label>
                                <DateInput value={task.deadline} onChange={val => updateTask(index, 'deadline', val)}
                                  className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white" />
                              </div>
                              <div>
                                <label className="text-[10px] text-gray-500 uppercase font-bold block mb-0.5">Allotment Date</label>
                                <DateInput value={task.allotment_date} onChange={val => updateTask(index, 'allotment_date', val)}
                                  className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white" />
                              </div>
                              <div>
                                <label className="text-[10px] text-gray-500 uppercase font-bold block mb-0.5">Completion Date</label>
                                <DateInput value={task.completion_date} onChange={val => updateTask(index, 'completion_date', val)}
                                  className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white" />
                              </div>
                            </div>
                            <div>
                              <label className="text-[10px] text-gray-500 uppercase font-bold block mb-0.5">Remark</label>
                              <input type="text" value={task.remark || ''} onChange={e => updateTask(index, 'remark', e.target.value)}
                                className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white" placeholder="Add notes..." />
                            </div>
                            <div className="flex gap-2 pt-1">
                              {canViewHistory('tasks') && task.id && (
                                <button onClick={() => openHistory(task)} className="flex-1 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 rounded-lg active:bg-blue-100 flex items-center justify-center gap-1">
                                  <Clock className="h-3.5 w-3.5" /> History
                                </button>
                              )}
                              {canDelete('tasks') && (
                                <button onClick={() => removeTask(index)} className="flex-1 py-1.5 text-xs font-semibold text-red-700 bg-red-50 rounded-lg active:bg-red-100 flex items-center justify-center gap-1">
                                  <Trash2 className="h-3.5 w-3.5" /> Remove
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
            </div>

            {/* History Modal */}
            {selectedTaskForHistory && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white w-full max-w-2xl rounded-xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
                        <div className="flex items-center justify-between px-6 py-4 border-b bg-gray-50">
                            <div>
                                <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                                    <Clock className="h-5 w-5 text-blue-600" />
                                    Task History
                                </h3>
                                <div className="text-xs text-gray-500 mt-1 flex gap-2">
                                    <span className="font-mono bg-gray-200 px-1 rounded">ID: {selectedTaskForHistory.id}</span>
                                    <span>Assignee: {selectedTaskForHistory.user_name}</span>
                                </div>
                            </div>
                            <button onClick={() => setSelectedTaskForHistory(null)} className="p-2 hover:bg-gray-200 rounded-full transition-colors">
                                <X className="h-5 w-5 text-gray-600" />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 bg-gray-50/50">
                            {historyLoading ? (
                                <div className="flex justify-center py-10"><RefreshCw className="h-6 w-6 animate-spin text-gray-400" /></div>
                            ) : taskHistory.length === 0 ? (
                                <div className="text-center py-10 text-gray-400 italic">No history records found for this task.</div>
                            ) : (
                                <div className="relative pl-6 border-l-2 border-gray-200 space-y-8">
                                    {taskHistory.map((item, idx) => (
                                        <div key={idx} className="relative">
                                            {/* Timeline Dot */}
                                            <div className="absolute -left-[31px] top-0 bg-white border-2 border-blue-500 rounded-full p-1.5 shadow-sm">
                                                {getIconForChange(item.change_type)}
                                            </div>

                                            <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
                                                <div className="flex justify-between items-start mb-2">
                                                    <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">{new Date(item.created_at).toLocaleString('en-GB')}</span>
                                                    <span className="text-xs font-semibold bg-gray-100 px-2 py-0.5 rounded text-gray-600">{item.changed_by}</span>
                                                </div>
                                                <p className="text-sm font-medium text-gray-800 mb-1">{item.description}</p>

                                                {/* Detail Diff if available */}
                                                {(item.old_value || item.new_value) && (
                                                    <div className="mt-2 text-xs grid grid-cols-2 gap-2 bg-gray-50 p-2 rounded border border-gray-100">
                                                        <div className="text-red-600 line-through opacity-70">
                                                            {item.old_value ? (item.old_value.match(/^\d{4}-\d{2}-\d{2}$/) ? item.old_value.split('-').reverse().join('/') : item.old_value) : '-'}
                                                        </div>
                                                        <div className="text-green-600 font-bold">
                                                            {item.new_value ? (item.new_value.match(/^\d{4}-\d{2}-\d{2}$/) ? item.new_value.split('-').reverse().join('/') : item.new_value) : '-'}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TaskManagement;
