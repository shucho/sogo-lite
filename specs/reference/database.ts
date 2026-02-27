/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type DatabaseScope = 'global' | 'workspace';

export type FieldType =
	| 'text'
	| 'number'
	| 'select'
	| 'multiselect'
	| 'relation'
	| 'rollup'
	| 'formula'
	| 'date'
	| 'checkbox'
	| 'url'
	| 'email'
	| 'phone'
	| 'status'
	| 'createdAt'
	| 'lastEditedAt';

/** Status field predefined groups */
export const STATUS_GROUPS: Record<string, { label: string; color: string }> = {
	'Not started': { label: 'Not started', color: '#5e5e5e' },
	'In progress': { label: 'In progress', color: '#2e75d0' },
	'Done': { label: 'Done', color: '#2d9e6b' },
};

export const STATUS_OPTIONS = ['Not started', 'In progress', 'Done'];

export type RollupAggregation = 'count' | 'count_not_empty' | 'sum' | 'avg' | 'min' | 'max';

export interface RelationConfig {
	targetDatabaseId?: string;
	targetRelationFieldId?: string;
}

export interface RollupConfig {
	relationFieldId: string;
	targetFieldId?: string;
	aggregation: RollupAggregation;
}

export interface FormulaConfig {
	expression: string;
}

export interface Field {
	id: string;
	name: string;
	type: FieldType;
	options?: string[];  // For select / multiselect / status
	optionColors?: Record<string, string>; // option value -> hex color
	relation?: RelationConfig;
	rollup?: RollupConfig;
	formula?: FormulaConfig;
}

export type ViewType = 'table' | 'kanban' | 'list' | 'gallery' | 'calendar';

export interface DBView {
	id: string;
	name: string;
	type: ViewType;
	// allow-any-unicode-next-line
	groupBy?: string;           // Field ID — required for kanban, optional for table (group rows)
	cardCoverField?: string;    // Field ID for gallery / kanban card accent
	cardFields?: string[];      // Field IDs shown on kanban/gallery cards
	sort: Array<{ fieldId: string; direction: 'asc' | 'desc' }>;
	filter: Array<{ fieldId: string; op: string; value: string }>;
	hiddenFields: string[];
	fieldOrder?: string[];               // Ordered field IDs for column order
	columnWidths?: Record<string, number>; // fieldId → px width
}

export interface DBRecord {
	id: string;
	_body?: string;  // Notes / rich text body
	[fieldId: string]: string | number | boolean | string[] | null | undefined;
}

export interface Database {
	id: string;
	name: string;
	scope?: DatabaseScope;
	schema: Field[];
	views: DBView[];
	records: DBRecord[];
	headerFieldIds?: string[];
}

// allow-any-unicode-next-line
// ─── Utility Functions ───────────────────────────────────────────────────────

export type DatabaseResolver = (databaseId: string) => Database | undefined;

export function getFieldValue(record: DBRecord, field: Field, db: Database, resolveDatabase?: DatabaseResolver): string | number | boolean | string[] | null | undefined {
	const raw = record[field.id];
	if (field.type === 'rollup') {
		return computeRollupValue(record, field, db, resolveDatabase);
	}
	if (field.type === 'formula') {
		return computeFormulaValue(record, field);
	}
	return raw;
}

/** Get display value of a field for a record */
export function getFieldDisplayValue(record: DBRecord, fieldId: string, schema?: Field[], db?: Database, resolveDatabase?: DatabaseResolver): string {
	const field = schema?.find(f => f.id === fieldId);
	const val = field && db ? getFieldValue(record, field, db, resolveDatabase) : record[fieldId];
	if (val === null || val === undefined) { return ''; }
	if (Array.isArray(val)) { return val.join(', '); }
	// allow-any-unicode-next-line
	if (typeof val === 'boolean') { return val ? '✓' : '—'; }
	return String(val);
}

/** Get the title (first text field) value for a record */
export function getRecordTitle(record: DBRecord, schema: Field[]): string {
	const titleField = schema.find(f => f.type === 'text');
	if (!titleField) { return 'Untitled'; }
	const val = record[titleField.id];
	return val !== null && val !== undefined && val !== '' ? String(val) : 'Untitled';
}

/** Returns fields visible in a given view, in their display order */
export function getVisibleFields(schema: Field[], view: DBView): Field[] {
	const order = view.fieldOrder ?? schema.map(f => f.id);
	const hidden = new Set(view.hiddenFields ?? []);
	return order
		.map(id => schema.find(f => f.id === id))
		.filter((f): f is Field => f !== undefined && !hidden.has(f.id));
}

/** Apply view sorts to a record list (does not mutate) */
export function applySorts(records: DBRecord[], sorts: DBView['sort'], schema?: Field[], db?: Database, resolveDatabase?: DatabaseResolver): DBRecord[] {
	if (!sorts.length) { return records; }
	return [...records].sort((a, b) => {
		for (const s of sorts) {
			const field = schema?.find(candidate => candidate.id === s.fieldId);
			const av = field && db ? getFieldValue(a, field, db, resolveDatabase) : (a[s.fieldId] ?? '');
			const bv = field && db ? getFieldValue(b, field, db, resolveDatabase) : (b[s.fieldId] ?? '');
			const cmp = compareValues(av, bv);
			if (cmp !== 0) { return s.direction === 'asc' ? cmp : -cmp; }
		}
		return 0;
	});
}

/** Apply view filters to a record list */
export function applyFilters(records: DBRecord[], filters: DBView['filter'], schema?: Field[], db?: Database, resolveDatabase?: DatabaseResolver): DBRecord[] {
	if (!filters.length) { return records; }
	return records.filter(record => {
		return filters.every(f => {
			const field = schema?.find(candidate => candidate.id === f.fieldId);
			const val = field && db ? getFieldValue(record, field, db, resolveDatabase) : record[f.fieldId];
			const strVal = valueAsFilterString(val);
			const filterVal = f.value.toLowerCase();
			switch (f.op) {
				case 'contains': return strVal.includes(filterVal);
				case 'not_contains': return !strVal.includes(filterVal);
				case 'equals': return strVal === filterVal;
				case 'not_equals': return strVal !== filterVal;
				case 'is_empty': return val === null || val === undefined || val === '' || (Array.isArray(val) && val.length === 0);
				case 'is_not_empty': return val !== null && val !== undefined && val !== '' && !(Array.isArray(val) && val.length === 0);
				case 'gt': return Number(val) > Number(f.value);
				case 'gte': return Number(val) >= Number(f.value);
				case 'lt': return Number(val) < Number(f.value);
				case 'lte': return Number(val) <= Number(f.value);
				default: return true;
			}
		});
	});
}

function compareValues(a: unknown, b: unknown): number {
	if ((a === null || a === undefined) && (b === null || b === undefined)) { return 0; }
	if (a === null || a === undefined) { return -1; }
	if (b === null || b === undefined) { return 1; }

	if (typeof a === 'number' && typeof b === 'number') {
		return a - b;
	}
	if (typeof a === 'boolean' && typeof b === 'boolean') {
		return Number(a) - Number(b);
	}

	const aText = valueAsFilterString(a);
	const bText = valueAsFilterString(b);
	return aText.localeCompare(bText, undefined, { numeric: true, sensitivity: 'base' });
}

function valueAsFilterString(value: unknown): string {
	if (value === null || value === undefined) { return ''; }
	if (Array.isArray(value)) { return value.map(item => String(item)).join(', ').toLowerCase(); }
	if (typeof value === 'boolean') { return value ? 'true' : 'false'; }
	return String(value).toLowerCase();
}

/** Status color for a given value */
export function getStatusColor(value: string): string {
	return STATUS_GROUPS[value]?.color ?? '#5e5e5e';
}

const DEFAULT_OPTION_COLORS = [
	'#6b7280', '#8b6b4a', '#f59e0b', '#10b981', '#3b82f6', '#a855f7', '#ef4444',
];

export function getFieldOptionColor(field: Field, option: string): string {
	const explicit = field.optionColors?.[option];
	if (explicit) {
		return explicit;
	}
	const options = field.options ?? [];
	const index = options.indexOf(option);
	if (index >= 0) {
		return DEFAULT_OPTION_COLORS[index % DEFAULT_OPTION_COLORS.length];
	}
	return DEFAULT_OPTION_COLORS[0];
}

export function getReadableTextColor(background: string): string {
	const hex = background.replace('#', '').trim();
	if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
		return '#ffffff';
	}
	const r = parseInt(hex.slice(0, 2), 16);
	const g = parseInt(hex.slice(2, 4), 16);
	const b = parseInt(hex.slice(4, 6), 16);
	const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
	return luminance > 0.62 ? '#1f2937' : '#ffffff';
}

export function getRelationTargetDatabase(db: Database, relationField: Field, resolveDatabase?: DatabaseResolver): Database {
	const targetDatabaseId = relationField.relation?.targetDatabaseId;
	if (targetDatabaseId && resolveDatabase) {
		return resolveDatabase(targetDatabaseId) ?? db;
	}
	return db;
}

export function inferImplicitRelationTargets(db: Database, databases: Iterable<Database>): boolean {
	const peers = [...databases].filter(candidate => candidate.id !== db.id);
	let changed = false;

	for (const field of db.schema) {
		if (field.type !== 'relation') {
			continue;
		}
		field.relation ??= {};
		if (field.relation.targetDatabaseId) {
			continue;
		}
		const inferred = inferTargetDatabase(field.name, db.name, peers);
		if (!inferred) {
			continue;
		}
		field.relation.targetDatabaseId = inferred.id;
		changed = true;

		if (!field.relation.targetRelationFieldId) {
			const backlink = inferBacklinkField(inferred, db.name);
			if (backlink) {
				field.relation.targetRelationFieldId = backlink.id;
			}
		}
	}

	return changed;
}

function inferTargetDatabase(relationFieldName: string, sourceDbName: string, peers: Database[]): Database | undefined {
	const relationToken = normalizeToken(relationFieldName);
	const sourceToken = normalizeToken(sourceDbName);
	const candidates = [
		...peers.filter(candidate => normalizeToken(candidate.name) === relationToken),
		...peers.filter(candidate => normalizeToken(candidate.name).includes(relationToken)),
		...peers.filter(candidate => relationToken.includes(normalizeToken(candidate.name))),
	];
	if (candidates.length) {
		return candidates[0];
	}
	if (relationToken.includes('project')) {
		return peers.find(candidate => normalizeToken(candidate.name).includes('project'));
	}
	if (sourceToken.includes('task') && relationToken.includes('project')) {
		return peers.find(candidate => normalizeToken(candidate.name).includes('project'));
	}
	if (sourceToken.includes('project') && relationToken.includes('task')) {
		return peers.find(candidate => normalizeToken(candidate.name).includes('task'));
	}
	return undefined;
}

function inferBacklinkField(targetDb: Database, sourceDbName: string): Field | undefined {
	const sourceToken = normalizeToken(sourceDbName);
	return targetDb.schema.find(field =>
		field.type === 'relation' &&
		normalizeToken(field.name).includes(sourceToken)
	);
}

function normalizeToken(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/s$/, '');
}

function computeRollupValue(record: DBRecord, field: Field, db: Database, resolveDatabase?: DatabaseResolver): number | null {
	const rollup = field.rollup;
	if (!rollup) {
		return null;
	}
	const relationField = db.schema.find(candidate => candidate.id === rollup.relationFieldId && candidate.type === 'relation');
	if (!relationField) {
		return null;
	}
	const targetDb = getRelationTargetDatabase(db, relationField, resolveDatabase);
	const rawLinked = record[relationField.id];
	const linkedIds = Array.isArray(rawLinked) ? rawLinked.map(id => String(id)) : [];
	if (!linkedIds.length) {
		return rollup.aggregation === 'count' ? 0 : null;
	}
	const linkedRecords = targetDb.records.filter(candidate => linkedIds.includes(candidate.id));
	if (!linkedRecords.length) {
		return rollup.aggregation === 'count' ? 0 : null;
	}
	if (rollup.aggregation === 'count') {
		return linkedRecords.length;
	}
	if (rollup.aggregation === 'count_not_empty') {
		const target = rollup.targetFieldId;
		if (!target) {
			return 0;
		}
		return linkedRecords.filter(linked => {
			const value = linked[target];
			return value !== null && value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0);
		}).length;
	}
	const targetFieldId = rollup.targetFieldId;
	if (!targetFieldId) {
		return null;
	}
	const nums = linkedRecords
		.map(linked => Number(linked[targetFieldId]))
		.filter(value => Number.isFinite(value));
	if (!nums.length) {
		return null;
	}
	switch (rollup.aggregation) {
		case 'sum':
			return nums.reduce((sum, value) => sum + value, 0);
		case 'avg':
			return nums.reduce((sum, value) => sum + value, 0) / nums.length;
		case 'min':
			return Math.min(...nums);
		case 'max':
			return Math.max(...nums);
		default:
			return null;
	}
}

function computeFormulaValue(record: DBRecord, field: Field): string | number | null {
	let expression = field.formula?.expression?.trim();
	if (!expression) {
		return null;
	}
	if (expression.startsWith('=')) {
		expression = expression.slice(1).trim();
	}

	const functionMatch = /^([a-zA-Z_][a-zA-Z0-9_]*)\((.*)\)$/.exec(expression);
	if (functionMatch) {
		const fnName = functionMatch[1].toUpperCase();
		const args = splitFormulaArgs(functionMatch[2]).map(arg => evaluateFormulaToken(arg, record));
		return applyFormulaFunction(fnName, args, record);
	}

	const arithmetic = tryEvaluateArithmetic(expression, record);
	if (arithmetic !== null && arithmetic !== undefined) {
		return arithmetic;
	}

	const replaced = expression.replace(/\{([^}]+)\}/g, (_full, fieldId) => {
		const value = record[String(fieldId).trim()];
		if (value === null || value === undefined) { return ''; }
		if (Array.isArray(value)) { return value.join(', '); }
		return String(value);
	});
	const asNumber = Number(replaced);
	return Number.isFinite(asNumber) && replaced !== '' ? asNumber : replaced;
}

function splitFormulaArgs(args: string): string[] {
	const out: string[] = [];
	let current = '';
	let depth = 0;
	let quote: '"' | '\'' | null = null;
	for (let i = 0; i < args.length; i++) {
		const ch = args[i];
		if ((ch === '"' || ch === '\'') && (!quote || quote === ch)) {
			quote = quote ? null : (ch as '"' | '\'');
			current += ch;
			continue;
		}
		if (!quote) {
			if (ch === '(') { depth++; current += ch; continue; }
			if (ch === ')') { depth = Math.max(0, depth - 1); current += ch; continue; }
			if (ch === ',' && depth === 0) {
				out.push(current.trim());
				current = '';
				continue;
			}
		}
		current += ch;
	}
	if (current.trim()) {
		out.push(current.trim());
	}
	return out;
}

function evaluateFormulaToken(token: string, record: DBRecord): string | number | boolean | null {
	const t = token.trim();
	if (!t.length) { return null; }
	if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith('\'') && t.endsWith('\''))) {
		return t.slice(1, -1);
	}
	const num = Number(t);
	if (Number.isFinite(num) && !/[a-zA-Z{}]/.test(t)) {
		return num;
	}
	const fieldRef = /^\{([^}]+)\}$/.exec(t);
	if (fieldRef) {
		const value = record[fieldRef[1].trim()];
		if (Array.isArray(value)) { return value.join(', '); }
		if (value === null || value === undefined) { return null; }
		return value as string | number | boolean;
	}
	const bool = t.toLowerCase();
	if (bool === 'true') { return true; }
	if (bool === 'false') { return false; }
	return t;
}

function applyFormulaFunction(name: string, args: Array<string | number | boolean | null>, record: DBRecord): string | number | null {
	switch (name) {
		case 'SUM':
			return numericArgs(args).reduce((sum, value) => sum + value, 0);
		case 'AVG': {
			const nums = numericArgs(args);
			return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : 0;
		}
		case 'MIN': {
			const nums = numericArgs(args);
			return nums.length ? Math.min(...nums) : 0;
		}
		case 'MAX': {
			const nums = numericArgs(args);
			return nums.length ? Math.max(...nums) : 0;
		}
		case 'ABS':
			return Math.abs(Number(args[0] ?? 0));
		case 'ROUND':
			return Math.round(Number(args[0] ?? 0));
		case 'LEN':
			return String(args[0] ?? '').length;
		case 'UPPER':
			return String(args[0] ?? '').toUpperCase();
		case 'LOWER':
			return String(args[0] ?? '').toLowerCase();
		case 'CONCAT':
			return args.map(value => value === null || value === undefined ? '' : String(value)).join('');
		case 'NOW':
			return new Date().toISOString();
		case 'TODAY':
			return new Date().toISOString().slice(0, 10);
		case 'IF': {
			const condition = evaluateFormulaCondition(args[0], record);
			return condition
				? (args[1] === null || args[1] === undefined ? '' : (args[1] as string | number))
				: (args[2] === null || args[2] === undefined ? '' : (args[2] as string | number));
		}
		default:
			return args[0] === null || args[0] === undefined ? null : String(args[0]);
	}
}

function evaluateFormulaCondition(raw: string | number | boolean | null, record: DBRecord): boolean {
	if (typeof raw === 'boolean') { return raw; }
	if (typeof raw === 'number') { return raw !== 0; }
	if (raw === null || raw === undefined) { return false; }
	const condition = String(raw).trim();
	const match = /(.+?)(>=|<=|!=|=|>|<)(.+)/.exec(condition);
	if (!match) {
		return Boolean(condition);
	}
	const left = evaluateFormulaToken(match[1].trim(), record);
	const right = evaluateFormulaToken(match[3].trim(), record);
	const op = match[2];
	if (typeof left === 'number' || typeof right === 'number') {
		const ln = Number(left ?? 0);
		const rn = Number(right ?? 0);
		switch (op) {
			case '>': return ln > rn;
			case '<': return ln < rn;
			case '>=': return ln >= rn;
			case '<=': return ln <= rn;
			case '=': return ln === rn;
			case '!=': return ln !== rn;
			default: return false;
		}
	}
	const ls = String(left ?? '');
	const rs = String(right ?? '');
	switch (op) {
		case '=': return ls === rs;
		case '!=': return ls !== rs;
		case '>': return ls > rs;
		case '<': return ls < rs;
		case '>=': return ls >= rs;
		case '<=': return ls <= rs;
		default: return false;
	}
}

function numericArgs(args: Array<string | number | boolean | null>): number[] {
	return args.map(value => Number(value)).filter(value => Number.isFinite(value));
}

function tryEvaluateArithmetic(expression: string, record: DBRecord): number | null {
	const replaced = expression.replace(/\{([^}]+)\}/g, (_full, fieldId) => {
		const value = Number(record[String(fieldId).trim()]);
		return Number.isFinite(value) ? String(value) : '0';
	});
	if (!/^[0-9+\-*/().\s%]+$/.test(replaced)) {
		return null;
	}
	try {
		const value = Function(`"use strict"; return (${replaced});`)();
		return Number.isFinite(value) ? Number(value) : null;
	} catch {
		return null;
	}
}
