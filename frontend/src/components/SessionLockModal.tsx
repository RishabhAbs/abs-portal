import React, { useState, useEffect, useCallback } from 'react';
import { Lock, Loader, ShieldAlert, LogOut } from 'lucide-react';
import { authApi } from '../services/api';

interface SessionLockModalProps {
    onUnlock: () => void;
    onLogout: () => void;
}

const SESSION_TIMEOUT_MS = 60 * 1000; // 1 minute to enter code
const MAX_ATTEMPTS = 3;

const SessionLockModal: React.FC<SessionLockModalProps> = ({ onUnlock, onLogout }) => {
    const [otp, setOtp] = useState('');
    const [isVerifying, setIsVerifying] = useState(false);
    const [error, setError] = useState('');
    const [attempts, setAttempts] = useState(0);
    const [timeLeft, setTimeLeft] = useState(SESSION_TIMEOUT_MS / 1000);

    // Countdown timer
    useEffect(() => {
        if (timeLeft <= 0) {
            onLogout();
            return;
        }
        const timer = setInterval(() => {
            setTimeLeft(prev => prev - 1);
        }, 1000);
        return () => clearInterval(timer);
    }, [timeLeft, onLogout]);

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const handleUnlock = useCallback(async () => {
        if (otp.length !== 6) {
            setError('Enter a 6-digit code');
            return;
        }

        setIsVerifying(true);
        setError('');

        try {
            const result = await authApi.unlockSession(otp);
            if (result.success) {
                onUnlock();
            } else {
                const newAttempts = attempts + 1;
                setAttempts(newAttempts);
                if (newAttempts >= MAX_ATTEMPTS) {
                    onLogout();
                } else {
                    setError(`Invalid code. ${MAX_ATTEMPTS - newAttempts} attempt(s) remaining`);
                    setOtp('');
                }
            }
        } catch {
            const newAttempts = attempts + 1;
            setAttempts(newAttempts);
            if (newAttempts >= MAX_ATTEMPTS) {
                onLogout();
            } else {
                setError(`Failed to verify. ${MAX_ATTEMPTS - newAttempts} attempt(s) remaining`);
                setOtp('');
            }
        } finally {
            setIsVerifying(false);
        }
    }, [otp, attempts, onUnlock, onLogout]);

    return (
        <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-sm rounded-xl shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="bg-gradient-to-r from-red-600 to-red-700 px-6 py-5 text-white text-center">
                    <div className="mx-auto w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mb-3">
                        <Lock className="h-8 w-8" />
                    </div>
                    <h2 className="text-xl font-bold">Session Locked</h2>
                    <p className="text-red-100 text-sm mt-1">Enter your 2FA code to continue</p>
                </div>

                {/* Content */}
                <div className="p-6 space-y-4">
                    {/* Timer */}
                    <div className={`text-center py-2 rounded-lg ${timeLeft <= 15 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'}`}>
                        <span className="text-xs uppercase font-bold tracking-wider">Time Remaining</span>
                        <div className={`text-2xl font-mono font-bold ${timeLeft <= 15 ? 'animate-pulse' : ''}`}>
                            {formatTime(timeLeft)}
                        </div>
                    </div>

                    {/* OTP Input */}
                    <div>
                        <input
                            type="text"
                            value={otp}
                            onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            placeholder="000000"
                            className="w-full text-center text-3xl font-mono tracking-[0.5em] py-3 border-2 border-gray-300 rounded-lg focus:border-red-500 focus:ring-2 focus:ring-red-200 outline-none"
                            maxLength={6}
                            autoFocus
                        />
                    </div>

                    {/* Error */}
                    {error && (
                        <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 px-3 py-2 rounded-lg">
                            <ShieldAlert className="h-4 w-4 flex-shrink-0" />
                            {error}
                        </div>
                    )}

                    {/* Attempts counter */}
                    <div className="text-center text-xs text-gray-500">
                        Attempts: {attempts}/{MAX_ATTEMPTS}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3">
                        <button
                            onClick={onLogout}
                            className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 flex items-center justify-center gap-2"
                        >
                            <LogOut className="h-4 w-4" />
                            Logout
                        </button>
                        <button
                            onClick={handleUnlock}
                            disabled={isVerifying || otp.length !== 6}
                            className="flex-1 py-3 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                        >
                            {isVerifying ? <Loader className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                            Unlock
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SessionLockModal;
