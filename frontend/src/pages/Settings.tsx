import React, { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Save, Clock, Building2, Key, FileSpreadsheet, Loader, Check, RotateCcw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast/Toast';

interface AppSettings {
    sessionTimeoutMinutes: number;
    companyName: string;
    defaultPassword: string;
    enableExcelExport: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
    sessionTimeoutMinutes: 30,
    companyName: 'ABS Technologies',
    defaultPassword: 'password123',
    enableExcelExport: true
};

const Settings: React.FC = () => {
    const { isAdmin } = useAuth();
    const { showSuccess, showError } = useToast();

    const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
    const [isSaving, setIsSaving] = useState(false);
    const [hasChanges, setHasChanges] = useState(false);

    // Load settings from localStorage on mount
    useEffect(() => {
        const saved = localStorage.getItem('app_settings');
        if (saved) {
            try {
                setSettings(JSON.parse(saved));
            } catch {
                // Use defaults
            }
        }
    }, []);

    // Track changes
    const handleChange = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
        setSettings(prev => ({ ...prev, [key]: value }));
        setHasChanges(true);
    };

    const [resetConfirm, setResetConfirm] = useState(false);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            // Save to localStorage (in production, this would go to backend)
            localStorage.setItem('app_settings', JSON.stringify(settings));
            showSuccess('Saved', 'Settings updated successfully');
            setHasChanges(false);
        } catch (error) {
            showError('Error', 'Failed to save settings');
        } finally {
            setIsSaving(false);
        }
    };

    const handleReset = () => {
        setResetConfirm(true);
    };

    const confirmReset = () => {
        setSettings(DEFAULT_SETTINGS);
        localStorage.removeItem('app_settings');
        setHasChanges(false);
        showSuccess('Reset', 'Settings restored to defaults');
        setResetConfirm(false);
    };

    if (!isAdmin()) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] text-gray-400">
                <SettingsIcon className="h-12 w-12 mb-3" />
                <p className="font-medium">Access Denied</p>
                <p className="text-sm">Admin privileges required</p>
            </div>
        );
    }

    return (
        <div className="max-w-3xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
                    <p className="text-sm text-gray-500">Configure application settings</p>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={handleReset}
                        className="flex items-center gap-2 px-4 py-2 text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 text-sm font-medium transition-colors"
                    >
                        <RotateCcw className="h-4 w-4" />
                        Reset
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={!hasChanges || isSaving}
                        className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold transition-colors"
                    >
                        {isSaving ? <Loader className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        Save Changes
                    </button>
                </div>
            </div>

            {/* Session Settings */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
                    <div className="flex items-center gap-3">
                        <Clock className="h-5 w-5 text-blue-600" />
                        <h2 className="font-bold text-gray-900">Session & Security</h2>
                    </div>
                </div>
                <div className="p-6 space-y-5">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                        <div>
                            <label className="block font-medium text-gray-900">Session Timeout</label>
                            <p className="text-sm text-gray-500">Lock session after inactivity (minutes)</p>
                        </div>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                min={1}
                                max={120}
                                value={settings.sessionTimeoutMinutes}
                                onChange={e => handleChange('sessionTimeoutMinutes', Math.max(1, Math.min(120, parseInt(e.target.value) || 30)))}
                                className="w-24 px-3 py-2 text-center border border-gray-200 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                            />
                            <span className="text-sm text-gray-500">min</span>
                        </div>
                    </div>

                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-4 border-t border-gray-100">
                        <div>
                            <label className="block font-medium text-gray-900">Default Password</label>
                            <p className="text-sm text-gray-500">Password assigned to new users</p>
                        </div>
                        <input
                            type="text"
                            value={settings.defaultPassword}
                            onChange={e => handleChange('defaultPassword', e.target.value)}
                            className="w-full md:w-48 px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none font-mono text-sm"
                            placeholder="password123"
                        />
                    </div>
                </div>
            </div>

            {/* Company Settings */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
                    <div className="flex items-center gap-3">
                        <Building2 className="h-5 w-5 text-purple-600" />
                        <h2 className="font-bold text-gray-900">Company</h2>
                    </div>
                </div>
                <div className="p-6">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                        <div>
                            <label className="block font-medium text-gray-900">Company Name</label>
                            <p className="text-sm text-gray-500">Displayed in headers and exports</p>
                        </div>
                        <input
                            type="text"
                            value={settings.companyName}
                            onChange={e => handleChange('companyName', e.target.value)}
                            className="w-full md:w-64 px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
                            placeholder="Company Name"
                        />
                    </div>
                </div>
            </div>

            {/* Export Settings */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
                    <div className="flex items-center gap-3">
                        <FileSpreadsheet className="h-5 w-5 text-green-600" />
                        <h2 className="font-bold text-gray-900">Data Export</h2>
                    </div>
                </div>
                <div className="p-6">
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <label className="block font-medium text-gray-900">Excel Export</label>
                            <p className="text-sm text-gray-500">Allow users to export data as Excel files</p>
                        </div>
                        <button
                            onClick={() => handleChange('enableExcelExport', !settings.enableExcelExport)}
                            className={`relative w-14 h-7 rounded-full transition-colors ${settings.enableExcelExport ? 'bg-green-500' : 'bg-gray-300'}`}
                        >
                            <span
                                className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow transition-transform ${settings.enableExcelExport ? 'left-8' : 'left-1'}`}
                            />
                        </button>
                    </div>
                </div>
            </div>

            {/* Info */}
            <div className="text-center text-xs text-gray-400 py-4">
                Settings are stored locally. Changes take effect after save.
            </div>
            {/* Reset Confirmation Modal */}
            {resetConfirm && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden">
                        <div className="p-6">
                            <div className="flex items-center gap-3 mb-4 text-gray-700">
                                <RotateCcw className="h-6 w-6" />
                                <h3 className="text-lg font-bold">Reset Settings?</h3>
                            </div>
                            <p className="text-gray-600 mb-6">Are you sure you want to reset all settings to defaults? This action cannot be undone.</p>
                            <div className="flex justify-end gap-3">
                                <button
                                    onClick={() => setResetConfirm(false)}
                                    className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors font-medium"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={confirmReset}
                                    className="px-4 py-2 bg-gray-900 text-white hover:bg-black rounded-lg transition-colors font-medium shadow-sm"
                                >
                                    Yes, Reset All
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Settings;
