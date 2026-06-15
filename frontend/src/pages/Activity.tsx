import React from 'react';
import Activities from './Activities';

interface ActivityProps {
    viewMode?: 'sales' | 'purchase';
}

const Activity: React.FC<ActivityProps> = ({ viewMode = 'sales' }) => {
    return (
        <div className="w-full">
            <Activities viewMode={viewMode} />
        </div>
    );
};

export default Activity;
