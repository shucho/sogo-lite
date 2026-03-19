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
	relationTitles?: Record<string, string>;
	cardFieldIds?: string[];
	collapsed: boolean;
	onToggleCollapse: () => void;
	onAddRecord: () => void;
	onOpenRecord: (recordId: string) => void;
}

export function KanbanColumn({
	columnValue,
	label,
	records,
	groupField,
	database,
	relationTitles,
	cardFieldIds,
	collapsed,
	onToggleCollapse,
	onAddRecord,
	onOpenRecord,
}: KanbanColumnProps) {
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
				<button className="text-xs opacity-45 hover:opacity-100" onClick={onToggleCollapse} title="Collapse column">
					{collapsed ? '+' : '−'}
				</button>
			</div>
			<div className={`flex-1 px-2 pb-2 space-y-1.5 overflow-y-auto min-h-[60px] ${collapsed ? 'hidden' : ''}`}>
				{records.map((record) => (
					<KanbanCard
						key={record.id}
						record={record}
						database={database}
						relationTitles={relationTitles}
						cardFieldIds={cardFieldIds}
						onOpenRecord={onOpenRecord}
					/>
				))}
			</div>
			{!collapsed && (
				<button className="text-xs px-3 py-2 text-left opacity-70 hover:opacity-100" onClick={onAddRecord}>
					+ Add
				</button>
			)}
		</div>
	);
}
