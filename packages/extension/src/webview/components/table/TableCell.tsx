/**
 * ---
 * @anchor: .patterns/core-module
 * @spec: specs/vscode-extension.md#table-view
 * @task: TASK-024
 * @validated: null
 * ---
 */

import type { Database, DBRecord, Field } from 'sogo-db-core';
import { getFieldDisplayValue, getStatusColor, getFieldOptionColor, resolveRelationColor } from 'sogo-db-core';
import { Badge } from '../shared/Badge.js';
import { useThemeKind } from '../../hooks/useThemeColors.js';

interface TableCellProps {
	record: DBRecord;
	field: Field;
	database: Database;
	relationTitles?: Record<string, string>;
	onToggleCheckbox?: () => void;
}

export function TableCell({ record, field, database, relationTitles, onToggleCheckbox }: TableCellProps) {
	const theme = useThemeKind();
	const value = record[field.id];
	const displayValue = getFieldDisplayValue(record, field.id, database.schema, database);

	// Non-editable computed fields
	if (field.type === 'formula' || field.type === 'rollup' || field.type === 'createdAt' || field.type === 'lastEditedAt') {
		return <span style={{ opacity: 0.5 }}>{displayValue}</span>;
	}

	switch (field.type) {
		case 'checkbox':
			return (
				<button
					type="button"
					className="db-cell-checkbox-btn"
					onClick={(e) => {
						e.stopPropagation();
						onToggleCheckbox?.();
					}}
				>
					<svg
						className={`db-cell-checkbox${value === true ? ' db-cell-checkbox--checked' : ''}`}
						viewBox="0 0 14 14"
						aria-hidden="true"
					>
						<rect className="db-cell-checkbox-box" x="1.25" y="1.25" width="11.5" height="11.5" rx="3" />
						<path className="db-cell-checkbox-mark" d="M4 7.2 6.1 9.3 10 5.4" />
					</svg>
				</button>
			);
		case 'status':
			return displayValue ? (
				<Badge label={displayValue} color={getStatusColor(displayValue)} />
			) : (
				<span style={{ opacity: 0.25 }}>&mdash;</span>
			);
		case 'select':
			return displayValue ? (
				<Badge label={displayValue} color={getFieldOptionColor(field, displayValue)} />
			) : (
				<span style={{ opacity: 0.25 }}>&mdash;</span>
			);
		case 'multiselect': {
			const values = Array.isArray(value) ? value : [];
			return (
				<div className="flex gap-1 flex-wrap">
					{values.map((v) => (
						<Badge key={v} label={v} color={getFieldOptionColor(field, v)} />
					))}
					{values.length === 0 && <span style={{ opacity: 0.25 }}>&mdash;</span>}
				</div>
			);
		}
		case 'relation': {
			const ids = Array.isArray(value) ? value : [];
			return (
				<div className="flex gap-1 flex-wrap">
					{ids.map((id) => (
						<Badge key={id} label={relationTitles?.[id] ?? id.slice(0, 8)} color={resolveRelationColor(relationTitles?.[id] ?? id, theme)} />
					))}
					{ids.length === 0 && <span style={{ opacity: 0.25 }}>&mdash;</span>}
				</div>
			);
		}
		case 'url':
			return displayValue ? (
				<a
					href={displayValue}
					className="underline"
					style={{ color: 'var(--vscode-textLink-foreground)' }}
					onClick={(e) => e.stopPropagation()}
				>
					{displayValue}
				</a>
				) : (
					<span style={{ opacity: 0.25 }}>&mdash;</span>
				);
			default:
				return (
					<span
						className="block truncate"
						title={displayValue}
					>
					{displayValue || <span style={{ opacity: 0.25 }}>&mdash;</span>}
				</span>
			);
	}
}
