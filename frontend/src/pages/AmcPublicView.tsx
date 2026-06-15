import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { tdlApi } from '../services/api';
import { Loader, AlertTriangle, FileText, CheckCircle, Smartphone, User, Calendar } from 'lucide-react';

const AmcPublicView = () => {
    const { token } = useParams();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [data, setData] = useState<any>(null);

    useEffect(() => {
        const load = async () => {
            if (!token) {
                setError('Invalid Link');
                setLoading(false);
                return;
            }
            try {
                const res = await tdlApi.lookupByToken(token);
                setData(res);
            } catch (err: any) {
                setError('Link expired or invalid');
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [token]);

    if (loading) return (
        <div className="min-h-screen flex flex-col justify-center items-center bg-gray-50">
            <Loader className="h-10 w-10 text-red-600 animate-spin mb-4" />
            <p className="text-gray-500 font-medium">Loading details...</p>
        </div>
    );

    if (error) return (
        <div className="min-h-screen flex flex-col justify-center items-center bg-gray-50 p-4">
            <div className="bg-white p-8 rounded-2xl shadow-xl text-center max-w-md w-full border border-gray-100">
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <AlertTriangle className="h-8 w-8 text-red-600" />
                </div>
                <h2 className="text-2xl font-bold text-gray-800 mb-2">Access Denied</h2>
                <p className="text-gray-500">{error}</p>
            </div>
        </div>
    );

    if (!data) return null;

    const isExpired = data.expiry_date && new Date(data.expiry_date) < new Date();

    return (
        <div className="min-h-screen bg-gray-50/50 py-10 px-4 md:px-0">
            <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
                {/* Header Band */}
                <div className="bg-gradient-to-r from-red-700 to-red-600 p-8 text-white">
                    <div className="flex justify-between items-start">
                        <div>
                            <h1 className="text-2xl md:text-3xl font-bold mb-2">{data.project_name || 'Generic Customization'}</h1>
                            <p className="opacity-90 flex items-center gap-2 text-sm font-medium">
                                <span className="bg-white/20 px-2 py-0.5 rounded text-white border border-white/20">TDL / {data.id}</span>
                            </p>
                        </div>
                        {isExpired ? (
                            <div className="bg-red-900/50 text-red-100 px-4 py-2 rounded-lg border border-red-400/30 flex items-center gap-2 font-bold backdrop-blur-sm">
                                <AlertTriangle className="h-5 w-5" /> EXPIRED
                            </div>
                        ) : (
                            <div className="bg-green-500/20 text-white px-4 py-2 rounded-lg border border-white/20 flex items-center gap-2 font-bold backdrop-blur-sm shadow-sm">
                                <CheckCircle className="h-5 w-5" /> ACTIVE
                            </div>
                        )}
                    </div>
                </div>

                <div className="p-6 md:p-8 space-y-8">
                    {/* Key Dates & Status */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1 block">Expiry Date</label>
                            <div className={`font-mono font-medium text-lg ${isExpired ? 'text-red-600' : 'text-green-700'}`}>
                                {data.expiry_date || 'N/A'}
                            </div>
                        </div>
                        <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1 block">Status</label>
                            <div className="font-medium text-lg text-gray-800 flex items-center gap-2">
                                <div className={`w-2.5 h-2.5 rounded-full ${isExpired ? 'bg-red-500' : 'bg-green-500'}`}></div>
                                {data.status}
                            </div>
                        </div>
                        <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1 block">Created On</label>
                            <div className="font-medium text-lg text-gray-800">
                                {new Date(data.created_at).toLocaleDateString()}
                            </div>
                        </div>
                    </div>

                    {/* Customer Info (Limited View) */}
                    <div className="flex flex-col md:flex-row gap-6 border-t pt-6">
                        <div className="flex-1">
                            <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                                <User className="h-5 w-5 text-gray-400" /> Client Details
                            </h3>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs text-gray-500 block mb-0.5">Contact Person</label>
                                    <div className="font-medium text-gray-900">{data.person_name}</div>
                                </div>
                                <div>
                                    <label className="text-xs text-gray-500 block mb-0.5">Mobile</label>
                                    <div className="font-medium text-gray-900 flex items-center gap-1.5">
                                        <Smartphone className="h-3 w-3 text-gray-400" /> {data.phone_no}
                                    </div>
                                </div>
                            </div>
                        </div>
                        {data.remark && (
                            <div className="flex-1 bg-blue-50/50 p-4 rounded-lg border border-blue-50">
                                <label className="text-xs font-bold text-blue-700 uppercase mb-2 block">Remarks</label>
                                <p className="text-sm text-gray-700 leading-relaxed italic">
                                    "{data.description}"
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Requirements List */}
                    {data.requirements && data.requirements.length > 0 && (
                        <div className="border-t pt-6">
                            <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                                <FileText className="h-5 w-5 text-gray-400" /> Requirements & Attachments
                            </h3>
                            <div className="bg-white border rounded-lg overflow-hidden ring-1 ring-gray-100 shadow-sm">
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-50 border-b">
                                        <tr>
                                            <th className="px-4 py-3 text-left font-semibold text-gray-600">Requirement</th>
                                            <th className="px-4 py-3 text-right font-semibold text-gray-600 w-24">Attachment</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {data.requirements.map((req: any, i: number) => (
                                            <tr key={i} className="hover:bg-gray-50/50 transition-colors">
                                                <td className="px-4 py-3 text-gray-800 align-top leading-relaxed">
                                                    {req.requirement}
                                                </td>
                                                <td className="px-4 py-3 text-right">
                                                    {req.attachment ? (
                                                        <a
                                                            href={req.attachment}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-600 rounded text-xs font-bold hover:bg-blue-100 transition-colors"
                                                        >
                                                            <FileText className="h-3.5 w-3.5" /> View
                                                        </a>
                                                    ) : (
                                                        <span className="text-gray-400 text-xs italic">No File</span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>

                <div className="bg-gray-50 p-4 border-t text-center text-xs text-gray-400 font-medium">
                    &copy; {new Date().getFullYear()} ABS Technologies. Generated by System.
                </div>
            </div>
        </div>
    );
};

export default AmcPublicView;
