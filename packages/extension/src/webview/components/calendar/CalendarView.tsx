/**
 * ---
 * @anchor: .patterns/core-module
 * @spec: specs/vscode-extension.md#calendar-view
 * @task: TASK-028
 * @validated: null
 * ---
 */

import { useMemo, useState } from 'react';
import type { Database, DBRecord, DBView } from 'sogo-db-core';
import { getRecordTitle } from 'sogo-db-core';
import { EmptyState } from '../shared/EmptyState.js';
import { postCommand } from '../../hooks/useVSCodeApi.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface CalendarViewProps {
	database: Database;
	view: DBView;
	records: DBRecord[];
	relationTitles?: Record<string, string>;
	onOpenRecord: (recordId: string) => void;
}

export function CalendarView({ database, view, records, onOpenRecord }: CalendarViewProps) {
	const [month, setMonth] = useState(() => {
		const now = new Date();
		return { year: now.getFullYear(), month: now.getMonth() };
	});

	const dateField = useMemo(
		() =>
			database.schema.find((f) => f.id === view.groupBy && f.type === 'date')
			?? database.schema.find((f) => f.type === 'date'),
		[database.schema, view.groupBy],
	);

	const days = useMemo(() => {
		const first = new Date(month.year, month.month, 1);
		const last = new Date(month.year, month.month + 1, 0);
		const startDay = first.getDay();
		const totalDays = last.getDate();

		const grid: Array<{ date: number | null; records: DBRecord[] }> = [];

		// Padding before month starts
		for (let i = 0; i < startDay; i++) {
			grid.push({ date: null, records: [] });
		}

		// Days of month
		for (let d = 1; d <= totalDays; d++) {
			const dateStr = `${month.year}-${String(month.month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
			const dayRecords = dateField
				? records.filter((r) => {
						const val = String(r[dateField.id] ?? '');
						return val.startsWith(dateStr);
					})
				: [];
			grid.push({ date: d, records: dayRecords });
		}

		return grid;
	}, [month, records, dateField]);

	if (!dateField) {
		return (
			<EmptyState
				title="No date field"
				description="Calendar view requires a date field to group by."
			/>
		);
	}

	const monthLabel = new Date(month.year, month.month).toLocaleDateString('en-US', {
		month: 'long',
		year: 'numeric',
	});

	function createRecord(dateValue?: string) {
		if (!dateField) {
			postCommand({ type: 'create-record' });
			return;
		}
		postCommand({
			type: 'create-record',
			values: dateValue ? { [dateField.id]: dateValue } : undefined,
		});
	}

	return (
		<div className="flex flex-col flex-1 p-3">
			<div className="flex items-center justify-between mb-3">
				<button
					className="px-2 py-1 rounded text-xs hover:opacity-80"
					style={{ backgroundColor: 'var(--vscode-button-secondaryBackground)' }}
					onClick={() =>
						setMonth((m) => {
							const d = new Date(m.year, m.month - 1);
							return { year: d.getFullYear(), month: d.getMonth() };
						})
					}
				>
					&lt;
				</button>
				<span className="text-sm font-medium">{monthLabel}</span>
				<div className="flex items-center gap-2">
					<button
						className="px-2 py-1 rounded text-xs hover:opacity-80"
						style={{ backgroundColor: 'var(--vscode-button-secondaryBackground)' }}
						onClick={() =>
							setMonth((m) => {
								const d = new Date(m.year, m.month + 1);
								return { year: d.getFullYear(), month: d.getMonth() };
							})
						}
					>
						&gt;
					</button>
					<button
						className="px-2 py-1 rounded text-xs hover:opacity-80"
						style={{ backgroundColor: 'var(--vscode-button-background)', color: 'var(--vscode-button-foreground)' }}
						onClick={() => createRecord()}
					>
						+ Record
					</button>
				</div>
			</div>

			<div className="grid grid-cols-7 gap-px flex-1" style={{ backgroundColor: 'var(--vscode-panel-border)' }}>
				{WEEKDAYS.map((day) => (
					<div
						key={day}
						className="px-2 py-1 text-xs font-medium text-center"
						style={{ backgroundColor: 'var(--vscode-editor-background)' }}
					>
						{day}
					</div>
				))}
				{days.map((day, i) => (
					<div
						key={i}
						className="min-h-[80px] p-1"
						style={{
							backgroundColor: day.date
								? 'var(--vscode-editor-background)'
								: 'var(--vscode-sideBar-background)',
						}}
						onDoubleClick={() => {
							if (!day.date || !dateField) return;
							const dateValue = `${month.year}-${String(month.month + 1).padStart(2, '0')}-${String(day.date).padStart(2, '0')}`;
							createRecord(dateValue);
						}}
					>
						{day.date && (
							<>
								<div className="text-xs opacity-50 mb-0.5">{day.date}</div>
								{day.records.slice(0, 3).map((record) => (
									<div
										key={record.id}
										className="text-[10px] truncate rounded px-1 py-0.5 mb-0.5 cursor-pointer hover:opacity-80"
										style={{
											backgroundColor: 'var(--vscode-badge-background)',
											color: 'var(--vscode-badge-foreground)',
										}}
										onClick={() => onOpenRecord(record.id)}
									>
										{getRecordTitle(record, database.schema)}
									</div>
								))}
								{day.records.length > 3 && (
									<div className="text-[10px] opacity-40">+{day.records.length - 3} more</div>
								)}
							</>
						)}
					</div>
				))}
			</div>
		</div>
	);
}
