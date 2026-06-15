import { ColumnPermissions, ALL_PAGE_COLUMNS } from '../services/users.service';

/**
 * Filter data rows to only include columns the user is allowed to see.
 * Acts as a server-side guard — hidden columns are never sent to the client.
 *
 * @param data - Array of data objects (rows)
 * @param columnPerms - The user's column permissions
 * @param page - The page key (e.g., 'servers', 'customer_search')
 * @returns Filtered data with only visible columns
 */
export function filterColumns<T extends Record<string, any>>(
  data: T[],
  columnPerms: ColumnPermissions | undefined,
  page: keyof ColumnPermissions,
): T[] {
  if (!columnPerms) return data;

  const pagePerms = columnPerms[page];
  if (!pagePerms || !Array.isArray(pagePerms.visible)) return data;

  const allCols = ALL_PAGE_COLUMNS[page];
  if (!allCols) return data;

  // Find columns that should be hidden (in allCols but not in visible)
  const hiddenCols = allCols.filter(col => !pagePerms.visible.includes(col));
  if (hiddenCols.length === 0) return data; // Nothing to filter

  return data.map(row => {
    const filtered = { ...row };
    for (const col of hiddenCols) {
      delete filtered[col];
    }
    return filtered;
  });
}

/**
 * Get which columns are copyable for a given page.
 * This info is sent to the frontend so it can apply CSS restrictions.
 */
export function getCopyableColumns(
  columnPerms: ColumnPermissions | undefined,
  page: keyof ColumnPermissions,
): string[] {
  if (!columnPerms) return [];
  const pagePerms = columnPerms[page];
  if (!pagePerms || !Array.isArray(pagePerms.copyable)) return [];
  return pagePerms.copyable;
}
