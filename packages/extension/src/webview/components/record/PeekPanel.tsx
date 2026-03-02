/**
 * ---
 * @anchor: .patterns/core-module
 * @spec: specs/vscode-extension.md#peek-panel
 * @task: TASK-039
 * @validated: null
 * ---
 *
 * Notion-style side-peek panel for viewing/editing a record.
 * Slides in from the right, covers ~50% of the viewport.
 * Text fields render markdown in display mode, switch to textarea on edit.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { marked } from 'marked';
import type { Database, DBRecord, Field } from 'sogo-db-core';
import { STATUS_OPTIONS, resolveStatusColor, resolveFieldOptionColor, resolveRelationColor } from 'sogo-db-core';
import { postCommand } from '../../hooks/useVSCodeApi.js';
import { useThemeKind } from '../../hooks/useThemeColors.js';
import { ConfirmDialog } from '../shared/ConfirmDialog.js';
import { Badge } from '../shared/Badge.js';
import { PickerDropdown } from '../shared/PickerDropdown.js';

marked.setOptions({ breaks: true, gfm: true });

interface PeekPanelProps {
	record: DBRecord;
	database: Database;
	relationTitles?: Record<string, string>;
	onClose: () => void;
}

export function PeekPanel({ record, database, relationTitles, onClose }: PeekPanelProps) {
	const [visible, setVisible] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [editingTitle, setEditingTitle] = useState(false);
	const [titleDraft, setTitleDraft] = useState('');
	const titleInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		requestAnimationFrame(() => setVisible(true));
	}, []);

	const animateClose = useCallback(() => {
		setVisible(false);
		setTimeout(onClose, 200);
	}, [onClose]);

	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === 'Escape') animateClose();
		}
		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, [animateClose]);

	function handleChange(fieldId: string, value: string | number | boolean | string[] | null) {
		postCommand({ type: 'update-record', recordId: record.id, fieldId, value });
	}

	function handleDelete() {
		postCommand({ type: 'delete-record', recordId: record.id });
		animateClose();
	}

	// Title is the first text field — displayed as a large heading, not in the field list
	const titleField = database.schema.find((f) => f.type === 'text');
	const titleValue = titleField ? String(record[titleField.id] ?? '') : 'Untitled';
	const bodyFields = database.schema.filter((f) => f !== titleField);

	function startEditTitle() {
		setTitleDraft(titleValue);
		setEditingTitle(true);
	}

	function saveTitle() {
		setEditingTitle(false);
		if (titleField && titleDraft !== titleValue) {
			handleChange(titleField.id, titleDraft || null);
		}
	}

	useEffect(() => {
		if (editingTitle && titleInputRef.current) {
			titleInputRef.current.focus();
			titleInputRef.current.select();
		}
	}, [editingTitle]);

	return (
		<>
			{/* Backdrop — subtle darken, synced with panel slide */}
			<div
				className="fixed inset-0 z-40"
				style={{
					backgroundColor: visible ? 'rgba(0,0,0,0.08)' : 'rgba(0,0,0,0)',
					transition: 'background-color 200ms ease-out',
				}}
				onClick={animateClose}
			/>

			{/* Panel */}
			<div
				className="fixed top-0 right-0 z-50 h-full flex flex-col transition-transform duration-200 ease-out"
				style={{
					width: 'min(560px, 50vw)',
					minWidth: '360px',
					transform: visible ? 'translateX(0)' : 'translateX(100%)',
					backgroundColor: 'var(--vscode-editor-background)',
					borderLeft: '1px solid var(--vscode-panel-border)',
					boxShadow: visible ? '-4px 0 16px rgba(0,0,0,0.08)' : 'none',
				}}
			>
				{/* Compact top bar */}
				<div
					className="flex items-center px-5 py-2 flex-shrink-0"
					style={{ borderBottom: '1px solid var(--vscode-panel-border)' }}
				>
					<button
						className="p-1 rounded opacity-40 hover:opacity-100 transition-opacity"
						style={{ color: 'var(--vscode-foreground)' }}
						onClick={animateClose}
						title="Close (Esc)"
					>
						<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
							<path d="M8 8.707l3.646 3.647.708-.707L8.707 8l3.647-3.646-.707-.708L8 7.293 4.354 3.646l-.708.708L7.293 8l-3.647 3.646.708.708L8 8.707z" />
						</svg>
					</button>
					<div className="flex-1" />
					<button
						className="p-1 rounded opacity-30 hover:opacity-100 transition-opacity"
						style={{ color: 'var(--vscode-errorForeground)' }}
						onClick={() => setConfirmDelete(true)}
						title="Delete record"
					>
						<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
							<path d="M10 3h3v1h-1l-.5 9.5c0 .28-.22.5-.5.5h-6c-.28 0-.5-.22-.5-.5L4 4H3V3h3V2a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1zM7 2v1h2V2H7zM5 4l.5 9h5L11 4H5z" />
						</svg>
					</button>
				</div>

				{/* Scrollable content */}
				<div className="flex-1 overflow-y-auto">
					{/* Title */}
					<div className="px-6 pt-6 pb-4">
						{editingTitle ? (
							<input
								ref={titleInputRef}
								className="w-full bg-transparent outline-none"
								style={{
									color: 'var(--vscode-foreground)',
									fontSize: '20px',
									fontWeight: 600,
									lineHeight: '1.3',
									border: 'none',
									padding: 0,
								}}
								value={titleDraft}
								onChange={(e) => setTitleDraft(e.target.value)}
								onBlur={saveTitle}
								onKeyDown={(e) => {
									if (e.key === 'Enter') saveTitle();
									if (e.key === 'Escape') setEditingTitle(false);
								}}
							/>
						) : (
							<h1
								className="cursor-text"
								style={{
									fontSize: '20px',
									fontWeight: 600,
									lineHeight: '1.3',
									color: 'var(--vscode-foreground)',
									margin: 0,
								}}
								onClick={startEditTitle}
							>
								{titleValue || <span style={{ opacity: 0.3 }}>Untitled</span>}
							</h1>
						)}
					</div>

					<div className="mx-6" style={{ borderTop: '1px solid var(--vscode-panel-border)' }} />

					{/* Fields */}
					<div className="px-6 py-4 space-y-4">
						{bodyFields.map((field) => (
							<PeekField
								key={field.id}
								field={field}
								value={record[field.id]}
								relationTitles={relationTitles}
								onChange={(v) => handleChange(field.id, v)}
							/>
						))}
					</div>
				</div>
			</div>

			<ConfirmDialog
				open={confirmDelete}
				title="Delete record"
				message="This action cannot be undone."
				confirmLabel="Delete"
				danger
				onConfirm={handleDelete}
				onCancel={() => setConfirmDelete(false)}
			/>
		</>
	);
}

/* ─── Field row ─────────────────────────────────────── */

function PeekField({
	field,
	value,
	relationTitles,
	onChange,
}: {
	field: Field;
	value: string | number | boolean | string[] | null | undefined;
	relationTitles?: Record<string, string>;
	onChange: (value: string | number | boolean | string[] | null) => void;
}) {
	const isComputed =
		field.type === 'formula' ||
		field.type === 'rollup' ||
		field.type === 'createdAt' ||
		field.type === 'lastEditedAt';

	return (
		<div>
			<div style={{ fontSize: '11px', opacity: 0.45, marginBottom: '4px', letterSpacing: '0.02em' }}>
				{field.name}
			</div>
			{isComputed ? (
				<div style={{ fontSize: '13px', opacity: 0.4 }}>{String(value ?? '—')}</div>
			) : (
				<PeekFieldInput
					field={field}
					value={value}
					relationTitles={relationTitles}
					onChange={onChange}
				/>
			)}
		</div>
	);
}

/* ─── Field input by type ───────────────────────────── */

const INPUT_STYLE: React.CSSProperties = {
	fontSize: '13px',
	backgroundColor: 'var(--vscode-input-background)',
	color: 'var(--vscode-input-foreground)',
	border: '1px solid transparent',
};

function PeekFieldInput({
	field,
	value,
	relationTitles,
	onChange,
}: {
	field: Field;
	value: string | number | boolean | string[] | null | undefined;
	relationTitles?: Record<string, string>;
	onChange: (value: string | number | boolean | string[] | null) => void;
}) {
	const theme = useThemeKind();
	switch (field.type) {
		case 'text':
			return (
				<MarkdownTextField
					value={(value as string) ?? ''}
					onChange={(v) => onChange(v || null)}
				/>
			);
		case 'url':
		case 'email':
		case 'phone':
			return (
				<ClickToEditField
					value={(value as string) ?? ''}
					onChange={(v) => onChange(v || null)}
					placeholder={
						field.type === 'url' ? 'https://...' : field.type === 'email' ? 'email@...' : 'Phone...'
					}
				/>
			);
		case 'number':
			return (
				<input
					type="number"
					className="w-full rounded px-2.5 py-1.5 outline-none peek-input"
					style={INPUT_STYLE}
					value={value != null ? String(value) : ''}
					onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
				/>
			);
		case 'date':
			return (
				<input
					type="date"
					className="w-full rounded px-2.5 py-1.5 outline-none peek-input"
					style={INPUT_STYLE}
					value={(value as string) ?? ''}
					onChange={(e) => onChange(e.target.value || null)}
				/>
			);
		case 'checkbox':
			return (
				<label
					className="flex items-center gap-2 cursor-pointer py-0.5"
					style={{ fontSize: '13px' }}
				>
					<input
						type="checkbox"
						checked={value === true}
						onChange={(e) => onChange(e.target.checked)}
						className="w-3.5 h-3.5"
					/>
					<span style={{ opacity: 0.7 }}>{value === true ? 'Yes' : 'No'}</span>
				</label>
			);
		case 'status':
			return (
				<OptionPicker
					options={[...STATUS_OPTIONS]}
					value={(value as string) ?? null}
					getColor={(opt) => resolveStatusColor(opt, theme)}
					onChange={(v) => onChange(v)}
				/>
			);
		case 'select':
			return (
				<OptionPicker
					options={field.options ?? []}
					value={(value as string) ?? null}
					getColor={(opt) => resolveFieldOptionColor(field, opt, theme)}
					onChange={(v) => onChange(v)}
				/>
			);
		case 'multiselect': {
			const selected = Array.isArray(value) ? value : [];
			return (
				<MultiSelectPicker
					options={field.options ?? []}
					selected={selected}
					getColor={(opt) => resolveFieldOptionColor(field, opt, theme)}
					onChange={onChange}
				/>
			);
		}
		case 'relation': {
			const ids = Array.isArray(value) ? value : [];
			if (ids.length === 0) {
				return <div style={{ fontSize: '13px', opacity: 0.3 }}>No linked records</div>;
			}
			return (
				<div className="flex flex-wrap gap-1">
					{ids.map((id) => (
						<Badge key={id} label={relationTitles?.[id] ?? id.slice(0, 8)} color={resolveRelationColor(relationTitles?.[id] ?? id, theme)} />
					))}
				</div>
			);
		}
		default:
			return (
				<input
					className="w-full rounded px-2.5 py-1.5 outline-none peek-input"
					style={INPUT_STYLE}
					value={String(value ?? '')}
					onChange={(e) => onChange(e.target.value || null)}
				/>
			);
	}
}

/* ─── Option picker (status / select) ───────────────── */

function OptionPicker({
	options,
	value,
	getColor,
	onChange,
}: {
	options: string[];
	value: string | null;
	getColor: (opt: string) => string;
	onChange: (value: string | null) => void;
}) {
	const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
	const [open, setOpen] = useState(false);

	return (
		<>
			<div
				ref={setAnchor}
				className="cursor-pointer py-0.5"
				onClick={() => setOpen(!open)}
			>
				{value ? (
					<Badge label={value} color={getColor(value)} />
				) : (
					<span style={{ fontSize: '13px', opacity: 0.3 }}>None</span>
				)}
			</div>
			{open && anchor && (
				<PickerDropdown
					anchor={anchor}
					options={options}
					selected={value ? [value] : []}
					getColor={getColor}
					onToggle={(opt) => {
						onChange(opt === value ? null : opt);
						setOpen(false);
					}}
					onClose={() => setOpen(false)}
				/>
			)}
		</>
	);
}

/* ─── Multi-select picker ───────────────────────────── */

function MultiSelectPicker({
	options,
	selected,
	getColor,
	onChange,
}: {
	options: string[];
	selected: string[];
	getColor: (opt: string) => string;
	onChange: (value: string[]) => void;
}) {
	const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
	const [open, setOpen] = useState(false);

	return (
		<>
			<div
				ref={setAnchor}
				className="flex flex-wrap gap-1 items-center cursor-pointer py-0.5 min-h-[24px]"
				onClick={() => setOpen(!open)}
			>
				{selected.length > 0 ? (
					selected.map((opt) => (
						<Badge key={opt} label={opt} color={getColor(opt)} />
					))
				) : (
					<span style={{ fontSize: '13px', opacity: 0.3 }}>None</span>
				)}
			</div>
			{open && anchor && (
				<PickerDropdown
					anchor={anchor}
					options={options}
					selected={selected}
					multi
					getColor={getColor}
					onToggle={(opt) => {
						const next = selected.includes(opt)
							? selected.filter((v) => v !== opt)
							: [...selected, opt];
						onChange(next);
					}}
					onClose={() => setOpen(false)}
				/>
			)}
		</>
	);
}

/* ─── Click-to-edit single-line field ───────────────── */

function ClickToEditField({
	value,
	onChange,
	placeholder,
}: {
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
}) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(value);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!editing) setDraft(value);
	}, [value, editing]);

	useEffect(() => {
		if (editing && inputRef.current) inputRef.current.focus();
	}, [editing]);

	function handleSave() {
		setEditing(false);
		if (draft !== value) onChange(draft);
	}

	if (editing) {
		return (
			<input
				ref={inputRef}
				className="w-full rounded px-2.5 py-1.5 outline-none"
				style={{
					fontSize: '13px',
					backgroundColor: 'var(--vscode-input-background)',
					color: 'var(--vscode-input-foreground)',
					border: '1px solid var(--vscode-focusBorder)',
				}}
				value={draft}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={handleSave}
				onKeyDown={(e) => {
					if (e.key === 'Escape') {
						setDraft(value);
						setEditing(false);
					}
					if (e.key === 'Enter') handleSave();
				}}
			/>
		);
	}

	return (
		<div
			className="rounded px-2.5 py-1.5 cursor-text"
			style={{ fontSize: '13px', color: 'var(--vscode-foreground)' }}
			onClick={() => setEditing(true)}
		>
			{value || <span style={{ opacity: 0.3 }}>{placeholder ?? 'Empty'}</span>}
		</div>
	);
}

/* ─── Multiline text with markdown preview ──────────── */

function MarkdownTextField({
	value,
	onChange,
}: {
	value: string;
	onChange: (value: string) => void;
}) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(value);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		if (!editing) setDraft(value);
	}, [value, editing]);

	useEffect(() => {
		if (editing && textareaRef.current) {
			const el = textareaRef.current;
			el.focus();
			el.style.height = 'auto';
			el.style.height = el.scrollHeight + 'px';
		}
	}, [editing]);

	function handleSave() {
		setEditing(false);
		if (draft !== value) onChange(draft);
	}

	if (editing) {
		return (
			<textarea
				ref={textareaRef}
				className="w-full rounded px-2.5 py-1.5 outline-none resize-none"
				style={{
					fontSize: '13px',
					lineHeight: '1.6',
					backgroundColor: 'var(--vscode-input-background)',
					color: 'var(--vscode-input-foreground)',
					border: '1px solid var(--vscode-focusBorder)',
				}}
				value={draft}
				onChange={(e) => {
					setDraft(e.target.value);
					e.target.style.height = 'auto';
					e.target.style.height = e.target.scrollHeight + 'px';
				}}
				onBlur={handleSave}
				onKeyDown={(e) => {
					if (e.key === 'Escape') {
						setDraft(value);
						setEditing(false);
					}
				}}
			/>
		);
	}

	if (value) {
		const html = marked.parse(value);
		return (
			<div
				className="peek-markdown cursor-text rounded px-2.5 py-1.5"
				style={{ fontSize: '13px', lineHeight: '1.6', color: 'var(--vscode-foreground)' }}
				onClick={() => setEditing(true)}
				dangerouslySetInnerHTML={{ __html: html as string }}
			/>
		);
	}

	return (
		<div
			className="cursor-text rounded px-2.5 py-1.5"
			style={{ fontSize: '13px' }}
			onClick={() => setEditing(true)}
		>
			<span style={{ opacity: 0.3 }}>Write something...</span>
		</div>
	);
}
