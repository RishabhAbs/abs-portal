import React, { useRef, useState } from 'react';

interface SwipeAction {
  label: string;
  color: string;
  onClick: () => void;
}

interface SwipeableCardProps {
  children: React.ReactNode;
  actions: SwipeAction[];
}

const SwipeableCard: React.FC<SwipeableCardProps> = ({ children, actions }) => {
  const startXRef = useRef(0);
  const currentXRef = useRef(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const [swiping, setSwiping] = useState(false);

  const ACTION_WIDTH = 72;
  const maxSwipe = Math.min(actions.length * ACTION_WIDTH, 288);

  const startYRef = useRef(0);
  const isHorizontalSwipe = useRef(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    startXRef.current = e.touches[0].clientX;
    startYRef.current = e.touches[0].clientY;
    currentXRef.current = offset;
    isHorizontalSwipe.current = false;
    setSwiping(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!swiping) return;
    const diffX = startXRef.current - e.touches[0].clientX;
    const diffY = e.touches[0].clientY - startYRef.current;

    // Once we determine direction, lock it in
    if (!isHorizontalSwipe.current && (Math.abs(diffX) > 10 || Math.abs(diffY) > 10)) {
      isHorizontalSwipe.current = Math.abs(diffX) > Math.abs(diffY);
    }

    if (!isHorizontalSwipe.current) return;

    const newOffset = Math.max(0, Math.min(maxSwipe, currentXRef.current + diffX));
    setOffset(newOffset);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    setSwiping(false);

    // If this was a horizontal card swipe, stop it from reaching tab swipe handler
    if (isHorizontalSwipe.current) {
      e.stopPropagation();
    }

    // Snap: if dragged more than half an action width, open fully; otherwise close
    if (offset > ACTION_WIDTH / 2) {
      setOffset(maxSwipe);
    } else {
      setOffset(0);
    }
  };

  const handleActionClick = (action: SwipeAction) => {
    setOffset(0);
    action.onClick();
  };

  return (
    <div className="relative overflow-hidden rounded-xl">
      {/* Action buttons behind the card */}
      <div className="absolute inset-y-0 right-0 flex items-stretch" style={{ width: maxSwipe }}>
        {actions.map((action, i) => (
          <button
            key={i}
            onClick={() => handleActionClick(action)}
            className={`${action.color} text-white flex items-center justify-center text-xs font-bold flex-1 min-w-[60px] active:opacity-80 transition-opacity`}
          >
            {action.label}
          </button>
        ))}
      </div>

      {/* Swipeable card content */}
      <div
        ref={cardRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          transform: `translateX(-${offset}px)`,
          transition: swiping ? 'none' : 'transform 0.25s ease-out',
        }}
        className="relative z-10"
      >
        {children}
      </div>
    </div>
  );
};

export default SwipeableCard;
