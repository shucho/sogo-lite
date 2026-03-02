import { describe, it, expect } from 'vitest';
import {
	resolveStatusColor,
	resolveFieldOptionColor,
	resolveRelationColor,
	hashString,
	SEMANTIC_PALETTE,
	HASH_PALETTE,
	CYCLING_PALETTE,
} from '../colors.js';
import type { Field } from '../types.js';

// ---------------------------------------------------------------------------
// resolveStatusColor
// ---------------------------------------------------------------------------

describe('resolveStatusColor', () => {
	it('returns danger color for "Blocked" in dark theme', () => {
		expect(resolveStatusColor('Blocked', 'dark')).toBe(SEMANTIC_PALETTE.danger.dark);
	});

	it('returns success color for "Done" in light theme', () => {
		expect(resolveStatusColor('Done', 'light')).toBe(SEMANTIC_PALETTE.success.light);
	});

	it('returns info color for "In progress" in high-contrast theme', () => {
		expect(resolveStatusColor('In progress', 'high-contrast')).toBe(SEMANTIC_PALETTE.info['high-contrast']);
	});

	it('returns neutral color for "Not started" in dark theme', () => {
		expect(resolveStatusColor('Not started', 'dark')).toBe(SEMANTIC_PALETTE.neutral.dark);
	});

	it('returns warning color for "On hold" in light theme', () => {
		expect(resolveStatusColor('On hold', 'light')).toBe(SEMANTIC_PALETTE.warning.light);
	});

	it('is case insensitive', () => {
		expect(resolveStatusColor('DONE', 'dark')).toBe(SEMANTIC_PALETTE.success.dark);
		expect(resolveStatusColor('blocked', 'dark')).toBe(SEMANTIC_PALETTE.danger.dark);
		expect(resolveStatusColor('IN PROGRESS', 'light')).toBe(SEMANTIC_PALETTE.info.light);
	});

	it('falls back to neutral for unknown status', () => {
		expect(resolveStatusColor('Nonexistent', 'dark')).toBe(SEMANTIC_PALETTE.neutral.dark);
		expect(resolveStatusColor('Nonexistent', 'light')).toBe(SEMANTIC_PALETTE.neutral.light);
		expect(resolveStatusColor('Nonexistent', 'high-contrast')).toBe(SEMANTIC_PALETTE.neutral['high-contrast']);
	});
});

// ---------------------------------------------------------------------------
// resolveFieldOptionColor
// ---------------------------------------------------------------------------

describe('resolveFieldOptionColor', () => {
	const priorityField: Field = {
		id: 'f1',
		name: 'Priority',
		type: 'select',
		options: ['Critical', 'High', 'Medium', 'Low', 'None'],
	};

	it('returns danger for semantic match "High"', () => {
		expect(resolveFieldOptionColor(priorityField, 'High', 'dark')).toBe(SEMANTIC_PALETTE.danger.dark);
	});

	it('returns warning for semantic match "Medium" in light theme', () => {
		expect(resolveFieldOptionColor(priorityField, 'Medium', 'light')).toBe(SEMANTIC_PALETTE.warning.light);
	});

	it('returns success for semantic match "Low"', () => {
		expect(resolveFieldOptionColor(priorityField, 'Low', 'dark')).toBe(SEMANTIC_PALETTE.success.dark);
	});

	it('optionColors override wins over semantic match', () => {
		const field: Field = {
			id: 'f2',
			name: 'Status',
			type: 'status',
			options: ['Done', 'In progress'],
			optionColors: { Done: '#ff0000' },
		};
		expect(resolveFieldOptionColor(field, 'Done', 'dark')).toBe('#ff0000');
	});

	it('uses cycling fallback for non-semantic options', () => {
		const field: Field = {
			id: 'f3',
			name: 'Category',
			type: 'select',
			options: ['Alpha', 'Beta', 'Gamma'],
		};
		// 'Alpha' at index 0 -> CYCLING_PALETTE[0] = 0 -> HASH_PALETTE[0]
		expect(resolveFieldOptionColor(field, 'Alpha', 'dark')).toBe(HASH_PALETTE[CYCLING_PALETTE[0]].dark);
		// 'Beta' at index 1 -> CYCLING_PALETTE[1] = 7 -> HASH_PALETTE[7]
		expect(resolveFieldOptionColor(field, 'Beta', 'dark')).toBe(HASH_PALETTE[CYCLING_PALETTE[1]].dark);
		// 'Gamma' at index 2 -> CYCLING_PALETTE[2] = 4 -> HASH_PALETTE[4]
		expect(resolveFieldOptionColor(field, 'Gamma', 'dark')).toBe(HASH_PALETTE[CYCLING_PALETTE[2]].dark);
	});

	it('uses light theme palette for cycling fallback', () => {
		const field: Field = {
			id: 'f4',
			name: 'Category',
			type: 'select',
			options: ['Alpha', 'Beta'],
		};
		expect(resolveFieldOptionColor(field, 'Alpha', 'light')).toBe(HASH_PALETTE[CYCLING_PALETTE[0]].light);
		expect(resolveFieldOptionColor(field, 'Beta', 'light')).toBe(HASH_PALETTE[CYCLING_PALETTE[1]].light);
	});

	it('returns cycling index 0 for option not in list', () => {
		const field: Field = {
			id: 'f5',
			name: 'Tag',
			type: 'select',
			options: ['Foo', 'Bar'],
		};
		// 'Unknown' is not in options, falls to cycleIndex 0
		expect(resolveFieldOptionColor(field, 'Unknown', 'dark')).toBe(HASH_PALETTE[CYCLING_PALETTE[0]].dark);
	});
});

// ---------------------------------------------------------------------------
// resolveRelationColor
// ---------------------------------------------------------------------------

describe('resolveRelationColor', () => {
	it('returns a valid hex color', () => {
		const color = resolveRelationColor('Acme Corp', 'dark');
		expect(color).toMatch(/^#[0-9a-f]{6}$/);
	});

	it('is stable (same input returns same output)', () => {
		const a = resolveRelationColor('Project Alpha', 'dark');
		const b = resolveRelationColor('Project Alpha', 'dark');
		expect(a).toBe(b);
	});

	it('different titles usually produce different colors', () => {
		const colors = new Set(
			['Alice', 'Bob', 'Charlie', 'Delta', 'Echo', 'Foxtrot'].map(t => resolveRelationColor(t, 'dark')),
		);
		// With 6 inputs across 12 hues, we expect at least 2 distinct colors
		expect(colors.size).toBeGreaterThanOrEqual(2);
	});

	it('adapts to theme', () => {
		const dark = resolveRelationColor('Test', 'dark');
		const light = resolveRelationColor('Test', 'light');
		const hc = resolveRelationColor('Test', 'high-contrast');
		// All should be valid hex
		expect(dark).toMatch(/^#[0-9a-f]{6}$/);
		expect(light).toMatch(/^#[0-9a-f]{6}$/);
		expect(hc).toMatch(/^#[0-9a-f]{6}$/);
	});

	it('handles empty string', () => {
		const color = resolveRelationColor('', 'dark');
		expect(color).toMatch(/^#[0-9a-f]{6}$/);
	});
});

// ---------------------------------------------------------------------------
// hashString
// ---------------------------------------------------------------------------

describe('hashString', () => {
	it('returns a non-negative integer', () => {
		const result = hashString('hello');
		expect(result).toBeGreaterThanOrEqual(0);
		expect(Number.isInteger(result)).toBe(true);
	});

	it('is deterministic', () => {
		expect(hashString('test')).toBe(hashString('test'));
		expect(hashString('')).toBe(hashString(''));
	});

	it('produces different hashes for different inputs', () => {
		const a = hashString('alpha');
		const b = hashString('beta');
		expect(a).not.toBe(b);
	});

	it('handles empty string', () => {
		const result = hashString('');
		expect(result).toBeGreaterThanOrEqual(0);
		expect(Number.isInteger(result)).toBe(true);
	});
});
