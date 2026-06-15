import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast/Toast';
import {
    Shield, Lock, Smartphone, Check, X, Loader,
    Calendar, Clock, User, Mail, BadgeCheck, ShieldCheck, ShieldAlert, Key, Settings, ChevronRight,
    CheckCircle, XCircle, AlertTriangle, Sun
} from 'lucide-react';
import { authApi, attendanceApi } from '../services/api';

const Profile: React.FC = () => {
    const { user, isLoading: authLoading, isAdmin } = useAuth();
    const { showSuccess, showError } = useToast();
    const navigate = useNavigate();

    // Password Change State
    const [passForm, setPassForm] = useState({ currentPass: '', newPass: '', confirmPass: '', otp: '' });
    const [isChangingPass, setIsChangingPass] = useState(false);
    const [showPassSection, setShowPassSection] = useState(false);

    // Attendance Stats
    const [attendanceStats, setAttendanceStats] = useState<any>(null);
    const [attendanceLoading, setAttendanceLoading] = useState(false);

    useEffect(() => {
        if (user) {
            const now = new Date();
            setAttendanceLoading(true);
            attendanceApi.getMyMonthlyStats(now.getMonth() + 1, now.getFullYear())
                .then(data => setAttendanceStats(data))
                .catch(() => {})
                .finally(() => setAttendanceLoading(false));
        }
    }, [user]);

    if (authLoading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader className="h-8 w-8 animate-spin text-red-600" />
            </div>
        );
    }

    const handlePasswordChange = async () => {
        if (!passForm.currentPass || !passForm.newPass || !passForm.otp) {
            showError('Required', 'Please fill all fields');
            return;
        }
        if (passForm.newPass !== passForm.confirmPass) {
            showError('Mismatch', 'New passwords do not match');
            return;
        }
        if (passForm.newPass.length < 6) {
            showError('Weak', 'Password must be at least 6 characters');
            return;
        }
        setIsChangingPass(true);
        try {
            const response = await authApi.changePassword(passForm.currentPass, passForm.newPass, passForm.otp);
            if (response.success) {
                showSuccess('Success', 'Password updated successfully');
                setPassForm({ currentPass: '', newPass: '', confirmPass: '', otp: '' });
                setShowPassSection(false);
            }
        } catch (error: any) {
            showError('Error', error.message || 'Failed to update password');
        } finally {
            setIsChangingPass(false);
        }
    };

    const formatDate = (dateStr?: string) => {
        if (!dateStr) return 'N/A';
        return new Date(dateStr).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        });
    };

    const getSecurityScore = () => {
        let score = 50; // Base score
        if (user?.is_two_fa_enabled) score += 40;
        if (user?.status === 'active') score += 10;
        return score;
    };

    const securityScore = getSecurityScore();

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            {/* Hero Header */}
            <div className="bg-gradient-to-r from-red-600 via-red-700 to-red-800 rounded-xl overflow-hidden shadow-lg">
                <div className="px-6 py-8 md:px-8 md:py-10">
                    <div className="flex flex-col md:flex-row md:items-center gap-6">
                        {/* Avatar */}
                        <div className="h-24 w-24 md:h-28 md:w-28 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center text-white font-bold text-4xl md:text-5xl shadow-xl border-2 border-white/30">
                            {user?.name?.charAt(0).toUpperCase() || 'U'}
                        </div>

                        {/* Info */}
                        <div className="flex-1 text-white">
                            <h1 className="text-2xl md:text-3xl font-bold mb-1">{user?.name}</h1>
                            <div className="flex items-center gap-2 text-red-100 text-sm mb-3">
                                <Mail className="h-4 w-4" />
                                {user?.email}
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <span className="inline-flex items-center gap-1 px-3 py-1 bg-white/20 backdrop-blur-sm rounded-full text-xs font-semibold uppercase">
                                    <BadgeCheck className="h-3.5 w-3.5" />
                                    {user?.role}
                                </span>
                                <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold uppercase ${user?.status === 'active' ? 'bg-green-500/30 text-green-100' : 'bg-red-500/30 text-red-100'}`}>
                                    <span className={`h-2 w-2 rounded-full ${user?.status === 'active' ? 'bg-green-400' : 'bg-red-400'}`}></span>
                                    {user?.status}
                                </span>
                            </div>
                        </div>

                        {/* Security Score */}
                        <div className="hidden md:flex flex-col items-center bg-white/10 backdrop-blur-sm rounded-xl px-6 py-4 border border-white/20">
                            <div className="text-xs text-red-100 uppercase font-semibold mb-1">Security</div>
                            <div className={`text-3xl font-bold ${securityScore >= 80 ? 'text-green-300' : securityScore >= 50 ? 'text-yellow-300' : 'text-red-300'}`}>
                                {securityScore}%
                            </div>
                            <div className="w-full h-1.5 bg-white/20 rounded-full mt-2 overflow-hidden">
                                <div
                                    className={`h-full rounded-full transition-all ${securityScore >= 80 ? 'bg-green-400' : securityScore >= 50 ? 'bg-yellow-400' : 'bg-red-400'}`}
                                    style={{ width: `${securityScore}%` }}
                                ></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                            <Calendar className="h-5 w-5" />
                        </div>
                        <div>
                            <div className="text-xs text-gray-500 font-medium">Member Since</div>
                            <div className="text-sm font-bold text-gray-900">{formatDate(user?.created_at)}</div>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-purple-50 text-purple-600 rounded-lg">
                            <User className="h-5 w-5" />
                        </div>
                        <div>
                            <div className="text-xs text-gray-500 font-medium">Account ID</div>
                            <div className="text-sm font-bold text-gray-900 font-mono">{user?.id?.slice(0, 8) || 'N/A'}</div>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${user?.is_two_fa_enabled ? 'bg-green-50 text-green-600' : 'bg-yellow-50 text-yellow-600'}`}>
                            {user?.is_two_fa_enabled ? <ShieldCheck className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}
                        </div>
                        <div>
                            <div className="text-xs text-gray-500 font-medium">2FA Status</div>
                            <div className={`text-sm font-bold ${user?.is_two_fa_enabled ? 'text-green-600' : 'text-yellow-600'}`}>
                                {user?.is_two_fa_enabled ? 'Enabled' : 'Disabled'}
                            </div>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 p-4 md:hidden block">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${securityScore >= 80 ? 'bg-green-50 text-green-600' : securityScore >= 50 ? 'bg-yellow-50 text-yellow-600' : 'bg-red-50 text-red-600'}`}>
                            <Shield className="h-5 w-5" />
                        </div>
                        <div>
                            <div className="text-xs text-gray-500 font-medium">Security Score</div>
                            <div className={`text-sm font-bold ${securityScore >= 80 ? 'text-green-600' : securityScore >= 50 ? 'text-yellow-600' : 'text-red-600'}`}>
                                {securityScore}%
                            </div>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-lg border border-gray-200 p-4 hidden md:block">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-gray-50 text-gray-600 rounded-lg">
                            <Clock className="h-5 w-5" />
                        </div>
                        <div>
                            <div className="text-xs text-gray-500 font-medium">Session</div>
                            <div className="text-sm font-bold text-green-600">Active</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* This Month's Attendance */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <Calendar className="h-5 w-5 text-gray-700" />
                            <h2 className="text-lg font-bold text-gray-900">
                                This Month's Attendance
                                <span className="text-sm font-normal text-gray-500 ml-2">
                                    {new Date().toLocaleString('en-IN', { month: 'long', year: 'numeric' })}
                                </span>
                            </h2>
                        </div>
                        <button
                            onClick={() => {
                                const now = new Date();
                                const params = new URLSearchParams({
                                    userId: user?.id || '',
                                    name: user?.name || 'Employee',
                                    month: String(now.getMonth() + 1),
                                    year: String(now.getFullYear()),
                                });
                                navigate(`/attendance/monthly?${params.toString()}`);
                            }}
                            className="text-sm text-red-600 hover:text-red-700 font-medium flex items-center gap-1"
                        >
                            View Details <ChevronRight className="h-4 w-4" />
                        </button>
                    </div>
                </div>
                <div className="p-6">
                    {attendanceLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader className="h-6 w-6 animate-spin text-red-600" />
                        </div>
                    ) : attendanceStats?.summary ? (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="flex items-center gap-3 p-4 bg-green-50 rounded-lg border border-green-100">
                                <div className="p-2 bg-green-100 text-green-600 rounded-lg">
                                    <CheckCircle className="h-5 w-5" />
                                </div>
                                <div>
                                    <div className="text-2xl font-bold text-green-700">{attendanceStats.summary.present}</div>
                                    <div className="text-xs text-green-600 font-medium">Present</div>
                                </div>
                            </div>
                            <div className="flex items-center gap-3 p-4 bg-red-50 rounded-lg border border-red-100">
                                <div className="p-2 bg-red-100 text-red-600 rounded-lg">
                                    <XCircle className="h-5 w-5" />
                                </div>
                                <div>
                                    <div className="text-2xl font-bold text-red-700">{attendanceStats.summary.absent}</div>
                                    <div className="text-xs text-red-600 font-medium">Absent</div>
                                </div>
                            </div>
                            <div className="flex items-center gap-3 p-4 bg-yellow-50 rounded-lg border border-yellow-100">
                                <div className="p-2 bg-yellow-100 text-yellow-600 rounded-lg">
                                    <AlertTriangle className="h-5 w-5" />
                                </div>
                                <div>
                                    <div className="text-2xl font-bold text-yellow-700">{attendanceStats.summary.half_day}</div>
                                    <div className="text-xs text-yellow-600 font-medium">Half Day</div>
                                </div>
                            </div>
                            <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-lg border border-blue-100">
                                <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
                                    <Sun className="h-5 w-5" />
                                </div>
                                <div>
                                    <div className="text-2xl font-bold text-blue-700">{attendanceStats.summary.holidays}</div>
                                    <div className="text-xs text-blue-600 font-medium">Holidays</div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-8 text-gray-500 text-sm">
                            No attendance data available for this month.
                        </div>
                    )}
                </div>
            </div>

            {/* Security Section */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
                    <div className="flex items-center gap-3">
                        <Shield className="h-5 w-5 text-gray-700" />
                        <h2 className="text-lg font-bold text-gray-900">Security Settings</h2>
                    </div>
                </div>

                <div className="p-6 space-y-4">
                    {/* 2FA Status Card */}
                    <div className={`rounded-lg p-5 border-2 ${user?.is_two_fa_enabled ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
                        <div className="flex items-start gap-4">
                            <div className={`p-3 rounded-full ${user?.is_two_fa_enabled ? 'bg-green-100 text-green-600' : 'bg-amber-100 text-amber-600'}`}>
                                <Smartphone className="h-6 w-6" />
                            </div>
                            <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                    <h3 className="font-bold text-gray-900">Two-Factor Authentication</h3>
                                    {user?.is_two_fa_enabled ? (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-200 text-green-800 rounded-full text-xs font-bold">
                                            <Check className="h-3 w-3" /> Enabled
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-200 text-amber-800 rounded-full text-xs font-bold">
                                            <X className="h-3 w-3" /> Not Enabled
                                        </span>
                                    )}
                                </div>
                                <p className="text-sm text-gray-600">
                                    {user?.is_two_fa_enabled
                                        ? 'Your account is protected with an authenticator app. You will be prompted for a code when logging in.'
                                        : 'Contact your administrator to enable 2FA for enhanced account security.'}
                                </p>
                                {!user?.is_two_fa_enabled && (
                                    <p className="text-xs text-amber-700 mt-2 flex items-center gap-1">
                                        <ShieldAlert className="h-3.5 w-3.5" />
                                        2FA management is controlled by administrators only.
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Password Change Card */}
                    <div className="rounded-lg p-5 border border-gray-200 bg-gray-50">
                        <div className="flex items-start justify-between gap-4">
                            <div className="flex items-start gap-4">
                                <div className="p-3 rounded-full bg-gray-200 text-gray-600">
                                    <Key className="h-6 w-6" />
                                </div>
                                <div>
                                    <h3 className="font-bold text-gray-900 mb-1">Password</h3>
                                    <p className="text-sm text-gray-600">
                                        {user?.is_two_fa_enabled
                                            ? 'Change your password securely using 2FA verification.'
                                            : 'Enable 2FA first to change your password.'}
                                    </p>
                                </div>
                            </div>
                            {user?.is_two_fa_enabled && (
                                <button
                                    onClick={() => setShowPassSection(!showPassSection)}
                                    className="px-4 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors whitespace-nowrap"
                                >
                                    {showPassSection ? 'Cancel' : 'Change Password'}
                                </button>
                            )}
                        </div>

                        {showPassSection && user?.is_two_fa_enabled && (
                            <div className="mt-6 pt-5 border-t border-gray-200">
                                <div className="grid gap-4 max-w-md">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Current Password</label>
                                        <input
                                            type="password"
                                            value={passForm.currentPass}
                                            onChange={e => setPassForm({ ...passForm, currentPass: e.target.value })}
                                            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none text-sm"
                                            placeholder="Enter current password"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
                                        <input
                                            type="password"
                                            value={passForm.newPass}
                                            onChange={e => setPassForm({ ...passForm, newPass: e.target.value })}
                                            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none text-sm"
                                            placeholder="Enter new password (min 6 chars)"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
                                        <input
                                            type="password"
                                            value={passForm.confirmPass}
                                            onChange={e => setPassForm({ ...passForm, confirmPass: e.target.value })}
                                            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none text-sm"
                                            placeholder="Confirm new password"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">2FA Verification Code</label>
                                        <input
                                            type="text"
                                            value={passForm.otp}
                                            onChange={e => setPassForm({ ...passForm, otp: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                                            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none text-sm font-mono tracking-widest text-center"
                                            placeholder="000000"
                                            maxLength={6}
                                        />
                                    </div>
                                    <button
                                        onClick={handlePasswordChange}
                                        disabled={isChangingPass || !passForm.currentPass || !passForm.newPass || !passForm.confirmPass || passForm.otp.length !== 6}
                                        className="w-full py-3 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                                    >
                                        {isChangingPass ? <Loader className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                                        Update Password
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Admin Settings Section */}
            {isAdmin() && (
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <button
                        onClick={() => navigate('/settings')}
                        className="w-full px-6 py-5 flex items-center justify-between hover:bg-gray-50 transition-colors"
                    >
                        <div className="flex items-center gap-4">
                            <div className="p-3 bg-red-50 text-red-600 rounded-xl">
                                <Settings className="h-6 w-6" />
                            </div>
                            <div className="text-left">
                                <h3 className="font-bold text-gray-900">Admin Settings</h3>
                                <p className="text-sm text-gray-500">Configure session timeout, company name, and more</p>
                            </div>
                        </div>
                        <ChevronRight className="h-5 w-5 text-gray-400" />
                    </button>
                </div>
            )}
        </div>
    );
};

export default Profile;
