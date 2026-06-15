import { useMemo, useCallback } from 'react';
import { useAuth, ColumnPage, ALL_PAGE_COLUMNS } from '../context/AuthContext';

export interface ColumnDef {
  key: string;
  label: string;
  visible: boolean;
  copyable: boolean;
}

export function useColumnPermissions(page: ColumnPage) {
  const { getVisibleColumns, getCopyableColumns, isAdmin } = useAuth();

  const visibleKeys = useMemo(() => getVisibleColumns(page), [page, getVisibleColumns]);
  const copyableKeys = useMemo(() => getCopyableColumns(page), [page, getCopyableColumns]);

  const columns = useMemo<ColumnDef[]>(() => {
    return ALL_PAGE_COLUMNS[page].map(col => ({
      key: col.key,
      label: col.label,
      visible: visibleKeys.includes(col.key),
      copyable: copyableKeys.includes(col.key),
    }));
  }, [page, visibleKeys, copyableKeys]);

  const visibleColumns = useMemo(() => columns.filter(c => c.visible), [columns]);

  const isVisible = useCallback((key: string) => visibleKeys.includes(key), [visibleKeys]);
  const isCopyable = useCallback((key: string) => copyableKeys.includes(key), [copyableKeys]);

  // CSS style to prevent copy on non-copyable columns
  const cellStyle = useCallback((key: string): React.CSSProperties => {
    if (isAdmin() || copyableKeys.includes(key)) return {};
    return { userSelect: 'none', WebkitUserSelect: 'none' } as React.CSSProperties;
  }, [copyableKeys, isAdmin]);

  // onContextMenu handler to block right-click copy on non-copyable columns
  const onCellContextMenu = useCallback((key: string) => {
    if (isAdmin() || copyableKeys.includes(key)) return undefined;
    return (e: React.MouseEvent) => e.preventDefault();
  }, [copyableKeys, isAdmin]);

  return {
    columns,
    visibleColumns,
    isVisible,
    isCopyable,
    cellStyle,
    onCellContextMenu,
  };
}
