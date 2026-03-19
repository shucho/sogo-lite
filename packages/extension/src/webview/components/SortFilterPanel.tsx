/**
 * ---
 * @anchor: .patterns/core-module
 * @spec: specs/vscode-extension.md#sort-filter
 * @task: TASK-026
 * @validated: null
 * ---
 */

import { useEffect, useRef } from 'react';
import type { DBView, Field } from 'sogo-db-core';
import { postCommand } from '../hooks/useVSCodeApi.js';

const FILTER_OPS_TEXT = [
	{ value: 'contains', label: 'contains' },
	{ value: 'not_contains', label: 'does not contain' },
	{ value: 'equals', label: 'equals' },
	{ value: 'not_equals', label: 'does not equal' },
	{ value: 'is_empty', label: 'is empty' },
	{ value: 'is_not_empty', label: 'is not empty' },
];

const FILTER_OPS_NUMBER = [
	{ value: 'equals', label: '=' },
	{ value: 'not_equals', label: '\u2260' },
	{ value: 'gt', label: '>' },
	{ value: 'gte', label: '\u2265' },
	{ value: 'lt', label: '<' },
	{ value: 'lte', label: '\u2264' },
	{ value: 'is_empty', label: 'is empty' },
	{ value: 'is_not_empty', label: 'is not empty' },
];

const FILTER_OPS_CHECKBOX = [
	{ value: 'equals', label: 'is' },
	{ value: 'not_equals', label: 'is not' },
	{ value: 'is_empty', label: 'is empty' },
	{ value: 'is_not_empty', label: 'is not empty' },
];

function getOpsForField(field: Field | undefined) {
	if (!field) return FILTER_OPS_TEXT;
	if (field.type === 'number') return FILTER_OPS_NUMBER;
	if (field.type === 'checkbox') return FILTER_OPS_CHECKBOX;
	return FILTER_OPS_TEXT;
}

function getDefaultOpForField(field: Field | undefined): string {
	if (!field) return 'contains';
	if (field.type === 'number' || field.type === 'checkbox') return 'equals';
	return 'contains';
}

function opNeedsValue(op: string): boolean {
	return op !== 'is_empty' && op !== 'is_not_empty';
}

interface SortFilterPanelProps {
	mode: 'sort' | 'filter';
	view: DBView;
	schema: Field[];
	onClose: () => void;
}

export function SortFilterPanel({ mode, view, schema, onClose }: SortFilterPanelProps) {
	const panelRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		function handleClickOutside(e: MouseEvent) {
			if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
				onClose();
			}
		}
		document.addEventListener('mousedown', handleClickOutside);
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, [onClose]);

	function updateView(changes: Partial<Pick<DBView, 'sort' | 'filter'>>) {
		postCommand({ type: 'update-view', viewId: view.id, changes });
	}

	if (mode === 'sort') {
		const sorts = [...view.sort];
		return (
			<div ref={panelRef} className="db-dropdown-panel absolute right-0 top-full z-50 mt-1">
				<div className="db-sort-panel-content">
					{sorts.length === 0 && <div className="db-panel-empty">No sorts applied</div>}
					{sorts.map((sort, i) => (
						<div key={i} className="db-panel-row">
							<select
								className="db-select"
								value={sort.fieldId}
								onChange={(e) => {
									sorts[i] = { ...sort, fieldId: e.target.value };
									updateView({ sort: sorts });
								}}
							>
								{schema.map((f) => (
									<option key={f.id} value={f.id}>{f.name}</option>
								))}
							</select>
							<button
								className="db-btn"
								onClick={() => {
									sorts[i] = {
										...sort,
										direction: sort.direction === 'asc' ? 'desc' : 'asc',
									};
									updateView({ sort: sorts });
								}}
							>
								{sort.direction === 'asc' ? '\u2191 Asc' : '\u2193 Desc'}
							</button>
							<button
								className="db-icon-btn"
								onClick={() => {
									sorts.splice(i, 1);
									updateView({ sort: sorts });
								}}
								title="Remove sort"
							>
								\u2715
							</button>
						</div>
					))}
					<div className="db-panel-add">
						<button
							className="db-btn"
							onClick={() => {
								if (!schema[0]) return;
								sorts.push({ fieldId: schema[0].id, direction: 'asc' });
								updateView({ sort: sorts });
							}}
						>
							+ Add sort
						</button>
						{sorts.length > 0 && (
							<button className="db-btn" onClick={() => updateView({ sort: [] })}>
								Clear
							</button>
						)}
					</div>
				</div>
			</div>
		);
	}

	const filters = [...view.filter];
	return (
		<div ref={panelRef} className="db-dropdown-panel absolute right-0 top-full z-50 mt-1">
			<div className="db-filter-panel-content">
				{filters.length === 0 && <div className="db-panel-empty">No filters applied</div>}
				{filters.map((filter, i) => {
					const selectedField = schema.find((s) => s.id === filter.fieldId);
					const ops = getOpsForField(selectedField);
					return (
						<div key={i} className="db-panel-row">
							<select
								className="db-select"
								value={filter.fieldId}
								onChange={(e) => {
									const nextFieldId = e.target.value;
									const nextField = schema.find((s) => s.id === nextFieldId);
									filters[i] = {
										...filter,
										fieldId: nextFieldId,
										op: getDefaultOpForField(nextField),
										value: '',
									};
									updateView({ filter: filters });
								}}
							>
								{schema.map((s) => (
									<option key={s.id} value={s.id}>{s.name}</option>
								))}
							</select>
							<select
								className="db-select"
								value={filter.op}
								onChange={(e) => {
									filters[i] = { ...filter, op: e.target.value };
									updateView({ filter: filters });
								}}
							>
								{ops.map((op) => (
									<option key={op.value} value={op.value}>{op.label}</option>
								))}
							</select>
							{opNeedsValue(filter.op) && (
								<input
									className="db-input"
									value={filter.value}
									onChange={(e) => {
										filters[i] = { ...filter, value: e.target.value };
										updateView({ filter: filters });
									}}
								/>
							)}
							<button
								className="db-icon-btn"
								onClick={() => {
									filters.splice(i, 1);
									updateView({ filter: filters });
								}}
								title="Remove filter"
							>
								\u2715
							</button>
						</div>
					);
				})}
				<div className="db-panel-add">
					<button
						className="db-btn"
						onClick={() => {
							if (!schema[0]) return;
							filters.push({
								fieldId: schema[0].id,
								op: getDefaultOpForField(schema[0]),
								value: '',
							});
							updateView({ filter: filters });
						}}
					>
						+ Add filter
					</button>
					{filters.length > 0 && (
						<button className="db-btn" onClick={() => updateView({ filter: [] })}>
							Clear
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
