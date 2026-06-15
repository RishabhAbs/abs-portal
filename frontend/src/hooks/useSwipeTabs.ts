import { useRef, useCallback, TouchEvent } from 'react';

/**
 * Hook to enable swipe left/right to switch between tabs on mobile.
 * Returns touch event handlers to attach to the swipeable content container.
 */
export function useSwipeTabs<T>(
  tabs: readonly T[],
  activeTab: T,
  setActiveTab: (tab: T) => void,
  threshold = 80
) {
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const swiping = useRef(false);

  const onTouchStart = useCallback((e: TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    swiping.current = false;
  }, []);

  const onTouchEnd = useCallback((e: TouchEvent) => {
    const deltaX = e.changedTouches[0].clientX - touchStartX.current;
    const deltaY = e.changedTouches[0].clientY - touchStartY.current;

    // Only trigger if horizontal swipe is dominant (not vertical scroll)
    if (Math.abs(deltaX) < threshold || Math.abs(deltaY) > Math.abs(deltaX)) return;

    const currentIndex = tabs.indexOf(activeTab);
    if (currentIndex === -1) return;

    if (deltaX < -threshold && currentIndex < tabs.length - 1) {
      // Swipe left → next tab
      setActiveTab(tabs[currentIndex + 1]);
    } else if (deltaX > threshold && currentIndex > 0) {
      // Swipe right → previous tab
      setActiveTab(tabs[currentIndex - 1]);
    }
  }, [tabs, activeTab, setActiveTab, threshold]);

  return { onTouchStart, onTouchEnd };
}
