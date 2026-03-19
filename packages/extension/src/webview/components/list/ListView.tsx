/**
 * ---
 * @anchor: .patterns/core-module
 * @spec: specs/vscode-extension.md#list-view
 * @task: TASK-030
 * @validated: null
 * ---
 */

import type { Database, DBRecord, DBView } from 'sogo-db-core';
import { getFieldValue, getRecordTitle, getStatusColor, getVisibleFields } from 'sogo-db-core';
import { postCommand } from '../../hooks/useVSCodeApi.js';
import { EmptyState } from '../shared/EmptyState.js';

interface ListViewProps {
	database: Database;
	view: DBView;
	records: DBRecord[];
	relationTitles?: Record<string, string>;
	onOpenRecord: (recordId: string) => void;
}

export function ListView({ database, view, records, onOpenRecord }: ListViewProps) {
	if (records.length === 0) {
		return (
			<EmptyState
				title="No records"
				description="Create a record to get started."
				action={{ label: '+ New Record', onClick: () => postCommand({ type: 'create-record' }) }}
			/>
		);
	}

	const summaryFields = getVisibleFields(database.schema, view).slice(1, 3);
	const statusField = database.schema.find((field) => field.type === 'status');

	return (
		<div className="flex flex-col flex-1 overflow-y-auto">
			{records.map((record) => {
				const title = getRecordTitle(record, database.schema);
				const meta = summaryFields
					.map((field) => {
						const value = getFieldValue(record, field, database);
						if (value == null || value === '') return '';
						if (Array.isArray(value)) return value.join(', ');
						if (typeof value === 'boolean') return `${field.name}: ${value ? '✓' : '—'}`;
						return String(value);
					})
					.filter(Boolean)
					.join('  ·  ');
				const statusValue = statusField ? record[statusField.id] : undefined;
				return (
					<div
						key={record.id}
						className="group flex items-center gap-3 px-4 py-2 border-b cursor-pointer hover:opacity-80"
						style={{ borderColor: 'var(--vscode-panel-border)' }}
						onClick={() => onOpenRecord(record.id)}
					>
						{statusField && (
							<span
								className="w-2 h-2 rounded-full flex-shrink-0"
								style={{
									backgroundColor: typeof statusValue === 'string' && statusValue
										? getStatusColor(statusValue)
										: 'var(--vscode-descriptionForeground)',
								}}
							/>
						)}
						<div className="flex-1 min-w-0">
							<div className="font-medium text-sm truncate">{title}</div>
							<div className="text-xs opacity-60 truncate">{meta || '—'}</div>
						</div>
						<button
							className="text-xs opacity-0 group-hover:opacity-75 hover:opacity-100"
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
