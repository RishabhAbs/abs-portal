import React from 'react';
import { MapPin, Loader2 } from 'lucide-react';

interface Props {
    visible: boolean;
    message?: string;
    hint?: string;
}

/**
 * Full-screen overlay shown while the app is acquiring a precise GPS fix and
 * submitting the check-in/check-out. High-accuracy location can take several
 * seconds to warm up — without this, the screen looks frozen.
 */
const GpsOverlay: React.FC<Props> = ({ visible, message = 'Acquiring precise location…', hint = 'Please stand still for a few seconds' }) => {
    if (!visible) return null;
    return (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6">
            <div className="bg-white rounded-2xl shadow-2xl px-8 py-7 max-w-sm w-full flex flex-col items-center text-center gap-4">
                <div className="relative">
                    <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center">
                        <MapPin className="w-8 h-8 text-blue-600" />
                    </div>
                    <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-white flex items-center justify-center shadow">
                        <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                    </div>
                </div>
                <div className="space-y-1">
                    <div className="text-sm font-bold text-gray-900">{message}</div>
                    <div className="text-xs text-gray-500">{hint}</div>
                </div>
            </div>
        </div>
    );
};

export default GpsOverlay;
