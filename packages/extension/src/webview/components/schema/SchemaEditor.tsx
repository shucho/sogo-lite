/**
 * ---
 * @anchor: .patterns/core-module
 * @spec: specs/vscode-extension.md#schema-editor
 * @task: TASK-032
 * @validated: null
 * ---
 */

import { useMemo, useState } from 'react';
import type { Database, DBView, Field, FieldType, RollupAggregation } from 'sogo-db-core';
import { STATUS_OPTIONS } from 'sogo-db-core';
import type { DatabaseCatalogEntry } from '../../hooks/useDatabase.js';
import { postCommand } from '../../hooks/useVSCodeApi.js';

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

const ROLLUP_AGGREGATIONS: RollupAggregation[] = [
	'count',
	'count_not_empty',
	'sum',
	'avg',
	'min',
	'max',
];

interface SchemaEditorProps {
	database: Database;
	databaseCatalog: DatabaseCatalogEntry[];
	view: DBView;
	onClose: () => void;
}

function supportsOptions(type: FieldType): boolean {
	return type === 'select' || type === 'multiselect' || type === 'status';
}

function toFieldForType(field: Field, nextType: FieldType): Field {
	const next: Field = { id: field.id, name: field.name, type: nextType };
	if (supportsOptions(nextType)) {
		next.options = field.options?.length ? [...field.options] : (nextType === 'status' ? [...STATUS_OPTIONS] : []);
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

export function SchemaEditor({ database, databaseCatalog, view, onClose }: SchemaEditorProps) {
	const [schema, setSchema] = useState<Field[]>(() => JSON.parse(JSON.stringify(database.schema)));
	const [hiddenInView, setHiddenInView] = useState<Set<string>>(
		() => new Set(view.hiddenFields.filter((id) => database.schema.some((field) => field.id === id))),
	);
	const [dragFieldId, setDragFieldId] = useState<string | null>(null);
	const [newFieldName, setNewFieldName] = useState('');
	const [newFieldType, setNewFieldType] = useState<FieldType>('text');
	const catalogById = useMemo(
		() => new Map(databaseCatalog.map((entry) => [entry.id, entry])),
		[databaseCatalog],
	);

	const inputStyle = {
		backgroundColor: 'var(--vscode-input-background)',
		color: 'var(--vscode-input-foreground)',
		border: '1px solid var(--vscode-input-border)',
	};

	function updateField(index: number, changes: Partial<Field>) {
		setSchema((prev) => {
			const next = [...prev];
			next[index] = { ...next[index], ...changes };
			return next;
		});
	}

	function updateFieldType(index: number, nextType: FieldType) {
		setSchema((prev) => {
			const next = [...prev];
			next[index] = toFieldForType(next[index], nextType);
			return next;
		});
	}

	function addField() {
		const name = newFieldName.trim();
		if (!name) return;
		setSchema((prev) => [
			...prev,
			{
				id: crypto.randomUUID(),
				name,
				type: newFieldType,
				...(newFieldType === 'relation' ? { relation: {} } : {}),
				...(newFieldType === 'rollup' ? { rollup: { relationFieldId: '', aggregation: 'count' as RollupAggregation } } : {}),
				...(newFieldType === 'formula' ? { formula: { expression: '' } } : {}),
				...(supportsOptions(newFieldType)
					? { options: newFieldType === 'status' ? [...STATUS_OPTIONS] : [] }
					: {}),
			},
		]);
		setNewFieldName('');
		setNewFieldType('text');
	}

	function removeField(index: number) {
		setSchema((prev) => {
			const removed = prev[index];
			if (removed) {
				setHiddenInView((hidden) => {
					const next = new Set(hidden);
					next.delete(removed.id);
					return next;
				});
			}
			return prev.filter((_, i) => i !== index);
		});
	}

	function moveField(fieldId: string, targetFieldId: string) {
		if (!fieldId || !targetFieldId || fieldId === targetFieldId) return;
		setSchema((prev) => {
			const next = [...prev];
			const from = next.findIndex((field) => field.id === fieldId);
			const to = next.findIndex((field) => field.id === targetFieldId);
			if (from < 0 || to < 0) return prev;
			const [moved] = next.splice(from, 1);
			next.splice(to, 0, moved);
			return next;
		});
	}

	function toggleVisibility(fieldId: string, visible: boolean) {
		setHiddenInView((prev) => {
			const next = new Set(prev);
			if (visible) next.delete(fieldId);
			else next.add(fieldId);
			return next;
		});
	}

	function showAllInView() {
		setHiddenInView(new Set());
	}

	function hideAllInView() {
		setHiddenInView(new Set(schema.map((field) => field.id)));
	}

	function handleSave() {
		const fieldOrder = schema.map((field) => field.id);
		const validFieldIds = new Set(fieldOrder);
		const nextHiddenFields = [...hiddenInView].filter((id) => validFieldIds.has(id));
		postCommand({ type: 'update-view', viewId: view.id, changes: { hiddenFields: nextHiddenFields, fieldOrder } });
		postCommand({ type: 'update-schema', schema });
		onClose();
	}

	return (
		<div
			className="db-schema-overlay"
			onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
		>
			<div className="db-schema-panel">
				<div className="db-schema-header">
					<h3 className="db-schema-title">Manage Fields</h3>
					<button className="db-icon-btn" onClick={onClose} title="Close">
						✕
					</button>
				</div>

				<div className="db-schema-list">
					{schema.map((field, index) => {
						const relationFields = schema.filter((candidate) => candidate.type === 'relation');
						const rollupRelation = field.type === 'rollup'
							? relationFields.find((candidate) => candidate.id === field.rollup?.relationFieldId)
							: undefined;
						const relationTargetDbId = rollupRelation?.relation?.targetDatabaseId ?? database.id;
						const relationTargetSchema = catalogById.get(relationTargetDbId)?.schema ?? database.schema;
						const rollupNeedsNumeric =
							field.type === 'rollup'
							&& (field.rollup?.aggregation === 'sum'
								|| field.rollup?.aggregation === 'avg'
								|| field.rollup?.aggregation === 'min'
								|| field.rollup?.aggregation === 'max');

						return (
							<div
								key={field.id}
								className="db-schema-row"
								draggable
								onDragStart={(e) => {
									setDragFieldId(field.id);
									e.currentTarget.classList.add('db-fields-row--dragging');
								}}
								onDragEnd={(e) => {
									setDragFieldId(null);
									e.currentTarget.classList.remove('db-fields-row--dragging');
								}}
								onDragOver={(e) => {
									e.preventDefault();
									e.currentTarget.classList.add('db-fields-row--over');
								}}
								onDragLeave={(e) => {
									e.currentTarget.classList.remove('db-fields-row--over');
								}}
								onDrop={(e) => {
									e.preventDefault();
									e.currentTarget.classList.remove('db-fields-row--over');
									if (!dragFieldId) return;
									moveField(dragFieldId, field.id);
									setDragFieldId(null);
								}}
							>
								<span className="db-fields-handle" title="Drag to reorder">⠿</span>
								<input
									type="checkbox"
									checked={!hiddenInView.has(field.id)}
									onChange={(e) => toggleVisibility(field.id, e.target.checked)}
									title="Visible in this view"
								/>
								<input
									className="db-input db-schema-name"
									style={inputStyle}
									value={field.name}
									onChange={(e) => updateField(index, { name: e.target.value })}
								/>
								<select
									className="db-select db-schema-type"
									style={inputStyle}
									value={field.type}
									onChange={(e) => updateFieldType(index, e.target.value as FieldType)}
								>
									{FIELD_TYPES.map((type) => (
										<option key={type} value={type}>{type}</option>
									))}
								</select>

								{supportsOptions(field.type) && (
									<input
										className="db-input db-schema-options"
										style={inputStyle}
										placeholder="Options (comma-separated)"
										value={(field.options ?? []).join(', ')}
										onChange={(e) =>
											updateField(index, {
												options: e.target.value
													.split(',')
													.map((item) => item.trim())
													.filter(Boolean),
											})
										}
									/>
								)}

								{field.type === 'relation' && (
									<>
										<select
											className="db-select db-schema-type"
											style={inputStyle}
											value={field.relation?.targetDatabaseId ?? ''}
											onChange={(e) => {
												const nextTargetDatabaseId = e.target.value || undefined;
												updateField(index, {
													relation: {
														targetDatabaseId: nextTargetDatabaseId,
														targetRelationFieldId: undefined,
													},
												});
											}}
										>
											<option value="">Current database</option>
											{databaseCatalog.map((entry) => (
												<option key={entry.id} value={entry.id}>{entry.name}</option>
											))}
										</select>
										<select
											className="db-select db-schema-type"
											style={inputStyle}
											value={field.relation?.targetRelationFieldId ?? ''}
											onChange={(e) => {
												updateField(index, {
													relation: {
														...(field.relation ?? {}),
														targetRelationFieldId: e.target.value || undefined,
													},
												});
											}}
										>
											<option value="">No backlink</option>
											{(catalogById.get(field.relation?.targetDatabaseId ?? database.id)?.schema ?? database.schema)
												.filter((candidate) => candidate.type === 'relation')
												.map((candidate) => (
													<option key={candidate.id} value={candidate.id}>{candidate.name}</option>
												))}
										</select>
									</>
								)}

								{field.type === 'rollup' && (
									<>
										<select
											className="db-select db-schema-type"
											style={inputStyle}
											value={field.rollup?.relationFieldId ?? ''}
											onChange={(e) => {
												updateField(index, {
													rollup: {
														relationFieldId: e.target.value,
														aggregation: field.rollup?.aggregation ?? 'count',
													},
												});
											}}
										>
											<option value="">Relation field</option>
											{relationFields.map((candidate) => (
												<option key={candidate.id} value={candidate.id}>{candidate.name}</option>
											))}
										</select>
										<select
											className="db-select db-schema-type"
											style={inputStyle}
											value={field.rollup?.aggregation ?? 'count'}
											onChange={(e) => {
												updateField(index, {
													rollup: {
														...(field.rollup ?? { relationFieldId: '' }),
														aggregation: e.target.value as RollupAggregation,
													},
												});
											}}
										>
											{ROLLUP_AGGREGATIONS.map((aggregation) => (
												<option key={aggregation} value={aggregation}>{aggregation}</option>
											))}
										</select>
										<select
											className="db-select db-schema-type"
											style={inputStyle}
											value={field.rollup?.targetFieldId ?? ''}
											onChange={(e) => {
												updateField(index, {
													rollup: {
														...(field.rollup ?? { relationFieldId: '', aggregation: 'count' }),
														targetFieldId: e.target.value || undefined,
													},
												});
											}}
										>
											<option value="">Target field</option>
											{relationTargetSchema
												.filter((candidate) => !rollupNeedsNumeric || candidate.type === 'number')
												.map((candidate) => (
													<option key={candidate.id} value={candidate.id}>{candidate.name}</option>
												))}
										</select>
									</>
								)}

								{field.type === 'formula' && (
									<input
										className="db-input db-schema-options"
										style={inputStyle}
										placeholder="Formula expression"
										value={field.formula?.expression ?? ''}
										onChange={(e) =>
											updateField(index, {
												formula: { expression: e.target.value },
											})
										}
									/>
								)}

								<button className="db-icon-btn db-schema-delete" onClick={() => removeField(index)} title="Delete field">
									🗑
								</button>
							</div>
						);
					})}

					<div className="db-schema-add">
						<div className="db-schema-add-title">Add Field</div>
						<div className="db-schema-add-row">
							<input
								className="db-input"
								style={inputStyle}
								value={newFieldName}
								onChange={(e) => setNewFieldName(e.target.value)}
								placeholder="Field name"
								onKeyDown={(e) => {
									if (e.key === 'Enter') addField();
								}}
							/>
							<select
								className="db-select"
								style={inputStyle}
								value={newFieldType}
								onChange={(e) => setNewFieldType(e.target.value as FieldType)}
							>
								{FIELD_TYPES.map((type) => (
									<option key={type} value={type}>{type}</option>
								))}
							</select>
							<button className="db-btn" onClick={addField}>
								Add
							</button>
						</div>
					</div>
				</div>

				<div className="db-schema-footer">
					<button className="db-btn" onClick={showAllInView}>Show all in view</button>
					<button className="db-btn" onClick={hideAllInView}>Hide all in view</button>
					<button className="db-btn db-btn-primary" onClick={handleSave}>Save Changes</button>
					<button className="db-btn" onClick={onClose}>Cancel</button>
				</div>
			</div>
		</div>
	);
}
