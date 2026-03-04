/**
 * ---
 * @anchor: .patterns/core-module
 * @spec: specs/vscode-extension.md#inline-editing
 * @task: TASK-025
 * @validated: null
 * ---
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Database, DBRecord, Field } from 'sogo-db-core';
import { STATUS_OPTIONS, getFieldOptionColor, getRecordTitle, getStatusColor } from 'sogo-db-core';
import type { DatabaseCatalogEntry } from '../../hooks/useDatabase.js';
import { Badge } from '../shared/Badge.js';
import { PickerDropdown } from '../shared/PickerDropdown.js';

interface InlineEditorProps {
	record: DBRecord;
	field: Field;
	database: Database;
	databaseCatalog?: DatabaseCatalogEntry[];
	onSave: (value: string | number | boolean | string[] | null) => void;
	onCancel: () => void;
}

export function InlineEditor({ record, field, database, databaseCatalog, onSave, onCancel }: InlineEditorProps) {
	const currentValue = record[field.id];
	const inputRef = useRef<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(null);

	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	function handleKeyDown(e: React.KeyboardEvent) {
		if (e.key === 'Escape') onCancel();
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			(e.target as HTMLElement).blur();
		}
	}

	const inputStyle = {
		backgroundColor: 'var(--vscode-input-background)',
		color: 'var(--vscode-input-foreground)',
		border: '1px solid var(--vscode-focusBorder)',
	};

	switch (field.type) {
		case 'text':
		case 'email':
		case 'phone':
		case 'url':
			return (
				<input
					ref={inputRef as React.RefObject<HTMLInputElement>}
					className="w-full rounded px-1 py-0.5 text-xs"
					style={inputStyle}
					defaultValue={(currentValue as string) ?? ''}
					onBlur={(e) => onSave(e.target.value || null)}
					onKeyDown={handleKeyDown}
				/>
			);

		case 'number':
			return (
				<input
					ref={inputRef as React.RefObject<HTMLInputElement>}
					type="number"
					className="w-full rounded px-1 py-0.5 text-xs"
					style={inputStyle}
					defaultValue={currentValue != null ? String(currentValue) : ''}
					onBlur={(e) => {
						const v = e.target.value;
						onSave(v === '' ? null : Number(v));
					}}
					onKeyDown={handleKeyDown}
				/>
			);

		case 'date':
			return (
				<input
					ref={inputRef as React.RefObject<HTMLInputElement>}
					type="date"
					className="w-full rounded px-1 py-0.5 text-xs"
					style={inputStyle}
					defaultValue={(currentValue as string) ?? ''}
					onBlur={(e) => onSave(e.target.value || null)}
					onKeyDown={handleKeyDown}
				/>
			);

		case 'checkbox':
			return (
				<input
					type="checkbox"
					checked={currentValue === true}
					onChange={(e) => onSave(e.target.checked)}
				/>
			);

		case 'status':
			return (
				<InlinePillPicker
					options={[...STATUS_OPTIONS]}
					value={(currentValue as string) ?? null}
					getColor={getStatusColor}
					groupStatus
					onSave={onSave}
					onCancel={onCancel}
				/>
			);

		case 'select':
			return (
				<InlinePillPicker
					options={field.options ?? []}
					value={(currentValue as string) ?? null}
					getColor={(opt) => getFieldOptionColor(field, opt)}
					onSave={onSave}
					onCancel={onCancel}
				/>
			);

		case 'multiselect': {
			const options = field.options ?? [];
			const selected = Array.isArray(currentValue) ? currentValue : [];
			return (
				<InlineMultiPillPicker
					options={options}
					selected={selected}
					getColor={(opt) => getFieldOptionColor(field, opt)}
					onSave={onSave}
					onCancel={onCancel}
				/>
			);
		}

		case 'relation':
			return (
				<InlineRelationEditor
					record={record}
					field={field}
					database={database}
					databaseCatalog={databaseCatalog ?? []}
					onSave={onSave}
					onCancel={onCancel}
				/>
			);

		default:
			return (
				<input
					ref={inputRef as React.RefObject<HTMLInputElement>}
					className="w-full rounded px-1 py-0.5 text-xs"
					style={inputStyle}
					defaultValue={String(currentValue ?? '')}
					onBlur={(e) => onSave(e.target.value || null)}
					onKeyDown={handleKeyDown}
				/>
			);
	}
}

function InlineRelationEditor({
	record,
	field,
	database,
	databaseCatalog,
	onSave,
	onCancel,
}: {
	record: DBRecord;
	field: Field;
	database: Database;
	databaseCatalog: DatabaseCatalogEntry[];
	onSave: (value: string[]) => void;
	onCancel: () => void;
}) {
	const [query, setQuery] = useState('');
	const [selected, setSelected] = useState<string[]>(
		Array.isArray(record[field.id]) ? [...record[field.id] as string[]] : [],
	);

	const targetDb = useMemo(() => {
		const targetId = field.relation?.targetDatabaseId;
		if (!targetId || targetId === database.id) {
			return { id: database.id, schema: database.schema, records: database.records };
		}
		const found = databaseCatalog.find((entry) => entry.id === targetId);
		if (found) {
			return { id: found.id, schema: found.schema, records: found.records };
		}
		return { id: database.id, schema: database.schema, records: database.records };
	}, [field.relation?.targetDatabaseId, database.id, database.schema, database.records, databaseCatalog]);

	const candidates = useMemo(() => {
		const lowered = query.trim().toLowerCase();
		return targetDb.records
			.filter((candidate) => !(targetDb.id === database.id && candidate.id === record.id))
			.filter((candidate) => {
				if (!lowered) return true;
				return getRecordTitle(candidate, targetDb.schema).toLowerCase().includes(lowered);
			});
	}, [query, targetDb, database.id, record.id]);

	return (
		<div
			className="rounded p-1.5 space-y-1"
			style={{ border: '1px solid var(--vscode-input-border)', backgroundColor: 'var(--vscode-editor-background)' }}
		>
			<input
				className="w-full rounded px-1.5 py-0.5 text-xs"
				style={{ backgroundColor: 'var(--vscode-input-background)', color: 'var(--vscode-input-foreground)' }}
				value={query}
				onChange={(e) => setQuery(e.target.value)}
				placeholder="Search records..."
			/>
			<div className="max-h-[132px] overflow-y-auto pr-1 space-y-0.5">
				{candidates.map((candidate) => (
					<label key={candidate.id} className="flex items-center gap-1.5 text-xs cursor-pointer">
						<input
							type="checkbox"
							checked={selected.includes(candidate.id)}
							onChange={(e) => {
								setSelected((prev) =>
									e.target.checked ? [...prev, candidate.id] : prev.filter((id) => id !== candidate.id),
								);
							}}
						/>
						<span className="truncate">{getRecordTitle(candidate, targetDb.schema)}</span>
					</label>
				))}
				{candidates.length === 0 && <div className="text-[11px] opacity-45">No matches</div>}
			</div>
			<div className="flex items-center justify-end gap-1">
				<button className="text-[11px] opacity-70 hover:opacity-100" onClick={() => setSelected([])}>
					Clear
				</button>
				<button className="text-[11px] opacity-70 hover:opacity-100" onClick={onCancel}>
					Cancel
				</button>
				<button className="text-[11px] opacity-70 hover:opacity-100" onClick={() => onSave(selected)}>
					Done
				</button>
			</div>
		</div>
	);
}

/* ─── Inline pill picker for status/select ──────────── */

function InlinePillPicker({
	options,
	value,
	getColor,
	groupStatus,
	onSave,
	onCancel,
}: {
	options: readonly string[];
	value: string | null;
	getColor: (opt: string) => string;
	groupStatus?: boolean;
	onSave: (value: string | null) => void;
	onCancel: () => void;
}) {
	const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);

	return (
		<>
			<div ref={setAnchor} className="flex items-center min-h-[24px]">
				{value ? (
					<Badge label={value} color={getColor(value)} />
				) : (
					<span style={{ opacity: 0.25 }}>&mdash;</span>
				)}
			</div>
			{anchor && (
				<PickerDropdown
					anchor={anchor}
					options={options}
					selected={value ? [value] : []}
					groupStatus={groupStatus}
					getColor={getColor}
					onToggle={(opt) => onSave(opt === value ? null : opt)}
					onClear={() => onSave(null)}
					onClose={onCancel}
				/>
			)}
		</>
	);
}

/* ─── Inline multi-pill picker for multiselect ──────── */

function InlineMultiPillPicker({
	options,
	selected,
	getColor,
	onSave,
	onCancel,
}: {
	options: readonly string[];
	selected: string[];
	getColor: (opt: string) => string;
	onSave: (value: string[]) => void;
	onCancel: () => void;
}) {
	const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
	const [current, setCurrent] = useState<string[]>(selected);
	const currentRef = useRef(current);
	currentRef.current = current;

	return (
		<>
			<div ref={setAnchor} className="flex flex-wrap gap-1 items-center min-h-[24px]">
				{current.length > 0 ? (
					current.map((opt) => (
						<Badge key={opt} label={opt} color={getColor(opt)} />
					))
				) : (
					<span style={{ opacity: 0.25 }}>&mdash;</span>
				)}
			</div>
			{anchor && (
				<PickerDropdown
					anchor={anchor}
					options={options}
					selected={current}
					multi
					getColor={getColor}
					onToggle={(opt) => {
						setCurrent((prev) =>
							prev.includes(opt)
								? prev.filter((v) => v !== opt)
								: [...prev, opt],
						);
					}}
					onClear={() => setCurrent([])}
					onClose={() => onSave(currentRef.current)}
				/>
			)}
		</>
	);
}
