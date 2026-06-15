import React, { useState, useEffect } from 'react';
import { X, Calendar, Clock, MessageSquare, Save, Building2, Tag, RefreshCw } from 'lucide-react';

import { tallyApi } from '../../services/api';
import { useToast } from '../Toast/Toast';

interface UpdateExpiryModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    data: {
        tallyserial: string;
        company_name: string;
        expiry_status?: string;
        next_follow_date?: string;
        expiry_remarks?: string;
    };
}

const UpdateExpiryModal: React.FC<UpdateExpiryModalProps> = ({ isOpen, onClose, onSuccess, data }) => {
    const { showSuccess, showError } = useToast();
    const [loading, setLoading] = useState(false);

    const [form, setForm] = useState({
        entry_type: 'CALL',
        start_time: '',
        end_time: '',
        next_follow_date: '',
        expiry_status: 'Pending',
        remarks: ''
    });

    useEffect(() => {
        if (isOpen && data) {
            // Set default times to current
            const now = new Date();
            const formatDT = (d: Date) => {
                return d.toISOString().slice(0, 16);
            };
            
            // Default end time 5 mins from now
            const end = new Date(now.getTime() + 5 * 60000);

            setForm({
                entry_type: 'CALL',
                start_time: formatDT(now),
                end_time: formatDT(end),
                next_follow_date: data.next_follow_date || '',
                expiry_status: data.expiry_status || 'Pending',
                remarks: data.expiry_remarks || ''
            });
        }
    }, [isOpen, data]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            await tallyApi.updateRenewalCall({
                serial: data.tallyserial,
                ...form
            });
            showSuccess('Success', 'Updated successfully');
            onSuccess();
            onClose();
        } catch (error: any) {
            showError('Error', error.message || 'Failed to update');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95 duration-300 border border-gray-200">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-slate-50 to-white">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-red-50 rounded-lg">
                            <Clock className="h-5 w-5 text-red-600" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-gray-900">Update Tally Renewal Call</h2>
                            <p className="text-xs text-gray-500 font-medium italic">Log interaction and update expiry status</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors group">
                        <X className="h-5 w-5 text-gray-400 group-hover:text-gray-600" />
                    </button>
                </div>

                {/* Company Info Bar */}
                <div className="px-6 py-3 bg-blue-50/50 border-b border-blue-100 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-blue-600" />
                        <span className="text-sm font-bold text-blue-900">{data.company_name}</span>
                    </div>
                    <div className="flex items-center gap-2 px-2 py-1 bg-white border border-blue-200 rounded text-[11px] font-mono text-blue-700 shadow-sm">
                        <Tag className="h-3 w-3" />
                        {data.tallyserial}
                    </div>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-6">
                    <div className="space-y-6">
                        {/* Interaction defaults sent in background */}

                        {/* Section 2: Expiry Status & Next Step */}
                        <div className="space-y-4">
                            <div className="flex items-center gap-2 text-green-700 mb-1">
                                <Calendar className="h-4 w-4" />
                                <span className="text-xs font-bold uppercase tracking-wider">Expiry Status & Next Step</span>
                                <div className="flex-1 h-px bg-green-100"></div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="text-[11px] font-bold text-gray-500 uppercase tracking-tight ml-1">Current Status</label>
                                    <select
                                        className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:bg-white transition-all outline-none text-sm font-medium"
                                        value={form.expiry_status}
                                        onChange={e => setForm({ ...form, expiry_status: e.target.value })}
                                    >
                                        <option value="Pending">Pending</option>
                                        <option value="Pending-Order">Pending-Order</option>
                                        <option value="Interested">Interested</option>
                                        <option value="Not-Interested">Not-Interested</option>
                                        <option value="Call-Back Later">Call-Back Later</option>
                                        <option value="Wrong-No">Wrong-No</option>
                                        <option value="Not-Responding">Not-Responding</option>
                                        <option value="Business-Closed">Business-Closed</option>
                                        <option value="Software-Change">Software-Change</option>
                                        <option value="Not In Use">Not In Use</option>
                                        <option value="Reseller">Reseller</option>
                                    </select>
                                </div>

                                <div className="space-y-1">
                                    <label className="text-[11px] font-bold text-gray-500 uppercase tracking-tight ml-1">Next Followup Date</label>
                                    <input
                                        type="date"
                                        className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:bg-white transition-all outline-none text-sm"
                                        value={form.next_follow_date}
                                        onChange={e => setForm({ ...form, next_follow_date: e.target.value })}
                                    />
                                </div>

                                <div className="md:col-span-2 space-y-1">
                                    <label className="text-[11px] font-bold text-gray-500 uppercase tracking-tight ml-1">Interaction Remarks</label>
                                    <textarea
                                        rows={2}
                                        placeholder="Summarize the discussion details..."
                                        className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all outline-none text-sm resize-none"
                                        value={form.remarks}
                                        onChange={e => setForm({ ...form, remarks: e.target.value })}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-end items-center gap-3 mt-8 pt-5 border-t border-gray-100">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-5 py-2 text-sm font-bold text-gray-600 hover:text-gray-800 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className={`px-8 py-2.5 bg-blue-600 text-white font-bold rounded-xl shadow-lg shadow-blue-200 hover:bg-blue-700 hover:-translate-y-0.5 transition-all active:scale-95 flex items-center gap-2 ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                            {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                            {loading ? 'Saving Changes...' : 'Save Update'}
                        </button>
                    </div>
                </form>
            </div>
        </div>

    );
};

export default UpdateExpiryModal;
