/**
 * ---
 * @anchor: .patterns/core-module
 * @spec: specs/vscode-extension.md#peek-panel
 * @task: TASK-039
 * @validated: null
 * ---
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { marked } from 'marked';
import type { Database, DBRecord, Field } from 'sogo-db-core';
import { STATUS_OPTIONS, getStatusColor, getFieldOptionColor, getRecordTitle, resolveRelationColor, resolveStatusColor, resolveFieldOptionColor } from 'sogo-db-core';
import type { DatabaseCatalogEntry } from '../../hooks/useDatabase.js';
import { postCommand } from '../../hooks/useVSCodeApi.js';
import { useThemeKind } from '../../hooks/useThemeColors.js';
import { ConfirmDialog } from '../shared/ConfirmDialog.js';
import { Badge } from '../shared/Badge.js';
import { PickerDropdown } from '../shared/PickerDropdown.js';

marked.setOptions({ breaks: true, gfm: true });

let lastPanelWidth = 560;

interface PeekPanelProps {
	record: DBRecord;
	database: Database;
	databaseCatalog: DatabaseCatalogEntry[];
	relationTitles?: Record<string, string>;
	onClose: () => void;
}

type CatalogDatabase = Pick<Database, 'id' | 'name' | 'schema' | 'records'>;

function resolveRelationTarget(
	database: CatalogDatabase,
	field: Field,
	catalogById: Map<string, DatabaseCatalogEntry>,
): CatalogDatabase {
	const targetDatabaseId = field.relation?.targetDatabaseId;
	if (targetDatabaseId) {
		const resolved = catalogById.get(targetDatabaseId);
		if (resolved) return resolved;
	}
	return {
		id: database.id,
		name: database.name,
		schema: database.schema,
		records: database.records,
	};
}

function isTaskRelationField(
	field: Field,
	database: Database,
	catalogById: Map<string, DatabaseCatalogEntry>,
): boolean {
	if (field.type !== 'relation') return false;
	const targetDb = resolveRelationTarget(database, field, catalogById);
	return /task/i.test(field.name) || /task/i.test(targetDb.name);
}

function getSuggestedHeaderFields(
	fields: Field[],
	database: Database,
	catalogById: Map<string, DatabaseCatalogEntry>,
): Field[] {
	return [...fields]
		.sort((a, b) => scoreHeaderField(b, database, catalogById) - scoreHeaderField(a, database, catalogById))
		.slice(0, 5);
}

function scoreHeaderField(
	field: Field,
	database: Database,
	catalogById: Map<string, DatabaseCatalogEntry>,
): number {
	let score = 0;
	if (field.type === 'status') score += 36;
	if (field.type === 'select' || field.type === 'multiselect') score += 30;
	if (field.type === 'relation') score += 24;
	if (field.type === 'date') score += 20;
	if (field.type === 'checkbox') score += 12;
	if (/status|stage|priority|bucket|owner|domain|due|start|client|project|task/i.test(field.name)) score += 14;
	if (isTaskRelationField(field, database, catalogById)) score -= 30;
	return score;
}

function formatDate(value: string | number | boolean | string[] | null | undefined): string {
	if (!value || Array.isArray(value) || typeof value === 'boolean') {
		return '—';
	}
	try {
		return new Date(String(value)).toLocaleString();
	} catch {
		return String(value);
	}
}

export function PeekPanel({ record, database, databaseCatalog, relationTitles, onClose }: PeekPanelProps) {
	const [visible, setVisible] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [titleDraft, setTitleDraft] = useState('');
	const [panelWidth, setPanelWidth] = useState(lastPanelWidth);
	const [fullPage, setFullPage] = useState(false);
	const [notesDraft, setNotesDraft] = useState(String(record._body ?? ''));
	const [showHeaderPicker, setShowHeaderPicker] = useState(false);
	const [headerDragId, setHeaderDragId] = useState<string | null>(null);
	const [headerFieldIds, setHeaderFieldIds] = useState<string[]>([]);
	const [headerFieldOrder, setHeaderFieldOrder] = useState<string[]>([]);
	const notesRef = useRef<HTMLTextAreaElement>(null);
	const headerPickerRef = useRef<HTMLDivElement | null>(null);
	const propertyRowRefs = useRef(new Map<string, HTMLDivElement>());

	useEffect(() => {
		requestAnimationFrame(() => setVisible(true));
	}, []);

	useEffect(() => {
		setNotesDraft(String(record._body ?? ''));
	}, [record._body, record.id]);

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

	useEffect(() => {
		if (!showHeaderPicker) return;
		const onMouseDown = (e: MouseEvent) => {
			const target = e.target as Node;
			if (headerPickerRef.current && !headerPickerRef.current.contains(target)) {
				setShowHeaderPicker(false);
			}
		};
		document.addEventListener('mousedown', onMouseDown);
		return () => document.removeEventListener('mousedown', onMouseDown);
	}, [showHeaderPicker]);

	function handleChange(fieldId: string, value: string | number | boolean | string[] | null) {
		postCommand({ type: 'update-record', recordId: record.id, fieldId, value });
	}

	function handleDelete() {
		postCommand({ type: 'delete-record', recordId: record.id });
		animateClose();
	}

	const titleField = database.schema.find((field) => field.type === 'text');
	const titleValue = titleField ? String(record[titleField.id] ?? '') : 'Untitled';
	useEffect(() => {
		setTitleDraft(titleValue);
	}, [record.id, titleValue]);
	const catalogById = useMemo(
		() => new Map(databaseCatalog.map((entry) => [entry.id, entry])),
		[databaseCatalog],
	);
	const taskRelationFieldIds = useMemo(
		() =>
			new Set(
				database.schema
					.filter((field) => isTaskRelationField(field, database, catalogById))
					.map((field) => field.id),
			),
		[database, catalogById],
	);
	const bodyFields = useMemo(
		() => database.schema.filter((field) => field !== titleField && !taskRelationFieldIds.has(field.id)),
		[database.schema, titleField, taskRelationFieldIds],
	);
	const suggestedHeaderFields = useMemo(
		() => getSuggestedHeaderFields(bodyFields, database, catalogById),
		[bodyFields, database, catalogById],
	);
	const displayedHeaderFields = useMemo(() => {
		const selected = headerFieldIds
			.map((fieldId) => bodyFields.find((field) => field.id === fieldId))
			.filter((field): field is Field => Boolean(field));
		if (selected.length) return selected.slice(0, 5);
		return suggestedHeaderFields;
	}, [bodyFields, headerFieldIds, suggestedHeaderFields]);
	const createdAtField = database.schema.find((field) => field.type === 'createdAt');
	const editedAtField = database.schema.find((field) => field.type === 'lastEditedAt');

	useEffect(() => {
		const allowed = new Set(bodyFields.map((field) => field.id));
		const configured = (database.headerFieldIds ?? []).filter((fieldId) => allowed.has(fieldId)).slice(0, 5);
		setHeaderFieldIds(configured);
		setHeaderFieldOrder([
			...configured,
			...bodyFields.map((field) => field.id).filter((fieldId) => !configured.includes(fieldId)),
		]);
	}, [database.headerFieldIds, bodyFields]);

	function handlePanelResizeStart(event: React.MouseEvent<HTMLDivElement>) {
		if (fullPage) return;
		event.preventDefault();
		const startX = event.clientX;
		const startWidth = panelWidth;
		const min = 380;
		const max = Math.max(min, Math.floor(window.innerWidth * 0.92));
		const onMove = (moveEvent: MouseEvent) => {
			const next = Math.max(min, Math.min(max, startWidth + (startX - moveEvent.clientX)));
			lastPanelWidth = next;
			setPanelWidth(next);
		};
		const onUp = () => {
			document.removeEventListener('mousemove', onMove);
			document.removeEventListener('mouseup', onUp);
		};
		document.addEventListener('mousemove', onMove);
		document.addEventListener('mouseup', onUp);
	}

	function togglePanelWidth() {
		if (fullPage) return;
		const compactWidth = 440;
		const expandedWidth = Math.min(Math.floor(window.innerWidth * 0.72), 1040);
		const nextWidth = panelWidth < ((compactWidth + expandedWidth) / 2) ? expandedWidth : compactWidth;
		lastPanelWidth = nextWidth;
		setPanelWidth(nextWidth);
	}

	function updateRelationLinks(relationFieldId: string, recordIds: string[]) {
		postCommand({
			type: 'update-relation-links',
			databaseId: database.id,
			recordId: record.id,
			relationFieldId,
			recordIds,
		});
	}

	function createRelated(relationField: Field, targetDatabaseId: string, title: string) {
		postCommand({
			type: 'create-related-record',
			sourceDatabaseId: database.id,
			sourceRecordId: record.id,
			relationFieldId: relationField.id,
			targetDatabaseId,
			title,
		});
	}

	function updateNotes(nextNotes: string) {
		setNotesDraft(nextNotes);
		handleChange('_body', nextNotes || null);
	}

	function persistHeaderFields(nextFieldIds: string[]) {
		postCommand({ type: 'update-header-fields', databaseId: database.id, fieldIds: nextFieldIds });
	}

	return (
		<>
			<div
				className="fixed inset-0 z-40"
				style={{
					backgroundColor: visible ? 'rgba(0,0,0,0.08)' : 'rgba(0,0,0,0)',
					transition: 'background-color 200ms ease-out',
				}}
				onClick={animateClose}
			/>

				<div
					className={`db-record-panel fixed top-0 right-0 z-50 h-full flex flex-col transition-transform duration-200 ease-out ${fullPage ? 'db-record-panel--fullpage' : ''}`}
				style={{
					width: fullPage ? '100vw' : `${panelWidth}px`,
					minWidth: fullPage ? undefined : '360px',
					transform: visible ? 'translateX(0)' : 'translateX(100%)',
					boxShadow: visible ? undefined : 'none',
				}}
			>
				{!fullPage && (
					<div
						className="db-record-resize-handle"
						onMouseDown={handlePanelResizeStart}
						title="Resize panel"
					/>
				)}

					<div className="db-record-header flex-shrink-0">
						<div className="db-record-title-wrap">
							<button className="db-record-icon-btn" title="Record icon">
								◻
							</button>
							<input
								className="db-record-title-input"
								value={titleDraft}
								placeholder="Untitled"
								onChange={(e) => setTitleDraft(e.target.value)}
								onBlur={() => {
									if (titleField && titleDraft !== titleValue) {
										handleChange(titleField.id, titleDraft || null);
									}
								}}
								onKeyDown={(e) => {
									if (e.key === 'Enter') {
										e.preventDefault();
										(e.currentTarget as HTMLInputElement).blur();
									}
									if (e.key === 'Escape') {
										e.preventDefault();
										setTitleDraft(titleValue);
									}
								}}
							/>
						</div>
						<div className="db-record-header-actions">
							<button
								className="db-icon-btn"
								onClick={togglePanelWidth}
								title="Resize panel"
							>
								↔
							</button>
							<button
								className="db-icon-btn"
								onClick={() => setFullPage((v) => !v)}
								title={fullPage ? 'Exit full page' : 'Open as page'}
							>
								⛶
							</button>
							<button
								className="db-icon-btn"
								onClick={() => postCommand({ type: 'duplicate-record', recordId: record.id })}
								title="Duplicate record"
							>
								⧉
							</button>
							<button className="db-icon-btn" onClick={animateClose} title="Close (Esc)">
								✕
							</button>
						</div>
					</div>
					{(createdAtField || editedAtField) && (
						<div className="db-record-meta px-6 py-2">
							{createdAtField && <span className="db-record-meta-item">Created {formatDate(record[createdAtField.id])}</span>}
							{editedAtField && <span className="db-record-meta-item">Edited {formatDate(record[editedAtField.id])}</span>}
						</div>
					)}

					<div className="db-record-body flex-1 overflow-y-auto">
						<div className="mx-6" style={{ borderTop: '1px solid var(--vscode-panel-border)' }} />

						{displayedHeaderFields.length > 0 && (
							<div className="db-record-section db-record-key-section px-6 pt-4 pb-1 relative">
								<div className="db-record-key-head flex items-center justify-between mb-2">
									<div className="db-record-section-title text-xs font-medium opacity-75">Summary</div>
									<button
										className="db-btn db-record-editor-btn db-record-key-config-btn text-[11px] opacity-65 hover:opacity-100"
										onClick={() => setShowHeaderPicker((v) => !v)}
									>
										Customize view
									</button>
								</div>
									<div className="db-record-key-props grid grid-cols-1 gap-1.5">
										{displayedHeaderFields.map((field) => (
											<button
												key={field.id}
												type="button"
												className="db-record-key-prop flex items-start gap-2 text-xs"
												onClick={() => propertyRowRefs.current.get(field.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
											>
												<span className="db-record-key-label opacity-55 min-w-[86px]">{field.name}</span>
												<div className="db-record-key-value flex-1">
													<SummaryFieldValue
														field={field}
														record={record}
														database={database}
														catalogById={catalogById}
													/>
												</div>
											</button>
									))}
								</div>

								{showHeaderPicker && (
									<div
										ref={headerPickerRef}
										className="db-dropdown-panel db-record-header-fields-panel absolute right-6 top-9 z-20 p-2 min-w-[240px]"
									>
										<div className="db-record-header-fields-title text-xs font-medium mb-1">Pin properties to header</div>
										<div className="db-record-header-fields-hint text-[11px] opacity-55 mb-2">Choose up to 5 and drag to reorder.</div>
										<div className="db-record-header-fields-list max-h-[220px] overflow-y-auto space-y-0.5">
										{headerFieldOrder.map((fieldId) => {
											const field = bodyFields.find((candidate) => candidate.id === fieldId);
											if (!field) return null;
											const selected = headerFieldIds.includes(field.id);
											return (
													<label
														key={field.id}
														className="db-record-header-field-row flex items-center gap-1.5 text-xs rounded px-1.5 py-1 cursor-pointer"
													draggable
													onDragStart={() => setHeaderDragId(field.id)}
													onDragEnd={() => setHeaderDragId(null)}
													onDragOver={(e) => e.preventDefault()}
													onDrop={(e) => {
														e.preventDefault();
														if (!headerDragId || headerDragId === field.id) return;
														setHeaderFieldOrder((prev) => {
															const next = [...prev];
															const from = next.indexOf(headerDragId);
															const to = next.indexOf(field.id);
															if (from < 0 || to < 0) return prev;
															const [moved] = next.splice(from, 1);
															next.splice(to, 0, moved);
															const reorderedSelected = next.filter((id) => headerFieldIds.includes(id)).slice(0, 5);
															setHeaderFieldIds(reorderedSelected);
															persistHeaderFields(reorderedSelected);
															return next;
														});
													}}
												>
														<span className="db-record-header-field-handle opacity-40">⋮⋮</span>
													<input
														type="checkbox"
														checked={selected}
														disabled={!selected && headerFieldIds.length >= 5}
														onChange={(e) => {
															const nextSelected = e.target.checked
																? headerFieldOrder.filter((id) => id === field.id || headerFieldIds.includes(id)).slice(0, 5)
																: headerFieldIds.filter((id) => id !== field.id);
															setHeaderFieldIds(nextSelected);
															persistHeaderFields(nextSelected);
														}}
													/>
														<span className="db-record-header-field-name">{field.name}</span>
													</label>
											);
										})}
									</div>
										<div className="db-panel-add flex items-center justify-between mt-2">
											<button
												className="db-btn"
											onClick={() => {
												setHeaderFieldIds([]);
												setHeaderFieldOrder(bodyFields.map((field) => field.id));
												persistHeaderFields([]);
											}}
											>
												Reset suggested
											</button>
											<button className="db-btn" onClick={() => setShowHeaderPicker(false)}>
												Close
											</button>
										</div>
								</div>
							)}
						</div>
					)}

						<div className="db-record-section px-6 py-3">
							<details className="db-record-properties-details rounded border">
								<summary className="db-record-properties-summary px-3 py-2 cursor-pointer text-xs font-medium opacity-75">
									Properties ({bodyFields.length})
								</summary>
								<div className="db-record-prop-list px-3 pb-3 space-y-3">
										{bodyFields.map((field) => (
											<div
												key={field.id}
												ref={(node) => {
													if (node) propertyRowRefs.current.set(field.id, node);
													else propertyRowRefs.current.delete(field.id);
												}}
												className="db-record-prop-row grid grid-cols-[110px_1fr] gap-2 items-start"
											>
											<div className="db-record-prop-label text-[11px] opacity-55 pt-1">{field.name}</div>
											<div className="db-record-prop-value">
												<PeekField
													field={field}
													value={record[field.id]}
													record={record}
													database={database}
													catalogById={catalogById}
													relationTitles={relationTitles}
													onChange={(value) => handleChange(field.id, value)}
													onUpdateRelationLinks={updateRelationLinks}
													onCreateRelated={createRelated}
													showLabel={false}
												/>
											</div>
										</div>
									))}
								</div>
							</details>
						</div>

					<TaskRelationsSection
						record={record}
						database={database}
						catalogById={catalogById}
						onCreateRelated={createRelated}
					/>

						<div className="db-record-section px-6 pb-6">
						<div className="db-record-section-title text-xs opacity-60 mb-2">Content</div>
						<div className="db-record-editor">
							<div className="db-record-editor-toolbar flex items-center gap-1 mb-0">
								<button className="db-btn db-record-editor-btn text-xs px-1.5 py-0.5 rounded" onClick={() => wrapSelection(notesRef.current, '**', '**')}>B</button>
								<button className="db-btn db-record-editor-btn text-xs px-1.5 py-0.5 rounded" onClick={() => wrapSelection(notesRef.current, '*', '*')}>I</button>
								<button className="db-btn db-record-editor-btn text-xs px-1.5 py-0.5 rounded" onClick={() => prefixLines(notesRef.current, '- ')}>• List</button>
								<button className="db-btn db-record-editor-btn text-xs px-1.5 py-0.5 rounded" onClick={() => prefixLines(notesRef.current, '- [ ] ')}>☐ Todo</button>
							</div>
							<div className="db-record-editor-meta">
								<span className="db-record-editor-count ml-auto text-[11px] opacity-50">{wordCount(notesDraft)} words</span>
							</div>
							<textarea
								ref={notesRef}
								className="db-record-notes w-full min-h-[120px] rounded px-2 py-1.5 text-xs"
								style={{
									backgroundColor: 'var(--vscode-input-background)',
									color: 'var(--vscode-input-foreground)',
									border: '1px solid var(--vscode-input-border)',
								}}
								value={notesDraft}
								onChange={(e) => updateNotes(e.target.value)}
								placeholder="Type notes, ideas, and context..."
							/>
						</div>
					</div>
					<div className="db-record-footer">
						<button className="db-btn db-btn-danger" onClick={() => setConfirmDelete(true)}>
							Delete
						</button>
						<span className="db-toolbar-spacer" />
						<span className="db-record-footer-note">Changes save automatically</span>
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

function wordCount(value: string): number {
	const trimmed = value.trim();
	if (!trimmed) return 0;
	return trimmed.split(/\s+/).length;
}

function wrapSelection(textarea: HTMLTextAreaElement | null, prefix: string, suffix: string): void {
	if (!textarea) return;
	const start = textarea.selectionStart;
	const end = textarea.selectionEnd;
	const selected = textarea.value.slice(start, end);
	const next = `${textarea.value.slice(0, start)}${prefix}${selected}${suffix}${textarea.value.slice(end)}`;
	textarea.value = next;
	const cursor = start + prefix.length + selected.length + suffix.length;
	textarea.setSelectionRange(cursor, cursor);
	textarea.dispatchEvent(new Event('input', { bubbles: true }));
	textarea.focus();
}

function prefixLines(textarea: HTMLTextAreaElement | null, prefix: string): void {
	if (!textarea) return;
	const start = textarea.selectionStart;
	const end = textarea.selectionEnd;
	const selected = textarea.value.slice(start, end);
	const source = selected || textarea.value;
	const prefixed = source
		.split('\n')
		.map((line) => `${prefix}${line}`)
		.join('\n');
	const next = selected
		? `${textarea.value.slice(0, start)}${prefixed}${textarea.value.slice(end)}`
		: prefixed;
	textarea.value = next;
	const cursor = start + prefixed.length;
	textarea.setSelectionRange(cursor, cursor);
	textarea.dispatchEvent(new Event('input', { bubbles: true }));
	textarea.focus();
}

function TaskRelationsSection({
	record,
	database,
	catalogById,
	onCreateRelated,
}: {
	record: DBRecord;
	database: Database;
	catalogById: Map<string, DatabaseCatalogEntry>;
	onCreateRelated: (relationField: Field, targetDatabaseId: string, title: string) => void;
}) {
	const taskRelations = database.schema.filter((field) => isTaskRelationField(field, database, catalogById));

	if (!taskRelations.length) return null;

	return (
		<div className="px-6 pb-5">
			<div className="text-xs font-medium opacity-75 mb-2">Tasks</div>
			{taskRelations.map((relationField) => (
				<TaskRelationCard
					key={relationField.id}
					record={record}
					sourceDatabase={database}
					relationField={relationField}
					catalogById={catalogById}
					onCreateRelated={onCreateRelated}
				/>
			))}
		</div>
	);
}

function TaskRelationCard({
	record,
	sourceDatabase,
	relationField,
	catalogById,
	onCreateRelated,
}: {
	record: DBRecord;
	sourceDatabase: Database;
	relationField: Field;
	catalogById: Map<string, DatabaseCatalogEntry>;
	onCreateRelated: (relationField: Field, targetDatabaseId: string, title: string) => void;
}) {
	const targetDb = resolveRelationTarget(sourceDatabase, relationField, catalogById);
	const titleField = targetDb.schema.find((field) => field.type === 'text') ?? targetDb.schema[0];
	const editableFields = useMemo(
		() =>
			targetDb.schema.filter(
				(field) => field.type !== 'createdAt' && field.type !== 'lastEditedAt' && field.type !== 'formula' && field.type !== 'rollup',
			),
		[targetDb.schema],
	);
	const defaultFieldOrder = useMemo(() => {
		const preferred = [
			titleField?.id,
			targetDb.schema.find((field) => field.type === 'status')?.id,
			targetDb.schema.find((field) => field.type === 'select')?.id,
			targetDb.schema.find((field) => field.type === 'date' && /due|start/i.test(field.name))?.id,
			targetDb.schema.find((field) => field.type === 'date')?.id,
			targetDb.schema.find((field) => field.type === 'relation')?.id,
			...targetDb.schema.map((field) => field.id),
		];
		return preferred.filter((fieldId, index, all): fieldId is string => Boolean(fieldId) && all.indexOf(fieldId) === index);
	}, [targetDb.schema, titleField?.id]);
	const defaultSortFieldId = editableFields.find((field) => field.type === 'status')?.id ?? '';
	const [sortFieldId, setSortFieldId] = useState(defaultSortFieldId);
	const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
	const [filterFieldId, setFilterFieldId] = useState('');
	const [filterValue, setFilterValue] = useState('');
	const [hiddenFieldIds, setHiddenFieldIds] = useState<Set<string>>(new Set());
	const [showInlineCreate, setShowInlineCreate] = useState(false);
	const [inlineTitle, setInlineTitle] = useState('');
	const [forceRender, setForceRender] = useState(0);
	const [linkAnchor, setLinkAnchor] = useState<HTMLElement | null>(null);
	const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null);
	const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null);
	const [fieldsAnchor, setFieldsAnchor] = useState<HTMLElement | null>(null);

	const linkedIds = Array.isArray(record[relationField.id]) ? [...record[relationField.id] as string[]] : [];
	const relatedPickerOptions = targetDb.records
		.filter((candidate) => !(targetDb.id === sourceDatabase.id && candidate.id === record.id))
		.map((candidate) => ({ id: candidate.id, label: getRecordTitle(candidate, targetDb.schema) }));
	const filterableFields = editableFields.filter((field) => field.type === 'status' || field.type === 'select');

	useEffect(() => {
		const validIds = new Set(editableFields.map((field) => field.id));
		setHiddenFieldIds((prev) => {
			const next = new Set<string>();
			for (const id of prev) {
				if (validIds.has(id)) next.add(id);
			}
			return next;
		});
		if (!sortFieldId || !validIds.has(sortFieldId)) {
			setSortFieldId(defaultSortFieldId);
		}
		if (filterFieldId && !validIds.has(filterFieldId)) {
			setFilterFieldId('');
			setFilterValue('');
		}
	}, [editableFields, sortFieldId, defaultSortFieldId, filterFieldId]);

	const linkedRecords = useMemo(() => {
		const linked = new Set(linkedIds);
		const backlinkFieldId = relationField.relation?.targetRelationFieldId;
		if (backlinkFieldId) {
			for (const candidate of targetDb.records) {
				const backlink = candidate[backlinkFieldId];
				if (Array.isArray(backlink) && backlink.includes(record.id)) {
					linked.add(candidate.id);
				}
			}
		}
		return [...linked]
			.map((id) => targetDb.records.find((candidate) => candidate.id === id))
			.filter((candidate): candidate is DBRecord => Boolean(candidate));
	}, [linkedIds, relationField.relation?.targetRelationFieldId, targetDb.records, record.id, forceRender]);

	const sortedAndFiltered = useMemo(() => {
		const next = linkedRecords
			.filter((task) => {
				if (!filterFieldId || !filterValue) return true;
				const fieldValue = task[filterFieldId];
				if (Array.isArray(fieldValue)) return fieldValue.includes(filterValue);
				return fieldValue === filterValue;
			})
			.sort((left, right) => {
				if (!sortFieldId) return 0;
				const leftValue = valueAsText(left[sortFieldId]).toLowerCase();
				const rightValue = valueAsText(right[sortFieldId]).toLowerCase();
				const result = leftValue.localeCompare(rightValue, undefined, { numeric: true, sensitivity: 'base' });
				return sortDirection === 'asc' ? result : -result;
			});
		return next;
	}, [linkedRecords, filterFieldId, filterValue, sortFieldId, sortDirection, forceRender]);

	const columnFields = defaultFieldOrder
		.map((id) => targetDb.schema.find((field) => field.id === id))
		.filter((field): field is Field => Boolean(field))
		.filter((field) => !hiddenFieldIds.has(field.id))
		.filter((field) => field.type !== 'createdAt' && field.type !== 'lastEditedAt' && field.type !== 'formula' && field.type !== 'rollup');

	function closePanels() {
		setLinkAnchor(null);
		setFilterAnchor(null);
		setSortAnchor(null);
		setFieldsAnchor(null);
	}

	function updateRelatedLinks(nextIds: string[]) {
		record[relationField.id] = nextIds;
		setForceRender((value) => value + 1);
		postCommand({
			type: 'update-relation-links',
			databaseId: sourceDatabase.id,
			recordId: record.id,
			relationFieldId: relationField.id,
			recordIds: nextIds,
		});
	}

	function updateRelatedTaskValue(task: DBRecord, fieldId: string, nextValue: string | number | boolean | string[] | null) {
		task[fieldId] = nextValue;
		setForceRender((value) => value + 1);
		postCommand({
			type: 'update-record-in-database',
			databaseId: targetDb.id,
			recordId: task.id,
			fieldId,
			value: nextValue,
		});
	}

	function submitInlineCreate() {
		const title = inlineTitle.trim();
		if (!title) return;
		onCreateRelated(relationField, targetDb.id, title);
		setInlineTitle('');
		setShowInlineCreate(false);
	}

	return (
		<div className="db-related-tasks">
			<div className="db-related-tasks-head">
				<span className="db-related-tasks-title">{relationField.name}</span>
				<div className="db-related-tasks-actions">
					<button
						className="db-btn db-record-editor-btn"
						type="button"
						onClick={() => {
							closePanels();
							setShowInlineCreate((value) => !value);
						}}
					>
						+ Task
					</button>
					<button
						className="db-btn db-record-editor-btn"
						type="button"
						onClick={(e) => {
							const nextOpen = !linkAnchor;
							closePanels();
							setLinkAnchor(nextOpen ? e.currentTarget : null);
						}}
					>
						Link existing
					</button>
					<button
						className={`db-btn db-record-editor-btn ${filterFieldId && filterValue ? 'db-btn-active' : ''}`}
						type="button"
						onClick={(e) => {
							const nextOpen = !filterAnchor;
							closePanels();
							setFilterAnchor(nextOpen ? e.currentTarget : null);
						}}
					>
						Filter
					</button>
					<button
						className={`db-btn db-record-editor-btn ${sortFieldId ? 'db-btn-active' : ''}`}
						type="button"
						onClick={(e) => {
							const nextOpen = !sortAnchor;
							closePanels();
							setSortAnchor(nextOpen ? e.currentTarget : null);
						}}
					>
						Sort
					</button>
					<button
						className={`db-btn db-record-editor-btn ${hiddenFieldIds.size > 0 ? 'db-btn-active' : ''}`}
						type="button"
						onClick={(e) => {
							const nextOpen = !fieldsAnchor;
							closePanels();
							setFieldsAnchor(nextOpen ? e.currentTarget : null);
						}}
					>
						Fields
					</button>
				</div>
			</div>

			{showInlineCreate && (
				<div className="db-related-task-inline-create">
					<input
						className="db-input"
						placeholder="Task title"
						value={inlineTitle}
						onChange={(e) => setInlineTitle(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === 'Enter') {
								e.preventDefault();
								submitInlineCreate();
							}
							if (e.key === 'Escape') {
								e.preventDefault();
								setInlineTitle('');
								setShowInlineCreate(false);
							}
						}}
					/>
					<div className="db-related-task-inline-actions">
						<button className="db-btn" type="button" onClick={() => setShowInlineCreate(false)}>
							Cancel
						</button>
						<button className="db-btn db-btn-primary" type="button" onClick={submitInlineCreate}>
							Create
						</button>
					</div>
				</div>
			)}

			{linkAnchor && (
				<RecordPickerDropdown
					anchor={linkAnchor}
					options={relatedPickerOptions}
					selected={linkedIds}
					multi
					showSearch
					onChange={(next) => updateRelatedLinks(next)}
					onClose={() => setLinkAnchor(null)}
				/>
			)}

			{filterAnchor && (
				<InlineDropdownPanel
					anchor={filterAnchor}
					className="db-related-tasks-filter-panel"
					minWidth={220}
					onClose={() => setFilterAnchor(null)}
				>
					<select
						className="db-select"
						value={filterFieldId}
						onChange={(e) => {
							setFilterFieldId(e.target.value);
							setFilterValue('');
						}}
					>
						<option value="">No filter</option>
						{filterableFields.map((field) => (
							<option key={field.id} value={field.id}>{field.name}</option>
						))}
					</select>
					<select
						className="db-select"
						value={filterValue}
						onChange={(e) => {
							const next = e.target.value;
							setFilterValue(next);
							if (!next) setFilterAnchor(null);
						}}
					>
						<option value="">All values</option>
						{filterableFields.find((field) => field.id === filterFieldId)?.options?.map((option) => (
							<option key={option} value={option}>{option}</option>
						))}
					</select>
				</InlineDropdownPanel>
			)}

			{sortAnchor && (
				<InlineDropdownPanel
					anchor={sortAnchor}
					className="db-related-tasks-sort-panel"
					minWidth={220}
					onClose={() => setSortAnchor(null)}
				>
					<select className="db-select" value={sortFieldId} onChange={(e) => setSortFieldId(e.target.value)}>
						<option value="">No sorting</option>
						{editableFields.map((field) => (
							<option key={field.id} value={field.id}>{field.name}</option>
						))}
					</select>
					<button
						className="db-btn"
						type="button"
						onClick={() => setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))}
					>
						{sortDirection === 'asc' ? 'Ascending' : 'Descending'}
					</button>
				</InlineDropdownPanel>
			)}

			{fieldsAnchor && (
				<InlineDropdownPanel
					anchor={fieldsAnchor}
					className="db-related-tasks-fields-panel"
					minWidth={220}
					onClose={() => setFieldsAnchor(null)}
				>
					{defaultFieldOrder.map((fieldId) => {
						const field = editableFields.find((entry) => entry.id === fieldId);
						if (!field) return null;
						return (
							<label key={field.id} className="db-fields-row">
								<input
									type="checkbox"
									checked={!hiddenFieldIds.has(field.id)}
									onChange={(e) => {
										setHiddenFieldIds((prev) => {
											const next = new Set(prev);
											if (e.target.checked) next.delete(field.id);
											else next.add(field.id);
											return next;
										});
									}}
								/>
								<span className="db-fields-name">{field.name}</span>
							</label>
						);
					})}
				</InlineDropdownPanel>
			)}

			{sortedAndFiltered.length === 0 ? (
				<div className="db-record-auto-value p-2">No related tasks</div>
			) : (
				<div className="db-related-tasks-table-wrap">
					<table className="db-related-tasks-table">
						<thead>
							<tr>
								{columnFields.map((field) => (
									<th key={field.id}>{field.name}</th>
								))}
							</tr>
						</thead>
						<tbody>
							{sortedAndFiltered.map((task) => (
								<tr
									key={task.id}
									className="db-related-task-table-row"
									onClick={() =>
										postCommand({
											type: 'open-record',
											recordId: task.id,
											databaseId: targetDb.id,
										})
									}
								>
									{columnFields.map((field) => (
										<td key={field.id}>
											<TaskFieldEditor
												field={field}
												record={task}
												database={targetDb}
												catalogById={catalogById}
												onUpdate={(nextValue) => updateRelatedTaskValue(task, field.id, nextValue)}
											/>
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}

type PrimitiveFieldValue = string | number | boolean | string[] | null | undefined;

function valueAsText(value: PrimitiveFieldValue): string {
	if (Array.isArray(value)) return value.join(', ');
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	return value == null ? '' : String(value);
}

function valueAsDateInput(value: PrimitiveFieldValue): string {
	if (typeof value !== 'string') return '';
	const trimmed = value.trim();
	if (!trimmed) return '';
	const isoPrefix = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
	if (isoPrefix?.[1]) return isoPrefix[1];
	const parsed = new Date(trimmed);
	return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

function TaskFieldEditor({
	field,
	record,
	database,
	catalogById,
	onUpdate,
}: {
	field: Field;
	record: DBRecord;
	database: CatalogDatabase;
	catalogById: Map<string, DatabaseCatalogEntry>;
	onUpdate: (value: string | number | boolean | string[] | null) => void;
}) {
	const value = record[field.id];
	const original = valueAsText(value);
	const titleFieldId = database.schema.find((entry) => entry.type === 'text')?.id ?? '';

	if (field.type === 'status' || field.type === 'select') {
		const options = field.type === 'status' ? (field.options ?? STATUS_OPTIONS) : (field.options ?? []);
		return (
			<div onClick={(e) => e.stopPropagation()}>
				<OptionPicker
					options={options}
					value={typeof value === 'string' && value ? value : null}
					getColor={field.type === 'status' ? getStatusColor : (opt) => getFieldOptionColor(field, opt)}
					groupStatus={field.type === 'status'}
					emptyLabel="Set"
					triggerClassName="db-related-task-pill-btn"
					onChange={(next) => onUpdate(next)}
				/>
			</div>
		);
	}

	if (field.type === 'multiselect') {
		const values = Array.isArray(value) ? value : [];
		return (
			<div onClick={(e) => e.stopPropagation()}>
				<MultiSelectPicker
					options={field.options ?? []}
					selected={values}
					getColor={(opt) => getFieldOptionColor(field, opt)}
					emptyLabel="Set"
					triggerClassName="db-related-task-pill-btn"
					onChange={(next) => onUpdate(next)}
				/>
			</div>
		);
	}

	if (field.type === 'relation' && Array.isArray(value)) {
		return (
			<TaskRelationValueEditor
				field={field}
				record={record}
				database={database}
				catalogById={catalogById}
				value={value}
				onUpdate={onUpdate}
			/>
		);
	}

	if (field.type === 'date') {
		return (
			<input
				type="date"
				className="db-input db-related-task-date-input"
				value={valueAsDateInput(value)}
				onMouseDown={(e) => e.stopPropagation()}
				onClick={(e) => e.stopPropagation()}
				onChange={(e) => onUpdate(e.target.value || null)}
			/>
		);
	}

	if (field.type === 'checkbox') {
		return (
			<input
				type="checkbox"
				className="db-input-check"
				checked={value === true}
				onMouseDown={(e) => e.stopPropagation()}
				onClick={(e) => e.stopPropagation()}
				onChange={(e) => onUpdate(e.target.checked)}
			/>
		);
	}

	if (field.type === 'number' || field.type === 'text' || field.type === 'url' || field.type === 'email' || field.type === 'phone') {
		return (
			<input
				type={field.type === 'number' ? 'number' : 'text'}
				className="db-input db-related-task-cell-input"
				defaultValue={original}
				onMouseDown={(e) => e.stopPropagation()}
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => {
					e.stopPropagation();
					if (e.key === 'Enter') {
						e.preventDefault();
						(e.currentTarget as HTMLInputElement).blur();
					}
					if (e.key === 'Escape') {
						e.preventDefault();
						(e.currentTarget as HTMLInputElement).value = original;
						(e.currentTarget as HTMLInputElement).blur();
					}
				}}
				onBlur={(e) => {
					if (e.target.value === original) return;
					if (field.type === 'number') {
						const parsed = Number(e.target.value);
						onUpdate(e.target.value.trim() === '' || !Number.isFinite(parsed) ? null : parsed);
						return;
					}
					onUpdate(e.target.value.trim() ? e.target.value.trim() : null);
				}}
			/>
		);
	}

	if (field.id === titleFieldId) {
		return <span className="db-related-task-cell-title">{getRecordTitle(record, database.schema)}</span>;
	}

	return <span className="db-related-task-cell-text">{original || '—'}</span>;
}

function TaskRelationValueEditor({
	field,
	record,
	database,
	catalogById,
	value,
	onUpdate,
}: {
	field: Field;
	record: DBRecord;
	database: CatalogDatabase;
	catalogById: Map<string, DatabaseCatalogEntry>;
	value: string[];
	onUpdate: (value: string[]) => void;
}) {
	const [anchor, setAnchor] = useState<HTMLElement | null>(null);
	const targetDb = resolveRelationTarget(database, field, catalogById);
	const labels = value
		.map((linkedId) => targetDb.records.find((candidate) => candidate.id === linkedId))
		.filter((candidate): candidate is DBRecord => Boolean(candidate))
		.map((candidate) => getRecordTitle(candidate, targetDb.schema));
	const options = targetDb.records
		.filter((candidate) => !(targetDb.id === database.id && candidate.id === record.id))
		.map((candidate) => ({ id: candidate.id, label: getRecordTitle(candidate, targetDb.schema) }));

	return (
		<>
			<button
				ref={setAnchor}
				type="button"
				className="db-related-task-pill-btn"
				onMouseDown={(e) => e.stopPropagation()}
				onClick={(e) => {
					e.stopPropagation();
					setAnchor((current) => (current ? null : e.currentTarget));
				}}
			>
				{labels.length > 0 ? (
					<>
						{labels.slice(0, 2).map((labelValue) => (
							<span key={labelValue} className="db-select-badge">{labelValue}</span>
						))}
						{labels.length > 2 && <span className="db-select-badge">+{labels.length - 2}</span>}
					</>
				) : (
					<span className="db-select-badge db-select-badge--empty">Set</span>
				)}
			</button>
			{anchor && (
				<RecordPickerDropdown
					anchor={anchor}
					options={options}
					selected={value}
					multi
					showSearch
					onChange={(next) => onUpdate(next)}
					onClose={() => setAnchor(null)}
				/>
			)}
		</>
	);
}
function SummaryFieldValue({
	field,
	record,
	database,
	catalogById,
}: {
	field: Field;
	record: DBRecord;
	database: Database;
	catalogById: Map<string, DatabaseCatalogEntry>;
}) {
	const value = record[field.id];
	if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) {
		return <span className="opacity-40">—</span>;
	}
	if (field.type === 'status' && typeof value === 'string') {
		return <Badge label={value} color={getStatusColor(value)} />;
	}
	if (field.type === 'select' && typeof value === 'string') {
		return <Badge label={value} color={getFieldOptionColor(field, value)} />;
	}
	if (field.type === 'multiselect' && Array.isArray(value)) {
		return (
			<div className="flex flex-wrap gap-1">
				{value.map((item) => (
					<Badge key={item} label={item} color={getFieldOptionColor(field, item)} />
				))}
			</div>
		);
	}
	if (field.type === 'relation' && Array.isArray(value)) {
		const targetDb = resolveRelationTarget(database, field, catalogById);
		return (
			<div className="flex flex-wrap gap-1">
				{value.map((id) => {
					const linked = targetDb.records.find((candidate) => candidate.id === id);
					return <Badge key={id} label={linked ? getRecordTitle(linked, targetDb.schema) : id.slice(0, 8)} />;
				})}
			</div>
		);
	}
	if (typeof value === 'boolean') return <span>{value ? 'Yes' : 'No'}</span>;
	return <span className="truncate block">{String(value)}</span>;
}

function PeekField({
	field,
	value,
	record,
	database,
	catalogById,
	relationTitles,
	onChange,
	onUpdateRelationLinks,
	onCreateRelated,
	showLabel = true,
}: {
	field: Field;
	value: string | number | boolean | string[] | null | undefined;
	record: DBRecord;
	database: Database;
	catalogById: Map<string, DatabaseCatalogEntry>;
	relationTitles?: Record<string, string>;
	onChange: (value: string | number | boolean | string[] | null) => void;
	onUpdateRelationLinks: (relationFieldId: string, recordIds: string[]) => void;
	onCreateRelated: (relationField: Field, targetDatabaseId: string, title: string) => void;
	showLabel?: boolean;
}) {
	const isComputed =
		field.type === 'formula'
		|| field.type === 'rollup'
		|| field.type === 'createdAt'
		|| field.type === 'lastEditedAt';

	return (
		<div>
			{showLabel && (
				<div style={{ fontSize: '11px', opacity: 0.45, marginBottom: '4px', letterSpacing: '0.02em' }}>
					{field.name}
				</div>
			)}
			{isComputed ? (
				<div style={{ fontSize: '13px', opacity: 0.4 }}>{String(value ?? '—')}</div>
			) : (
				<PeekFieldInput
					field={field}
					value={value}
					record={record}
					database={database}
					catalogById={catalogById}
					relationTitles={relationTitles}
					onChange={onChange}
					onUpdateRelationLinks={onUpdateRelationLinks}
					onCreateRelated={onCreateRelated}
				/>
			)}
		</div>
	);
}

const INPUT_STYLE: React.CSSProperties = {
	fontSize: '13px',
	backgroundColor: 'var(--vscode-input-background)',
	color: 'var(--vscode-input-foreground)',
	border: '1px solid transparent',
};

function PeekFieldInput({
	field,
	value,
	record,
	database,
	catalogById,
	relationTitles,
	onChange,
	onUpdateRelationLinks,
	onCreateRelated,
}: {
	field: Field;
	value: string | number | boolean | string[] | null | undefined;
	record: DBRecord;
	database: Database;
	catalogById: Map<string, DatabaseCatalogEntry>;
	relationTitles?: Record<string, string>;
	onChange: (value: string | number | boolean | string[] | null) => void;
	onUpdateRelationLinks: (relationFieldId: string, recordIds: string[]) => void;
	onCreateRelated: (relationField: Field, targetDatabaseId: string, title: string) => void;
}) {
	const theme = useThemeKind();
	const textValue = typeof value === 'string' ? value : '';

	switch (field.type) {
		case 'url':
		case 'text':
			if (isImageFieldCandidate(field) || isLikelyImageSource(value)) {
				return (
					<ImageFieldInput
						field={field}
						value={textValue}
						onChange={(v) => onChange(v || null)}
					/>
				);
			}
			if (field.type === 'text') {
				return (
					<textarea
						className="db-input db-input-textarea"
						value={textValue}
						rows={2}
						onChange={(e) => onChange(e.target.value || null)}
					/>
				);
			}
			return (
				<input
					type="url"
					className="db-input w-full"
					value={textValue}
					placeholder="https://..."
					onChange={(e) => onChange(e.target.value || null)}
				/>
			);
		case 'email':
			return (
				<input
					type="email"
					className="db-input w-full"
					value={textValue}
					placeholder="email@..."
					onChange={(e) => onChange(e.target.value || null)}
				/>
			);
		case 'phone':
			return (
				<input
					type="tel"
					className="db-input w-full"
					value={textValue}
					placeholder="Phone..."
					onChange={(e) => onChange(e.target.value || null)}
				/>
			);
		case 'number':
			return (
				<input
					type="number"
					className="db-input w-full"
					value={value != null ? String(value) : ''}
					onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
				/>
			);
		case 'date':
			return (
				<input
					type="date"
					className="db-input w-full"
					value={(value as string) ?? ''}
					onChange={(e) => onChange(e.target.value || null)}
				/>
			);
		case 'checkbox':
			return (
				<label className="flex items-center gap-2 cursor-pointer py-0.5" style={{ fontSize: '13px' }}>
					<input
						type="checkbox"
						className="db-input-check"
						checked={value === true}
						onChange={(e) => onChange(e.target.checked)}
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
					groupStatus
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
		case 'multiselect':
			return (
				<MultiSelectPicker
					options={field.options ?? []}
					selected={Array.isArray(value) ? value : []}
					getColor={(opt) => resolveFieldOptionColor(field, opt, theme)}
					onChange={onChange}
				/>
			);
		case 'relation':
			return (
				<RelationEditor
					field={field}
					record={record}
					database={database}
					catalogById={catalogById}
					relationTitles={relationTitles}
					value={Array.isArray(value) ? value : []}
					onUpdateRelationLinks={onUpdateRelationLinks}
					onCreateRelated={onCreateRelated}
				/>
			);
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

function RelationEditor({
	field,
	record,
	database,
	catalogById,
	value,
	onUpdateRelationLinks,
	onCreateRelated,
}: {
	field: Field;
	record: DBRecord;
	database: Database;
	catalogById: Map<string, DatabaseCatalogEntry>;
	relationTitles?: Record<string, string>;
	value: string[];
	onUpdateRelationLinks: (relationFieldId: string, recordIds: string[]) => void;
	onCreateRelated: (relationField: Field, targetDatabaseId: string, title: string) => void;
}) {
	const targetDb = resolveRelationTarget(database, field, catalogById);
	const statusField = targetDb.schema.find((schemaField) => schemaField.type === 'status');
	const dueField = targetDb.schema.find((schemaField) => schemaField.type === 'date');
	const [linkAnchor, setLinkAnchor] = useState<HTMLElement | null>(null);
	const [createAnchor, setCreateAnchor] = useState<HTMLElement | null>(null);
	const pickerOptions = targetDb.records
		.filter((candidate) => !(targetDb.id === database.id && candidate.id === record.id))
		.map((candidate) => ({ id: candidate.id, label: getRecordTitle(candidate, targetDb.schema) }));
	const linkedRecords = value
		.map((id) => targetDb.records.find((candidate) => candidate.id === id))
		.filter((candidate): candidate is DBRecord => Boolean(candidate));

	return (
		<div className="db-relation-prop">
			<div className="db-relation-prop-list">
				{linkedRecords.length === 0 ? (
					<span className="db-record-auto-value">No related pages</span>
				) : (
					linkedRecords.map((linked) => {
						const linkedId = linked.id;
						const statusValue = statusField ? linked[statusField.id] : undefined;
						const dueValue = dueField ? linked[dueField.id] : undefined;
						return (
							<div
								key={linkedId}
								className="db-relation-prop-row"
								role="button"
								tabIndex={0}
								onClick={() =>
									postCommand({
										type: 'open-record',
										recordId: linkedId,
										databaseId: targetDb.id,
									})
								}
								onKeyDown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault();
										postCommand({
											type: 'open-record',
											recordId: linkedId,
											databaseId: targetDb.id,
										});
									}
								}}
							>
								<span className="db-relation-prop-title">{getRecordTitle(linked, targetDb.schema)}</span>
								{typeof statusValue === 'string' && statusValue && (
									<Badge label={statusValue} color={getStatusColor(statusValue)} />
								)}
								{typeof dueValue === 'string' && dueValue && <span className="db-relation-prop-meta">{dueValue}</span>}
								<button
									type="button"
									className="db-icon-btn"
									title="Remove relation"
									onClick={(e) => {
										e.stopPropagation();
										onUpdateRelationLinks(field.id, value.filter((entry) => entry !== linkedId));
									}}
								>
									✕
								</button>
							</div>
						);
					})
				)}
			</div>
			<div className="db-relation-prop-actions">
				<button
					type="button"
					className="db-btn db-record-editor-btn"
					onClick={(e) => {
						setCreateAnchor(null);
						setLinkAnchor((current) => (current ? null : e.currentTarget));
					}}
				>
					Add existing
				</button>
				<button
					type="button"
					className="db-btn db-record-editor-btn"
					onClick={(e) => {
						setLinkAnchor(null);
						setCreateAnchor((current) => (current ? null : e.currentTarget));
					}}
				>
					New related page
				</button>
			</div>
			{linkAnchor && (
				<RecordPickerDropdown
					anchor={linkAnchor}
					options={pickerOptions}
					selected={value}
					multi
					showSearch
					onChange={(next) => onUpdateRelationLinks(field.id, next)}
					onClose={() => setLinkAnchor(null)}
				/>
			)}
			{createAnchor && (
				<CreateRelatedPopover
					anchor={createAnchor}
					placeholder={`New ${targetDb.name} item`}
					onSubmit={(title) => {
						onCreateRelated(field, targetDb.id, title);
					}}
					onClose={() => setCreateAnchor(null)}
				/>
			)}
		</div>
	);
}

function OptionPicker({
	options,
	value,
	getColor,
	groupStatus,
	onChange,
	emptyLabel = 'Select option',
	triggerClassName = 'db-record-chip-list db-record-chip-list--clickable',
}: {
	options: readonly string[];
	value: string | null;
	getColor: (opt: string) => string;
	groupStatus?: boolean;
	onChange: (value: string | null) => void;
	emptyLabel?: string;
	triggerClassName?: string;
}) {
	const [anchor, setAnchor] = useState<HTMLElement | null>(null);
	const [open, setOpen] = useState(false);

	return (
		<>
			<div
				ref={setAnchor as (element: HTMLElement | null) => void}
				className={triggerClassName}
				onClick={(e) => {
					e.stopPropagation();
					setOpen((current) => !current);
				}}
			>
				{value ? (
					<Badge label={value} color={getColor(value)} />
				) : (
					<span className="db-select-badge db-select-badge--empty">{emptyLabel}</span>
				)}
			</div>
			{open && anchor && (
				<PickerDropdown
					anchor={anchor}
					options={options}
					selected={value ? [value] : []}
					groupStatus={groupStatus}
					getColor={getColor}
					onToggle={(opt) => {
						onChange(opt === value ? null : opt);
						setOpen(false);
					}}
					onClear={() => onChange(null)}
					onClose={() => setOpen(false)}
				/>
			)}
		</>
	);
}

function MultiSelectPicker({
	options,
	selected,
	getColor,
	onChange,
	emptyLabel = 'Select options',
	triggerClassName = 'db-record-chip-list db-record-chip-list--clickable',
}: {
	options: readonly string[];
	selected: string[];
	getColor: (opt: string) => string;
	onChange: (value: string[]) => void;
	emptyLabel?: string;
	triggerClassName?: string;
}) {
	const [anchor, setAnchor] = useState<HTMLElement | null>(null);
	const [open, setOpen] = useState(false);

	return (
		<>
			<div
				ref={setAnchor as (element: HTMLElement | null) => void}
				className={triggerClassName}
				onClick={(e) => {
					e.stopPropagation();
					setOpen((current) => !current);
				}}
			>
				{selected.length > 0
					? selected.map((opt) => <Badge key={opt} label={opt} color={getColor(opt)} />)
					: <span className="db-select-badge db-select-badge--empty">{emptyLabel}</span>}
			</div>
			{open && anchor && (
				<PickerDropdown
					anchor={anchor}
					options={options}
					selected={selected}
					multi
					getColor={getColor}
					onToggle={(opt) => {
						const next = selected.includes(opt) ? selected.filter((v) => v !== opt) : [...selected, opt];
						onChange(next);
					}}
					onClear={() => onChange([])}
					onClose={() => setOpen(false)}
				/>
			)}
		</>
	);
}

interface DropdownPickerOption {
	id: string;
	label: string;
}

function InlineDropdownPanel({
	anchor,
	className,
	minWidth = 180,
	onClose,
	children,
}: {
	anchor: HTMLElement;
	className?: string;
	minWidth?: number;
	onClose: () => void;
	children: React.ReactNode;
}) {
	const panelRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const onMouseDown = (event: MouseEvent) => {
			const target = event.target as Node;
			if (panelRef.current && !panelRef.current.contains(target) && !anchor.contains(target)) {
				onClose();
			}
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onClose();
		};
		document.addEventListener('mousedown', onMouseDown);
		window.addEventListener('keydown', onKeyDown);
		return () => {
			document.removeEventListener('mousedown', onMouseDown);
			window.removeEventListener('keydown', onKeyDown);
		};
	}, [anchor, onClose]);

	const rect = anchor.getBoundingClientRect();
	const estimatedWidth = Math.max(minWidth, rect.width);
	const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - estimatedWidth - 8));
	const top = Math.min(rect.bottom + 4, window.innerHeight - 8);

	return createPortal(
		<div
			ref={panelRef}
			className={`db-dropdown-panel ${className ?? ''}`.trim()}
			style={{ position: 'fixed', left, top, minWidth, zIndex: 130 }}
		>
			{children}
		</div>,
		document.body,
	);
}

function RecordPickerDropdown({
	anchor,
	options,
	selected,
	multi,
	showSearch,
	onChange,
	onClose,
}: {
	anchor: HTMLElement;
	options: DropdownPickerOption[];
	selected: string[];
	multi?: boolean;
	showSearch?: boolean;
	onChange: (next: string[]) => void;
	onClose: () => void;
}) {
	const panelRef = useRef<HTMLDivElement | null>(null);
	const [query, setQuery] = useState('');
	const selectedSet = useMemo(() => new Set(selected), [selected]);
	const filtered = options.filter((option) => option.label.toLowerCase().includes(query.trim().toLowerCase()));

	useEffect(() => {
		const onMouseDown = (event: MouseEvent) => {
			const target = event.target as Node;
			if (panelRef.current && !panelRef.current.contains(target) && !anchor.contains(target)) {
				onClose();
			}
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onClose();
		};
		document.addEventListener('mousedown', onMouseDown);
		window.addEventListener('keydown', onKeyDown);
		return () => {
			document.removeEventListener('mousedown', onMouseDown);
			window.removeEventListener('keydown', onKeyDown);
		};
	}, [anchor, onClose]);

	const rect = anchor.getBoundingClientRect();
	const width = Math.max(rect.width, 260);
	const left = Math.min(rect.left, Math.max(8, window.innerWidth - width - 8));
	const spaceBelow = window.innerHeight - rect.bottom - 8;
	const spaceAbove = rect.top - 8;
	const above = spaceBelow < 180 && spaceAbove > spaceBelow;

	const style: React.CSSProperties = {
		position: 'fixed',
		left,
		width,
		maxWidth: 360,
		maxHeight: Math.min(320, above ? spaceAbove : spaceBelow),
		overflow: 'hidden',
		zIndex: 140,
	};
	if (above) {
		style.bottom = window.innerHeight - rect.top + 4;
	} else {
		style.top = rect.bottom + 4;
	}

	return createPortal(
		<div ref={panelRef} className="db-dropdown-panel db-record-picker-panel" style={style}>
			{showSearch && (
				<input
					className="db-input w-full"
					placeholder="Search..."
					value={query}
					onChange={(e) => setQuery(e.target.value)}
				/>
			)}
			{selected.length > 0 && (
				<div className="db-record-picker-selected">
					{selected.map((id) => {
						const item = options.find((option) => option.id === id);
						if (!item) return null;
						return (
							<button
								key={item.id}
								type="button"
								className="db-record-picker-selected-chip"
								onClick={() => onChange(selected.filter((entry) => entry !== item.id))}
							>
								<span className="db-record-picker-selected-chip-label">
									{item.label}
									<span className="db-record-picker-selected-chip-remove">×</span>
								</span>
							</button>
						);
					})}
				</div>
			)}
			<div className="db-record-picker-list">
				{filtered.length === 0 ? (
					<div className="db-panel-empty">No matches</div>
				) : (
					filtered.map((option) => {
						const isSelected = selectedSet.has(option.id);
						return (
							<button
								key={option.id}
								type="button"
								className="db-record-picker-item"
								onClick={() => {
									if (!multi) {
										onChange(isSelected ? [] : [option.id]);
										onClose();
										return;
									}
									onChange(
										isSelected
											? selected.filter((entry) => entry !== option.id)
											: [...selected, option.id],
									);
								}}
							>
								<span className="db-record-picker-label">{option.label}</span>
								<span className="db-record-picker-mark">{isSelected ? '✓' : ''}</span>
							</button>
						);
					})
				)}
			</div>
			{multi && (
				<div className="db-panel-add flex items-center justify-end gap-2">
					<button type="button" className="db-btn" onClick={() => onChange([])}>
						Clear
					</button>
					<button type="button" className="db-btn db-btn-primary" onClick={onClose}>
						Done
					</button>
				</div>
			)}
		</div>,
		document.body,
	);
}

function CreateRelatedPopover({
	anchor,
	placeholder,
	onSubmit,
	onClose,
}: {
	anchor: HTMLElement;
	placeholder: string;
	onSubmit: (title: string) => void;
	onClose: () => void;
}) {
	const [title, setTitle] = useState('');
	return (
		<InlineDropdownPanel
			anchor={anchor}
			className="db-related-create-popover"
			minWidth={260}
			onClose={onClose}
		>
			<input
				className="db-input"
				placeholder={placeholder}
				value={title}
				onChange={(e) => setTitle(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						const next = title.trim();
						if (!next) return;
						onSubmit(next);
						onClose();
					}
					if (e.key === 'Escape') {
						e.preventDefault();
						onClose();
					}
				}}
			/>
			<div className="db-panel-add flex items-center justify-end gap-2">
				<button type="button" className="db-btn" onClick={onClose}>Cancel</button>
				<button
					type="button"
					className="db-btn db-btn-primary"
					onClick={() => {
						const next = title.trim();
						if (!next) return;
						onSubmit(next);
						onClose();
					}}
				>
					Create
				</button>
			</div>
		</InlineDropdownPanel>
	);
}
function isImageFieldCandidate(field: Field): boolean {
	if (field.type !== 'url' && field.type !== 'text') return false;
	return /image|cover|thumbnail|photo|picture|avatar/i.test(field.name);
}

function isLikelyImageSource(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	const trimmed = value.trim();
	if (!trimmed) return false;
	if (/^data:image\//i.test(trimmed)) return true;
	return /(?:^https?:\/\/|^\/|^\.\/|^\.\.\/).+\.(?:png|jpe?g|gif|webp|svg|avif)(?:[?#].*)?$/i.test(trimmed);
}

async function pickImageAsDataUrl(targetDocument: Document): Promise<string | undefined> {
	return new Promise((resolve) => {
		const input = targetDocument.createElement('input');
		input.type = 'file';
		input.accept = 'image/*';
		input.style.display = 'none';

		const cleanup = () => input.remove();
		input.addEventListener('change', () => {
			const file = input.files?.[0];
			if (!file) {
				cleanup();
				resolve(undefined);
				return;
			}
			const reader = new FileReader();
			reader.addEventListener('load', () => {
				cleanup();
				resolve(typeof reader.result === 'string' ? reader.result : undefined);
			});
			reader.addEventListener('error', () => {
				cleanup();
				resolve(undefined);
			});
			reader.readAsDataURL(file);
		}, { once: true });

		(targetDocument.body ?? targetDocument.documentElement).appendChild(input);
		input.click();
	});
}

function ImageFieldInput({
	field,
	value,
	onChange,
}: {
	field: Field;
	value: string;
	onChange: (value: string) => void;
}) {
	const imageSource = isLikelyImageSource(value) ? value : undefined;
	return (
		<div className="rounded p-2 space-y-2" style={{ border: '1px solid var(--vscode-panel-border)' }}>
			<div
				className="rounded overflow-hidden flex items-center justify-center min-h-[96px]"
				style={{ backgroundColor: 'var(--vscode-editorWidget-background)' }}
			>
				{imageSource ? (
					<img src={imageSource} alt="" className="w-full max-h-[180px] object-cover" />
				) : (
					<span className="text-[11px] opacity-50">
						{value ? 'Current value is not a supported image URL' : 'No image'}
					</span>
				)}
			</div>
			<div className="flex items-center gap-1.5">
				<button
					className="text-[11px] px-1.5 py-0.5 rounded"
					onClick={async (e) => {
						e.stopPropagation();
						const dataUrl = await pickImageAsDataUrl(e.currentTarget.ownerDocument);
						if (!dataUrl) return;
						onChange(dataUrl);
					}}
				>
					{imageSource ? 'Replace image' : 'Upload image'}
				</button>
				<button className="text-[11px] px-1.5 py-0.5 rounded" onClick={() => onChange('')}>
					Remove
				</button>
			</div>
			<input
				type={field.type === 'url' ? 'url' : 'text'}
				className="w-full rounded px-2 py-1 text-xs"
				style={{ backgroundColor: 'var(--vscode-input-background)', color: 'var(--vscode-input-foreground)' }}
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder="Paste image URL or upload an image"
			/>
		</div>
	);
}

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
		<div className="rounded px-2.5 py-1.5 cursor-text" style={{ fontSize: '13px', color: 'var(--vscode-foreground)' }} onClick={() => setEditing(true)}>
			{value || <span style={{ opacity: 0.3 }}>{placeholder ?? 'Empty'}</span>}
		</div>
	);
}

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
					e.target.style.height = `${e.target.scrollHeight}px`;
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
		<div className="cursor-text rounded px-2.5 py-1.5" style={{ fontSize: '13px' }} onClick={() => setEditing(true)}>
			<span style={{ opacity: 0.3 }}>Write something...</span>
		</div>
	);
}
