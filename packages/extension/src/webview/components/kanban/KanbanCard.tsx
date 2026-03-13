/**
 * ---
 * @anchor: .patterns/core-module
 * @spec: specs/vscode-extension.md#kanban-view
 * @task: TASK-027
 * @validated: null
 * ---
 */

import { useMemo } from 'react';
import { useDraggable } from '@dnd-kit/core';
import type { Database, DBRecord, Field } from 'sogo-db-core';
import { getFieldDisplayValue, getFieldOptionColor, getRecordTitle, getStatusColor } from 'sogo-db-core';
import { postCommand } from '../../hooks/useVSCodeApi.js';
import { Badge } from '../shared/Badge.js';

interface KanbanCardProps {
	record: DBRecord;
	database: Database;
	relationTitles?: Record<string, string>;
	cardFieldIds?: string[];
	onOpenRecord: (recordId: string) => void;
}

export function KanbanCard({ record, database, relationTitles, cardFieldIds, onOpenRecord }: KanbanCardProps) {
	const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
		id: record.id,
	});

	const title = getRecordTitle(record, database.schema);
	const statusField = database.schema.find((field) => field.type === 'status');
	const statusValue = statusField ? record[statusField.id] : undefined;

	const fieldsToShow = useMemo(() => {
		if (cardFieldIds?.length) {
			return database.schema.filter((field) => cardFieldIds.includes(field.id)).slice(0, 3);
		}
		return database.schema.filter((field) => field.type !== 'text').slice(0, 3);
	}, [database.schema, cardFieldIds]);

	const style = transform
		? {
				transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
				opacity: isDragging ? 0.5 : 1,
			}
		: undefined;

	return (
		<div
			ref={setNodeRef}
			{...listeners}
			{...attributes}
			className="group rounded px-3 py-2 text-xs cursor-grab active:cursor-grabbing shadow-sm hover:shadow relative"
			style={{
				backgroundColor: 'var(--vscode-editor-background)',
				border: '1px solid var(--vscode-panel-border)',
				...style,
			}}
			onClick={() => onOpenRecord(record.id)}
		>
			{typeof statusValue === 'string' && statusValue ? (
				<div
					className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l"
					style={{ backgroundColor: getStatusColor(statusValue) }}
				/>
			) : null}

			<div className="font-medium text-xs mb-1 truncate">{title}</div>
			{fieldsToShow.map((field) => {
				return <KanbanFieldRow key={field.id} field={field} record={record} database={database} relationTitles={relationTitles} />;
			})}

			<div className="absolute right-1.5 top-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
				<button
					className="text-[11px] opacity-65 hover:opacity-100"
					title="Duplicate"
					onClick={(e) => {
						e.stopPropagation();
						postCommand({ type: 'duplicate-record', recordId: record.id });
					}}
				>
					⧉
				</button>
				<button
					className="text-[11px] opacity-65 hover:opacity-100"
					style={{ color: 'var(--vscode-errorForeground)' }}
					title="Delete"
					onClick={(e) => {
						e.stopPropagation();
						postCommand({ type: 'delete-record', recordId: record.id });
					}}
				>
					🗑
				</button>
			</div>
		</div>
	);
}

function KanbanFieldRow({
	field,
	record,
	database,
	relationTitles,
}: {
	field: Field;
	record: DBRecord;
	database: Database;
	relationTitles?: Record<string, string>;
}) {
	const value = record[field.id];
	const display = getFieldDisplayValue(record, field.id, database.schema, database);

	if (field.type === 'status' && typeof value === 'string' && value) {
		return (
			<div className="mt-1 flex flex-wrap gap-1">
				<Badge label={value} color={getStatusColor(value)} />
			</div>
		);
	}

	if (field.type === 'select' && typeof value === 'string' && value) {
		return (
			<div className="mt-1 flex flex-wrap gap-1">
				<Badge label={value} color={getFieldOptionColor(field, value)} />
			</div>
		);
	}

	if (field.type === 'multiselect' && Array.isArray(value) && value.length > 0) {
		return (
			<div className="mt-1 flex flex-wrap gap-1">
				{value.map((option) => (
					<Badge key={option} label={option} color={getFieldOptionColor(field, option)} />
				))}
			</div>
		);
	}

	if (field.type === 'relation' && Array.isArray(value) && value.length > 0) {
		return (
			<div className="mt-1 flex flex-wrap gap-1">
				{value.map((id) => (
					<Badge key={id} label={relationTitles?.[id] ?? id.slice(0, 8)} />
				))}
			</div>
		);
	}

	if (!display) return null;
	return (
		<div className="text-[11px] opacity-70 truncate mt-1">
			{field.name}: {display}
		</div>
	);
}
