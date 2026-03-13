/**
 * ---
 * @anchor: .patterns/core-module
 * @spec: specs/vscode-extension.md#table-view
 * @task: TASK-024
 * @validated: null
 * ---
 */

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Database, DBRecord, DBView, Field, FieldType } from 'sogo-db-core';
import { STATUS_OPTIONS, getReadableTextColor, getStatusColor, getVisibleFields } from 'sogo-db-core';
import type { DatabaseCatalogEntry } from '../../hooks/useDatabase.js';
import { postCommand } from '../../hooks/useVSCodeApi.js';
import { TableCell } from './TableCell.js';
import { InlineEditor } from './InlineEditor.js';

interface TableViewProps {
	database: Database;
	view: DBView;
	records: DBRecord[];
	relationTitles: Record<string, string>;
	databaseCatalog: DatabaseCatalogEntry[];
	onOpenRecord: (recordId: string) => void;
}

type EditingCell = { recordId: string; fieldId: string } | null;

interface RecordGroup {
	key: string;
	label: string;
	records: DBRecord[];
}

const DEFAULT_COLUMN_WIDTH = 168;

const OPTION_COLOR_PRESETS: Array<{ label: string; value: string; swatch: string }> = [
	{ label: 'Gray', value: '#6b7280', swatch: '⚫' },
	{ label: 'Brown', value: '#8b6b4a', swatch: '🟤' },
	{ label: 'Amber', value: '#f59e0b', swatch: '🟡' },
	{ label: 'Green', value: '#10b981', swatch: '🟢' },
	{ label: 'Blue', value: '#3b82f6', swatch: '🔵' },
	{ label: 'Purple', value: '#a855f7', swatch: '🟣' },
	{ label: 'Red', value: '#ef4444', swatch: '🔴' },
];

const FIELD_TYPES: FieldType[] = [
	'text',
	'number',
	'select',
	'multiselect',
	'status',
	'date',
	'checkbox',
	'url',
	'email',
	'phone',
	'relation',
	'rollup',
	'formula',
	'createdAt',
	'lastEditedAt',
];

function supportsOptions(type: FieldType): boolean {
	return type === 'select' || type === 'multiselect' || type === 'status';
}

function toFieldForType(field: Field, nextType: FieldType): Field {
	const next: Field = { id: field.id, name: field.name, type: nextType };
	if (supportsOptions(nextType)) {
		next.options = field.options?.length
			? [...field.options]
			: (nextType === 'status' ? [...STATUS_OPTIONS] : []);
		if (field.optionColors) next.optionColors = { ...field.optionColors };
	}
	if (nextType === 'relation') {
		next.relation = field.relation ? { ...field.relation } : {};
	}
	if (nextType === 'rollup') {
		next.rollup = field.rollup ? { ...field.rollup } : { relationFieldId: '', aggregation: 'count' };
	}
	if (nextType === 'formula') {
		next.formula = field.formula ? { ...field.formula } : { expression: '' };
	}
	return next;
}

function signatureForField(field: Field): string {
	return JSON.stringify(field);
}

export function TableView({
	database,
	view,
	records,
	relationTitles,
	databaseCatalog,
	onOpenRecord,
}: TableViewProps) {
	const [editingCell, setEditingCell] = useState<EditingCell>(null);
	const [selectedRecordIds, setSelectedRecordIds] = useState<Set<string>>(new Set());
	const [columnWidths, setColumnWidths] = useState<Record<string, number>>(view.columnWidths ?? {});
	const columnWidthsRef = useRef(columnWidths);

	const [propertyFieldId, setPropertyFieldId] = useState<string | null>(null);
	const [propertyName, setPropertyName] = useState('');
	const [propertyType, setPropertyType] = useState<FieldType>('text');
	const [propertyOptionDrafts, setPropertyOptionDrafts] = useState<Array<{ name: string; color: string }>>([]);
	const [propertyMenuAnchor, setPropertyMenuAnchor] = useState<{ left: number; top: number } | null>(null);
	const propertyPanelRef = useRef<HTMLDivElement | null>(null);
	const propertySaveTimerRef = useRef<number | null>(null);
	const lastPropertySignatureRef = useRef<string>('');

	const [showAddField, setShowAddField] = useState(false);
	const [newFieldName, setNewFieldName] = useState('');
	const [newFieldType, setNewFieldType] = useState<FieldType>('text');
	const addPanelRef = useRef<HTMLDivElement | null>(null);

	const visibleFields = useMemo(
		() => getVisibleFields(database.schema, view),
		[database.schema, view],
	);

	const groupField = useMemo(
		() => (view.groupBy ? database.schema.find((f) => f.id === view.groupBy) : undefined),
		[database.schema, view.groupBy],
	);
	const titleFieldId = useMemo(
		() => database.schema.find((field) => field.type === 'text')?.id ?? visibleFields[0]?.id,
		[database.schema, visibleFields],
	);

	const propertyField = useMemo(
		() => (propertyFieldId ? database.schema.find((field) => field.id === propertyFieldId) : undefined),
		[propertyFieldId, database.schema],
	);

	useEffect(() => {
		setColumnWidths(view.columnWidths ?? {});
	}, [view.id, view.columnWidths]);

	useEffect(() => {
		columnWidthsRef.current = columnWidths;
	}, [columnWidths]);

	useEffect(() => {
		const visibleIds = new Set(records.map((r) => r.id));
		setSelectedRecordIds((prev) => {
			const next = new Set<string>();
			for (const id of prev) {
				if (visibleIds.has(id)) next.add(id);
			}
			return next;
		});
	}, [records]);

	useEffect(() => {
		function handleOutsideClick(e: MouseEvent) {
			const target = e.target as Node;
			if (propertyPanelRef.current && !propertyPanelRef.current.contains(target)) {
				if (propertySaveTimerRef.current != null) {
					window.clearTimeout(propertySaveTimerRef.current);
					propertySaveTimerRef.current = null;
					pushPropertyChanges();
				}
				setPropertyFieldId(null);
				setPropertyMenuAnchor(null);
			}
			if (addPanelRef.current && !addPanelRef.current.contains(target)) {
				setShowAddField(false);
			}
		}
		document.addEventListener('mousedown', handleOutsideClick);
		return () => document.removeEventListener('mousedown', handleOutsideClick);
	}, [pushPropertyChanges]);

	const grouped = useMemo<RecordGroup[] | null>(() => {
		if (!groupField) return null;

		const groups = new Map<string, DBRecord[]>();
		const baseOptions = groupField.options ?? (groupField.type === 'status' ? [...STATUS_OPTIONS] : []);
		for (const opt of baseOptions) groups.set(opt, []);
		groups.set('', []);

		for (const record of records) {
			const raw = record[groupField.id];
			const key = raw == null || raw === '' ? '' : String(raw);
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key)!.push(record);
		}

		return [...groups.entries()]
			.filter(([, groupRecords]) => groupRecords.length > 0)
			.map(([key, groupRecords]) => ({
				key,
				label: key || 'No value',
				records: groupRecords,
			}));
	}, [groupField, records]);

	const selectedVisibleCount = useMemo(
		() => records.filter((r) => selectedRecordIds.has(r.id)).length,
		[records, selectedRecordIds],
	);

	const allVisibleSelected = records.length > 0 && selectedVisibleCount === records.length;
	const someVisibleSelected = selectedVisibleCount > 0 && selectedVisibleCount < records.length;

	function toggleSelectAll(checked: boolean) {
		if (checked) {
			setSelectedRecordIds(new Set(records.map((r) => r.id)));
			return;
		}
		setSelectedRecordIds(new Set());
	}

	function toggleSelectRow(recordId: string, checked: boolean) {
		setSelectedRecordIds((prev) => {
			const next = new Set(prev);
			if (checked) next.add(recordId);
			else next.delete(recordId);
			return next;
		});
	}

	function runBulkDuplicate() {
		for (const record of records) {
			if (!selectedRecordIds.has(record.id)) continue;
			postCommand({ type: 'duplicate-record', recordId: record.id });
		}
		setSelectedRecordIds(new Set());
	}

	function runBulkDelete() {
		for (const record of records) {
			if (!selectedRecordIds.has(record.id)) continue;
			postCommand({ type: 'delete-record', recordId: record.id });
		}
		setSelectedRecordIds(new Set());
	}

	function openPropertyMenu(field: Field, anchorEl?: HTMLElement) {
		if (anchorEl) {
			const rect = anchorEl.getBoundingClientRect();
			const left = Math.max(8, Math.min(rect.left, window.innerWidth - 540));
			const top = Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 8));
			setPropertyMenuAnchor({ left, top });
		}
		setPropertyFieldId(field.id);
		setPropertyName(field.name);
		setPropertyType(field.type);
		setPropertyOptionDrafts(
			(field.options ?? (field.type === 'status' ? [...STATUS_OPTIONS] : []))
				.map((option, index) => ({
					name: option,
					color: field.optionColors?.[option] ?? OPTION_COLOR_PRESETS[index % OPTION_COLOR_PRESETS.length].value,
				})),
		);
		lastPropertySignatureRef.current = signatureForField(field);
		setShowAddField(false);
	}

	function buildDraftField(base: Field): Field {
		const nextField = toFieldForType(base, propertyType);
		nextField.name = propertyName.trim() || base.name;
		if (supportsOptions(propertyType)) {
			const options: string[] = [];
			const optionColors: Record<string, string> = {};
			for (const draft of propertyOptionDrafts) {
				const optionName = draft.name.trim();
				if (!optionName || options.includes(optionName)) continue;
				options.push(optionName);
				optionColors[optionName] = draft.color;
			}
			nextField.options = options.length ? options : (propertyType === 'status' ? [...STATUS_OPTIONS] : []);
			nextField.optionColors = optionColors;
		}
		return nextField;
	}

	function pushPropertyChanges() {
		if (!propertyField) return;
		const nextField = buildDraftField(propertyField);
		const signature = signatureForField(nextField);
		if (signature === lastPropertySignatureRef.current) {
			return;
		}
		lastPropertySignatureRef.current = signature;
		const nextSchema = database.schema.map((field) => (field.id === propertyField.id ? nextField : field));
		postCommand({ type: 'update-schema', schema: nextSchema });
	}

	useEffect(() => {
		if (!propertyFieldId || !propertyField) return;
		if (propertySaveTimerRef.current != null) {
			window.clearTimeout(propertySaveTimerRef.current);
		}
		propertySaveTimerRef.current = window.setTimeout(() => {
			propertySaveTimerRef.current = null;
			pushPropertyChanges();
		}, 160);
		return () => {
			if (propertySaveTimerRef.current != null) {
				window.clearTimeout(propertySaveTimerRef.current);
				propertySaveTimerRef.current = null;
			}
		};
	}, [propertyFieldId, propertyField, propertyName, propertyType, propertyOptionDrafts]); // keep property changes autosaved like GenZen

	function addField() {
		const name = newFieldName.trim();
		if (!name) return;
		const newField: Field = {
			id: crypto.randomUUID(),
			name,
			type: newFieldType,
		};
		if (supportsOptions(newFieldType)) {
			newField.options = newFieldType === 'status' ? [...STATUS_OPTIONS] : [];
		}
		if (newFieldType === 'relation') {
			newField.relation = {};
		}
		if (newFieldType === 'rollup') {
			newField.rollup = { relationFieldId: '', aggregation: 'count' };
		}
		if (newFieldType === 'formula') {
			newField.formula = { expression: '' };
		}
		postCommand({ type: 'update-schema', schema: [...database.schema, newField] });
		setNewFieldName('');
		setNewFieldType('text');
		setShowAddField(false);
	}

	function startColumnResize(e: React.PointerEvent<HTMLDivElement>, fieldId: string, currentWidth: number) {
		e.preventDefault();
		e.stopPropagation();
		const startX = e.clientX;
		const startWidth = currentWidth;
		let nextWidth = startWidth;
		const prevCursor = document.body.style.cursor;
		const prevUserSelect = document.body.style.userSelect;
		document.body.style.cursor = 'col-resize';
		document.body.style.userSelect = 'none';
		const onMove = (moveEvent: PointerEvent) => {
			nextWidth = Math.max(80, startWidth + moveEvent.clientX - startX);
			setColumnWidths((prev) => ({ ...prev, [fieldId]: nextWidth }));
		};
		const onUp = () => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			document.body.style.cursor = prevCursor;
			document.body.style.userSelect = prevUserSelect;
			postCommand({
				type: 'update-view',
				viewId: view.id,
				changes: {
					columnWidths: {
						...(view.columnWidths ?? {}),
						...columnWidthsRef.current,
						[fieldId]: nextWidth,
					},
				},
			});
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp, { once: true });
	}

	function renderRow(record: DBRecord) {
		const isEditableField = (field: Field) =>
			field.type !== 'createdAt'
			&& field.type !== 'lastEditedAt'
			&& field.type !== 'formula'
			&& field.type !== 'rollup';
		const firstVisibleFieldId = visibleFields[0]?.id;

		return (
			<tr key={record.id} className="db-row">
				<td
					className="db-td db-td-check"
					onClick={(e) => e.stopPropagation()}
				>
					<input
						type="checkbox"
						className="db-row-check"
						checked={selectedRecordIds.has(record.id)}
						onChange={(e) => toggleSelectRow(record.id, e.target.checked)}
						onClick={(e) => e.stopPropagation()}
					/>
				</td>
										{visibleFields.map((field) => {
											const fieldWidth = columnWidths[field.id] ?? DEFAULT_COLUMN_WIDTH;
											return (
											<td
												key={field.id}
												className={`db-td${field.id === firstVisibleFieldId ? ' db-td-primary' : ''}`}
												style={{
													width: fieldWidth,
													minWidth: fieldWidth,
													maxWidth: fieldWidth,
												}}
						onClick={(e) => {
							e.stopPropagation();
							if (field.type === 'checkbox') {
								postCommand({
									type: 'update-record',
									recordId: record.id,
									fieldId: field.id,
									value: record[field.id] !== true,
								});
								setEditingCell(null);
								return;
							}
							if (field.type === 'relation') {
								onOpenRecord(record.id);
								return;
							}
							if (!isEditableField(field)) return;
							setEditingCell({ recordId: record.id, fieldId: field.id });
						}}
					>
						{editingCell?.recordId === record.id && editingCell.fieldId === field.id ? (
							<InlineEditor
								record={record}
								field={field}
								database={database}
								databaseCatalog={databaseCatalog}
								onSave={(value) => {
									postCommand({
										type: 'update-record',
										recordId: record.id,
										fieldId: field.id,
										value,
									});
									setEditingCell(null);
								}}
								onCancel={() => setEditingCell(null)}
							/>
						) : (
							<>
								<div className="db-td-content">
									<TableCell
										record={record}
										field={field}
										database={database}
										relationTitles={relationTitles}
										onToggleCheckbox={() => {
											postCommand({
												type: 'update-record',
												recordId: record.id,
												fieldId: field.id,
												value: record[field.id] !== true,
											});
											setEditingCell(null);
										}}
									/>
								</div>
								{field.id === firstVisibleFieldId && (
									<div className="db-row-actions db-row-actions-inline">
										<button
											className="db-icon-btn"
											title="Open record"
											onClick={(e) => {
												e.stopPropagation();
												onOpenRecord(record.id);
											}}
										>
											↗
										</button>
										<button
											className="db-icon-btn"
											title="Duplicate record"
											onClick={(e) => {
												e.stopPropagation();
												postCommand({ type: 'duplicate-record', recordId: record.id });
											}}
										>
											⧉
										</button>
										<button
											className="db-icon-btn db-icon-btn-danger"
											title="Delete"
											onClick={(e) => {
												e.stopPropagation();
												postCommand({ type: 'delete-record', recordId: record.id });
											}}
										>
											🗑
										</button>
									</div>
								)}
							</>
						)}
						<div
							className="db-col-resize-handle db-col-resize-handle-cell"
							onPointerDown={(e) => startColumnResize(e, field.id, (columnWidths[field.id] ?? (e.currentTarget.parentElement?.getBoundingClientRect().width ?? DEFAULT_COLUMN_WIDTH)))}
						/>
					</td>
											);
										})}
			</tr>
		);
	}

	return (
		<div className="db-table-root">
			{selectedVisibleCount > 0 && (
				<div className="db-bulk-actions db-bulk-actions-visible">
					<span className="db-bulk-count">{selectedVisibleCount} selected</span>
					<button className="db-btn" onClick={runBulkDuplicate}>
						Duplicate selected
					</button>
					<button className="db-btn db-icon-btn-danger" onClick={runBulkDelete}>
						Delete selected
					</button>
					<span className="db-bulk-spacer" />
					<button className="db-btn" onClick={() => setSelectedRecordIds(new Set())}>
						Clear
					</button>
				</div>
			)}

			<div className="db-table-wrapper relative">
				<table className="db-table">
					<thead>
						<tr>
							<th className="db-th db-th-check">
								<input
									type="checkbox"
									className="db-row-check"
									ref={(el) => {
										if (!el) return;
										el.indeterminate = someVisibleSelected;
									}}
									checked={allVisibleSelected}
									onChange={(e) => toggleSelectAll(e.target.checked)}
								/>
							</th>
							{visibleFields.map((field) => {
								const fieldWidth = columnWidths[field.id] ?? DEFAULT_COLUMN_WIDTH;
								return (
								<th
									key={field.id}
									className="db-th"
									style={{
										width: fieldWidth,
										minWidth: fieldWidth,
										maxWidth: fieldWidth,
									}}
								>
									<div className="db-th-inner">
										<button
											className="db-th-label db-th-label-action"
											title="Edit property"
											onClick={(e) => {
												e.stopPropagation();
												openPropertyMenu(field, e.currentTarget);
											}}
										>
											{field.name}
										</button>
									</div>
									<div
										className="db-col-resize-handle"
										onPointerDown={(e) => startColumnResize(e, field.id, (columnWidths[field.id] ?? (e.currentTarget.parentElement?.getBoundingClientRect().width ?? DEFAULT_COLUMN_WIDTH)))}
									/>
								</th>
								);
							})}
							<th className="db-th db-th-add-field">
								<button
									className="db-add-field-btn"
									title="Add field"
									onClick={(e) => {
										e.stopPropagation();
										setShowAddField((v) => !v);
										setPropertyFieldId(null);
									}}
								>
									+
								</button>
							</th>
						</tr>
					</thead>
					<tbody>
							{grouped
								? grouped.map((group) => (
										<Fragment key={`fragment-${group.key || 'empty'}`}>
											<tr key={`group-${group.key}`} className="db-group-header-row">
												<td colSpan={visibleFields.length + 2} className="db-group-header-cell">
													{groupField?.type === 'status' && group.key ? (
														<span className="db-group-status-dot" style={{ backgroundColor: getStatusColor(group.key) }} />
													) : null}
													<span className="db-group-label">{group.label}</span>
													<span className="db-group-count">{group.records.length}</span>
												</td>
											</tr>
											{group.records.map((record) => renderRow(record))}
										</Fragment>
									))
								: records.map((record) => renderRow(record))}
							<tr className="db-add-row">
								<td colSpan={visibleFields.length + 2}>
									<button className="db-add-record-btn" onClick={() => postCommand({ type: 'create-record' })}>
										+ New record
									</button>
								</td>
							</tr>
						</tbody>
					</table>

				{propertyField && (
					<div
						ref={propertyPanelRef}
						className="db-dropdown-panel db-property-menu-panel fixed z-30"
						style={propertyMenuAnchor ? { left: propertyMenuAnchor.left, top: propertyMenuAnchor.top } : undefined}
					>
							<input
								className="db-input db-property-menu-name-input w-full"
								value={propertyName}
								onChange={(e) => setPropertyName(e.target.value)}
								placeholder="Property name"
								onKeyDown={(e) => {
									if (e.key === 'Escape' || e.key === 'Enter') {
										e.preventDefault();
										setPropertyFieldId(null);
										setPropertyMenuAnchor(null);
									}
								}}
							/>
							<div className="db-property-menu-type-row">
								<span className="db-property-menu-type-label">TYPE</span>
								<select
									className="db-select db-property-menu-type-select"
									value={propertyType}
									onChange={(e) => {
										const nextType = e.target.value as FieldType;
										setPropertyType(nextType);
										if (supportsOptions(nextType) && propertyOptionDrafts.length === 0) {
											const defaults = nextType === 'status' ? [...STATUS_OPTIONS] : [];
											setPropertyOptionDrafts(
												defaults.map((option, index) => ({
													name: option,
													color: OPTION_COLOR_PRESETS[index % OPTION_COLOR_PRESETS.length].value,
												})),
											);
										}
									}}
								>
									{FIELD_TYPES.map((ft) => (
										<option key={ft} value={ft}>{ft}</option>
								))}
							</select>
						</div>
						{supportsOptions(propertyType) && (
							<div className="db-property-menu-options-wrap space-y-1">
								<div className="db-panel-section-title">OPTIONS</div>
								<div className="db-property-option-list max-h-[180px] overflow-y-auto space-y-1 pr-1">
									{propertyOptionDrafts.map((draft, index) => (
										<div key={`${index}-${draft.name}`} className="db-property-option-row">
											<input
												className="db-input db-property-option-name flex-1"
												value={draft.name}
												onChange={(e) =>
													setPropertyOptionDrafts((prev) => {
														const next = [...prev];
														next[index] = { ...next[index], name: e.target.value };
														return next;
													})
												}
											/>
											<PropertyColorButton
												color={draft.color}
												onChange={(nextColor) =>
													setPropertyOptionDrafts((prev) => {
														const next = [...prev];
														next[index] = { ...next[index], color: nextColor };
														return next;
													})
												}
											/>
											<button
												className="db-property-option-remove"
												title="Remove option"
												onClick={() =>
													setPropertyOptionDrafts((prev) => prev.filter((_, rowIndex) => rowIndex !== index))
												}
											>
												✕
											</button>
										</div>
									))}
								</div>
									<button
										className="db-btn"
										onClick={() =>
											setPropertyOptionDrafts((prev) => [
												...prev,
											{
												name: '',
												color: OPTION_COLOR_PRESETS[prev.length % OPTION_COLOR_PRESETS.length].value,
											},
										])
									}
									>
										+ Add option
									</button>
								</div>
							)}
						</div>
					)}

				{showAddField && (
					<div
						ref={addPanelRef}
						className="db-dropdown-panel absolute right-2 top-9 z-30 min-w-[220px]"
					>
						<div className="db-panel-section-title">Add field</div>
						<input
							className="db-input w-full"
							value={newFieldName}
							onChange={(e) => setNewFieldName(e.target.value)}
							placeholder="Field name"
							onKeyDown={(e) => {
								if (e.key === 'Enter') addField();
							}}
						/>
						<select
							className="db-select w-full"
							value={newFieldType}
							onChange={(e) => setNewFieldType(e.target.value as FieldType)}
						>
							{FIELD_TYPES.map((ft) => (
								<option key={ft} value={ft}>{ft}</option>
							))}
						</select>
						<div className="db-panel-add flex items-center justify-end gap-2">
							<button className="db-btn" onClick={() => setShowAddField(false)}>
								Cancel
							</button>
							<button className="db-btn db-btn-primary" onClick={addField}>
								Add
							</button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

function PropertyColorButton({
	color,
	onChange,
}: {
	color: string;
	onChange: (nextColor: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const [menuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null);
	const hostRef = useRef<HTMLDivElement | null>(null);
	const menuRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!open) return;
		function handleOutsideClick(event: MouseEvent) {
			const target = event.target as Node;
			if (
				hostRef.current
				&& !hostRef.current.contains(target)
				&& (!menuRef.current || !menuRef.current.contains(target))
			) {
				setOpen(false);
			}
		}
		document.addEventListener('mousedown', handleOutsideClick);
		return () => document.removeEventListener('mousedown', handleOutsideClick);
	}, [open]);

	const activePreset = OPTION_COLOR_PRESETS.find((preset) => preset.value.toLowerCase() === color.toLowerCase())
		?? OPTION_COLOR_PRESETS[0];

	return (
		<div ref={hostRef} className="relative">
			<button
				type="button"
				className="db-btn db-property-color-btn"
				style={{
					backgroundColor: activePreset.value,
					color: getReadableTextColor(activePreset.value),
				}}
				onClick={(e) => {
					e.stopPropagation();
					if (!open) {
						const rect = hostRef.current?.getBoundingClientRect();
						if (rect) {
							const menuWidth = 120;
							const menuHeight = 8 + (OPTION_COLOR_PRESETS.length * 32) + 8;
							let left = rect.right + 8;
							if (left + menuWidth > window.innerWidth - 8) {
								left = Math.max(8, rect.left - menuWidth - 8);
							}
							let top = rect.top - 8;
							if (top + menuHeight > window.innerHeight - 8) {
								top = Math.max(8, window.innerHeight - menuHeight - 8);
							}
							setMenuPosition({ left, top });
						}
					}
					setOpen((prev) => !prev);
				}}
			>
				{activePreset.label}
			</button>
			{open && menuPosition && createPortal(
				<div
					ref={menuRef}
					className="db-context-menu db-property-color-menu"
					style={{ position: 'fixed', left: menuPosition.left, top: menuPosition.top, zIndex: 160 }}
				>
					{OPTION_COLOR_PRESETS.map((preset) => (
						<button
							key={preset.value}
							type="button"
							className={`db-context-menu-item db-property-color-item w-full text-left ${
								preset.value.toLowerCase() === color.toLowerCase() ? 'db-property-color-item--active' : ''
							}`}
							onClick={() => {
								onChange(preset.value);
								setOpen(false);
							}}
						>
							<span
								className="db-property-color-pill"
								style={{
									backgroundColor: preset.value,
									color: getReadableTextColor(preset.value),
								}}
							>
								{preset.label}
							</span>
						</button>
					))}
				</div>,
				document.body,
			)}
		</div>
	);
}
