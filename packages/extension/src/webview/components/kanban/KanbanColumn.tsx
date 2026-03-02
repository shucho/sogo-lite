/**
 * ---
 * @anchor: .patterns/core-module
 * @spec: specs/vscode-extension.md#kanban-view
 * @task: TASK-027
 * @validated: null
 * ---
 */

import { useDroppable } from '@dnd-kit/core';
import type { Database, DBRecord, Field } from 'sogo-db-core';
import { resolveStatusColor, resolveFieldOptionColor } from 'sogo-db-core';
import { useThemeKind } from '../../hooks/useThemeColors.js';
import { KanbanCard } from './KanbanCard.js';

interface KanbanColumnProps {
	columnValue: string;
	label: string;
	records: DBRecord[];
	groupField: Field;
	database: Database;
	onOpenRecord: (recordId: string) => void;
}

export function KanbanColumn({ columnValue, label, records, groupField, database, onOpenRecord }: KanbanColumnProps) {
	const { setNodeRef, isOver } = useDroppable({ id: columnValue });
	const theme = useThemeKind();

	const headerColor =
		groupField.type === 'status'
			? resolveStatusColor(label, theme)
			: resolveFieldOptionColor(groupField, label, theme);

	return (
		<div
			ref={setNodeRef}
			className="flex-shrink-0 w-[260px] rounded-lg flex flex-col"
			style={{
				backgroundColor: isOver
					? 'var(--vscode-list-hoverBackground)'
					: 'var(--vscode-sideBar-background)',
			}}
		>
			<div className="flex items-center gap-2 px-3 py-2">
				{label && (
					<span
						className="w-2.5 h-2.5 rounded-full flex-shrink-0"
						style={{ backgroundColor: headerColor }}
					/>
				)}
				<span className="text-xs font-medium truncate">{label || 'No value'}</span>
				<span className="text-xs opacity-40 ml-auto">{records.length}</span>
			</div>
			<div className="flex-1 px-2 pb-2 space-y-1.5 overflow-y-auto min-h-[60px]">
				{records.map((record) => (
					<KanbanCard key={record.id} record={record} database={database} onOpenRecord={onOpenRecord} />
				))}
			</div>
		</div>
	);
}
