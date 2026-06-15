import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, X, Search, MapPin, Shield } from 'lucide-react';
import { pincodeApi, statesApi } from '../services/api';
import { useToast } from '../components/Toast/Toast';
import { useAuth } from '../context/AuthContext';

interface Pincode {
    id: number;
    pincode: string;
    city: string;
    // state: string; (name from backend)
    stateid: number;
    state?: string;
}

const PincodePage: React.FC = () => {
    const { canCreate, canEdit, canDelete } = useAuth();
    const [pincodes, setPincodes] = useState<Pincode[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editing, setEditing] = useState<Pincode | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [states, setStates] = useState<{ id: number; name: string }[]>([]);
    const { showSuccess, showError } = useToast();

    const [form, setForm] = useState({ pincode: '', city: '', stateid: '' });

    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [limit] = useState(50);

    useEffect(() => {
        fetchData();
        fetchStates();
    }, [page, searchQuery]);

    const fetchStates = async () => {
        try {
            const res: any = await statesApi.getAll();
            setStates(res.data || []);
        } catch (err) {
        }
    };

    const fetchData = async () => {
        try {
            setLoading(true);
            const res: any = await pincodeApi.getAll(page, limit, searchQuery);
            setPincodes(res.data || []);
            setTotal(res.total || 0);
        } catch (err: any) {
            showError('Error', 'Failed to fetch pincodes');
        } finally {
            setLoading(false);
        }
    };

    const filteredPincodes = pincodes; // Backend filtering

    const openAdd = () => {
        setEditing(null);
        setForm({ pincode: '', city: '', stateid: '' });
        setShowModal(true);
    };

    const openEdit = (p: Pincode) => {
        setEditing(p);
        setForm({ pincode: p.pincode, city: p.city, stateid: p.stateid?.toString() || '' });
        setShowModal(true);
    };

    const handleSave = async () => {
        if (!form.pincode || !form.city || !form.stateid) {
            showError('Error', 'All fields are required');
            return;
        }

        try {
            if (editing) {
                await pincodeApi.update(editing.id, form);
                showSuccess('Updated', 'Pincode updated successfully');
            } else {
                await pincodeApi.create(form);
                showSuccess('Added', 'Pincode added successfully');
            }
            setShowModal(false);
            fetchData();
        } catch (err: any) {
            showError('Error', err.message || 'Failed to save pincode');
        }
    };

    const [deleteId, setDeleteId] = useState<number | null>(null);

    const confirmDelete = async () => {
        if (!deleteId) return;
        try {
            await pincodeApi.delete(deleteId);
            showSuccess('Deleted', 'Pincode removed');
            fetchData();
        } catch (err: any) {
            showError('Error', err.message || 'Failed to delete pincode');
        } finally {
            setDeleteId(null);
        }
    };

    const handleDelete = (id: number) => {
        setDeleteId(id);
    };

    return (
        <div className="space-y-4 pb-16 md:pb-0">
            <div className="flex flex-col md:flex-row justify-between items-center gap-3">
                <h1 className="text-lg md:text-2xl font-bold text-gray-900 w-full md:w-auto">Pincode Management</h1>

                <div className="flex gap-2 w-full md:w-auto items-center">
                    {/* Search */}
                    <div className="relative flex-1 md:w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-100 focus:border-red-400 outline-none h-10"
                        />
                    </div>

                    {/* Buttons */}
                    {canCreate('pincodes') && (
                        <button
                            onClick={openAdd}
                            className="flex items-center justify-center gap-2 w-10 md:w-auto md:px-4 h-10 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors shadow-sm"
                            title="Add Pincode"
                        >
                            <Plus className="h-4 w-4" />
                            <span className="hidden md:inline">Add Pincode</span>
                        </button>
                    )}
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                {/* Search removed from here */}

                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-gray-50 text-gray-600 font-medium border-b border-gray-200">
                            <tr>
                                <th className="px-6 py-3">Pincode</th>
                                <th className="px-6 py-3">City/Area</th>
                                <th className="px-6 py-3">State</th>
                                <th className="px-6 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {loading ? (
                                <tr><td colSpan={4} className="px-6 py-10 text-center text-gray-500">Loading...</td></tr>
                            ) : filteredPincodes.length === 0 ? (
                                <tr><td colSpan={4} className="px-6 py-10 text-center text-gray-500">No Existing data found. Add new.</td></tr>
                            ) : (
                                filteredPincodes.map((p) => (
                                    <tr key={p.id} className="hover:bg-gray-50/80 transition-colors">
                                        <td className="px-6 py-4 font-mono font-medium text-gray-900">{p.pincode}</td>
                                        <td className="px-6 py-4 text-gray-700">{p.city}</td>
                                        <td className="px-6 py-4 text-gray-700">{p.state}</td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex justify-end gap-2">
                                                {canEdit('pincodes') ? (
                                                    <button
                                                        onClick={() => openEdit(p)}
                                                        className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                                                        title="Edit"
                                                    >
                                                        <Edit2 className="h-4 w-4" />
                                                    </button>
                                                ) : (
                                                    <button disabled className="p-1.5 text-gray-300 cursor-not-allowed">
                                                        <Edit2 className="h-4 w-4" />
                                                    </button>
                                                )}

                                                {canDelete('pincodes') ? (
                                                    <button
                                                        onClick={() => handleDelete(p.id)}
                                                        className="p-1.5 text-red-600 hover:bg-red-50 rounded-md transition-colors"
                                                        title="Delete"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </button>
                                                ) : (
                                                    <button disabled className="p-1.5 text-gray-300 cursor-not-allowed">
                                                        <Trash2 className="h-4 w-4" />
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Pagination Controls */}
            <div className="flex justify-between items-center mt-4">
                <div className="text-sm text-gray-600">
                    Showing {((page - 1) * limit) + 1} to {Math.min(page * limit, total)} of {total} entries
                </div>
                <div className="flex gap-2">
                    <button
                        disabled={page === 1}
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded disabled:opacity-50 transition-colors"
                    >
                        Previous
                    </button>
                    <button
                        disabled={page * limit >= total}
                        onClick={() => setPage(p => p + 1)}
                        className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded disabled:opacity-50 transition-colors"
                    >
                        Next
                    </button>
                </div>
            </div>

            {showModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-lg p-6 w-full max-w-md rounded-xl shadow-xl">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                                <MapPin className="h-5 w-5 text-red-600" />
                                {editing ? 'Edit Pincode' : 'Add New Pincode'}
                            </h3>
                            <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Pincode</label>
                                <input
                                    type="text"
                                    value={form.pincode}
                                    onChange={e => setForm({ ...form, pincode: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-100 focus:border-red-400 outline-none"
                                    placeholder="6 digit pincode"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">City / Area</label>
                                <input
                                    type="text"
                                    value={form.city}
                                    onChange={e => setForm({ ...form, city: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-100 focus:border-red-400 outline-none"
                                    placeholder="Enter city or area name"
                                />
                            </div>



                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
                                <select
                                    value={form.stateid}
                                    onChange={e => setForm({ ...form, stateid: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-100 focus:border-red-400 outline-none bg-white"
                                >
                                    <option value="">Select State</option>
                                    {states.map(s => (
                                        <option key={s.id} value={s.id}>{s.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="flex gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-xl">
                            <button
                                onClick={() => setShowModal(false)}
                                className="flex-1 py-2 text-gray-700 font-medium rounded-lg hover:bg-gray-100 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSave}
                                className="flex-1 py-2 bg-red-600 text-white font-medium rounded-lg hover:bg-red-700 transition-colors shadow-sm"
                            >
                                {editing ? 'Update' : 'Save'}
                            </button>
                        </div>
                    </div>
                </div>
            )
            }
            {/* Delete Confirmation Modal */}
            {deleteId && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden">
                        <div className="p-6">
                            <div className="flex items-center gap-3 mb-4 text-red-600">
                                <Trash2 className="h-6 w-6" />
                                <h3 className="text-lg font-bold">Delete Pincode?</h3>
                            </div>
                            <p className="text-gray-600 mb-6">Are you sure you want to delete this pincode? This action cannot be undone.</p>
                            <div className="flex justify-end gap-3">
                                <button
                                    onClick={() => setDeleteId(null)}
                                    className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors font-medium"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={confirmDelete}
                                    className="px-4 py-2 bg-red-600 text-white hover:bg-red-700 rounded-lg transition-colors font-medium shadow-sm"
                                >
                                    Delete Pincode
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div >
    );
};

export default PincodePage;
