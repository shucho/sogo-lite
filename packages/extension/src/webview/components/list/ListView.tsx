/**
 * ---
 * @anchor: .patterns/core-module
 * @spec: specs/vscode-extension.md#list-view
 * @task: TASK-030
 * @validated: null
 * ---
 */

import { useState } from 'react';
import type { Database, DBRecord, DBView, Field } from 'sogo-db-core';
import { getFieldDisplayValue, getFieldOptionColor, getRecordTitle, getStatusColor, getVisibleFields } from 'sogo-db-core';
import { postCommand } from '../../hooks/useVSCodeApi.js';
import { Badge } from '../shared/Badge.js';
import { EmptyState } from '../shared/EmptyState.js';

interface ListViewProps {
	database: Database;
	view: DBView;
	records: DBRecord[];
	relationTitles?: Record<string, string>;
	onOpenRecord: (recordId: string) => void;
}

let lastListPropertyLabelWidth = 96;

export function ListView({ database, view, records, relationTitles, onOpenRecord }: ListViewProps) {
	const [propertyLabelWidth, setPropertyLabelWidth] = useState(lastListPropertyLabelWidth);

	if (records.length === 0) {
		return (
			<EmptyState
				title="No records"
				description="Create a record to get started."
				action={{ label: '+ New Record', onClick: () => postCommand({ type: 'create-record' }) }}
			/>
		);
	}

	const titleFieldId = database.schema.find((field) => field.type === 'text')?.id;
	const summaryFields = getVisibleFields(database.schema, view)
		.filter((field) => field.id !== titleFieldId);

	function handlePropertyResizeStart(event: React.PointerEvent<HTMLDivElement>) {
		event.preventDefault();
		event.stopPropagation();
		const startX = event.clientX;
		const startWidth = propertyLabelWidth;
		const min = 76;
		const max = 180;
		const prevCursor = document.body.style.cursor;
		const prevUserSelect = document.body.style.userSelect;
		document.body.style.cursor = 'col-resize';
		document.body.style.userSelect = 'none';
		const onMove = (moveEvent: PointerEvent) => {
			const next = Math.max(min, Math.min(max, startWidth + (moveEvent.clientX - startX)));
			lastListPropertyLabelWidth = next;
			setPropertyLabelWidth(next);
		};
		const onUp = () => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			document.body.style.cursor = prevCursor;
			document.body.style.userSelect = prevUserSelect;
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp, { once: true });
	}

	return (
		<div className="flex flex-col flex-1 overflow-y-auto">
			{records.map((record) => {
				const title = getRecordTitle(record, database.schema);
				const shownFields = summaryFields.filter((field) => {
					const value = record[field.id];
					return !(value == null || value === '' || (Array.isArray(value) && value.length === 0));
				});
				return (
					<div
						key={record.id}
						className="db-list-record group cursor-pointer"
						style={{ borderColor: 'var(--vscode-panel-border)' }}
						onClick={() => onOpenRecord(record.id)}
					>
						<div className="db-list-record-main">
							<div className="db-list-record-title">{title}</div>
							<div className="db-list-property-list">
								{shownFields.length > 0 ? shownFields.map((field) => (
									<div
										key={field.id}
										className="db-list-property-row"
										style={{ gridTemplateColumns: `${propertyLabelWidth}px 16px minmax(0, 1fr)` }}
									>
										<div className="db-list-property-label">{field.name}</div>
										<div
											className="db-list-property-divider"
											onPointerDown={handlePropertyResizeStart}
											onClick={(e) => e.stopPropagation()}
											role="separator"
											aria-orientation="vertical"
											aria-label="Resize list property label column"
										/>
										<div className="db-list-property-value">
											<ListPropertyValue
												record={record}
												field={field}
												database={database}
												relationTitles={relationTitles}
											/>
										</div>
									</div>
								)) : (
									<div className="db-list-property-empty">No visible properties</div>
								)}
							</div>
						</div>
						<button
							type="button"
							className="db-list-record-open text-xs opacity-0 group-hover:opacity-75 hover:opacity-100"
							title="Open record"
							onClick={(e) => {
								e.stopPropagation();
								onOpenRecord(record.id);
							}}
						>
							↗
						</button>
					</div>
				);
			})}
			<div
				className="px-4 py-2 text-xs opacity-70 hover:opacity-100 cursor-pointer"
				onClick={() => postCommand({ type: 'create-record' })}
			>
				+ New record
			</div>
		</div>
	);
}

function ListPropertyValue({
	record,
	field,
	database,
	relationTitles,
}: {
	record: DBRecord;
	field: Field;
	database: Database;
	relationTitles?: Record<string, string>;
}) {
	const rawValue = record[field.id];
	if (rawValue == null || rawValue === '' || (Array.isArray(rawValue) && rawValue.length === 0)) {
		return <span className="db-list-property-empty">—</span>;
	}

	if (field.type === 'status' && typeof rawValue === 'string') {
		return <Badge label={rawValue} color={getStatusColor(rawValue)} />;
	}
	if (field.type === 'select' && typeof rawValue === 'string') {
		return <Badge label={rawValue} color={getFieldOptionColor(field, rawValue)} />;
	}
	if (field.type === 'multiselect' && Array.isArray(rawValue)) {
		return (
			<div className="db-list-property-badges">
				{rawValue.map((value) => (
					<Badge key={value} label={value} color={getFieldOptionColor(field, value)} />
				))}
			</div>
		);
	}
	if (field.type === 'relation' && Array.isArray(rawValue)) {
		return (
			<div className="db-list-property-badges">
				{rawValue.map((id) => (
					<Badge key={id} label={relationTitles?.[id] ?? id.slice(0, 8)} />
				))}
			</div>
		);
	}
	if (typeof rawValue === 'boolean') {
		return <span>{rawValue ? 'Yes' : 'No'}</span>;
	}

	return <span className="truncate block">{getFieldDisplayValue(record, field.id, database.schema, database)}</span>;
}
