/**
 * ---
 * @anchor: .patterns/core-module
 * @spec: specs/vscode-extension.md#table-view
 * @task: TASK-024
 * @validated: null
 * ---
 */

import type { Database, DBRecord, Field } from 'sogo-db-core';
import { getFieldDisplayValue, getStatusColor, getFieldOptionColor } from 'sogo-db-core';
import { Badge } from '../shared/Badge.js';

interface TableCellProps {
	record: DBRecord;
	field: Field;
	database: Database;
	relationTitles?: Record<string, string>;
}

export function TableCell({ record, field, database, relationTitles }: TableCellProps) {
	const value = record[field.id];
	const displayValue = getFieldDisplayValue(record, field.id, database.schema, database);

	// Non-editable computed fields
	if (field.type === 'formula' || field.type === 'rollup' || field.type === 'createdAt' || field.type === 'lastEditedAt') {
		return <span style={{ opacity: 0.5 }}>{displayValue}</span>;
	}

	switch (field.type) {
		case 'checkbox':
			return (
				<span className="flex items-center">
					{value === true ? (
						<svg width="14" height="14" viewBox="0 0 16 16" fill="var(--vscode-focusBorder)">
							<rect x="1" y="1" width="14" height="14" rx="2" />
							<path d="M6.5 11.5l-3-3 1-1L6.5 9.5l5-5 1 1-6 6z" fill="var(--vscode-editor-background)" />
						</svg>
					) : (
						<svg width="14" height="14" viewBox="0 0 16 16">
							<rect x="1.5" y="1.5" width="13" height="13" rx="2" fill="none"
								stroke="var(--vscode-foreground)" strokeOpacity="0.3" />
						</svg>
					)}
				</span>
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
						<Badge key={id} label={relationTitles?.[id] ?? id.slice(0, 8)} />
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
