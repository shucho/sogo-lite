/**
 * ---
 * @anchor: .patterns/core-module
 * @spec: specs/vscode-extension.md#inline-editing
 * @task: TASK-025
 * @validated: null
 * ---
 */

import { useState, useRef, useEffect } from 'react';
import type { Database, DBRecord, Field } from 'sogo-db-core';
import { STATUS_OPTIONS, resolveStatusColor, resolveFieldOptionColor } from 'sogo-db-core';
import { Badge } from '../shared/Badge.js';
import { PickerDropdown } from '../shared/PickerDropdown.js';
import { useThemeKind } from '../../hooks/useThemeColors.js';

interface InlineEditorProps {
	record: DBRecord;
	field: Field;
	database: Database;
	onSave: (value: string | number | boolean | string[] | null) => void;
	onCancel: () => void;
}

export function InlineEditor({ record, field, onSave, onCancel }: InlineEditorProps) {
	const theme = useThemeKind();
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
					getColor={(opt) => resolveStatusColor(opt, theme)}
					onSave={onSave}
					onCancel={onCancel}
				/>
			);

		case 'select':
			return (
				<InlinePillPicker
					options={field.options ?? []}
					value={(currentValue as string) ?? null}
					getColor={(opt) => resolveFieldOptionColor(field, opt, theme)}
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
					getColor={(opt) => resolveFieldOptionColor(field, opt, theme)}
					onSave={onSave}
					onCancel={onCancel}
				/>
			);
		}

		case 'relation':
			// Relations are not editable inline — use record editor
			onCancel();
			return null;

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

/* ─── Inline pill picker for status/select ──────────── */

function InlinePillPicker({
	options,
	value,
	getColor,
	onSave,
	onCancel,
}: {
	options: string[];
	value: string | null;
	getColor: (opt: string) => string;
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
					getColor={getColor}
					onToggle={(opt) => onSave(opt === value ? null : opt)}
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
	options: string[];
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
					onClose={() => onSave(currentRef.current)}
				/>
			)}
		</>
	);
}
