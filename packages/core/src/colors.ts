/**
 * ---
 * @anchor: .patterns/core-module
 * @spec: specs/core-library.md#color-system
 * @task: TASK-040
 * @validated: null
 * ---
 */

import type { Field } from './types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ThemeKind = 'dark' | 'light' | 'high-contrast';

export type SemanticRole = 'danger' | 'warning' | 'success' | 'info' | 'neutral';

// ---------------------------------------------------------------------------
// Semantic palette  (role -> theme -> hex)
// ---------------------------------------------------------------------------

export const SEMANTIC_PALETTE: Record<SemanticRole, Record<ThemeKind, string>> = {
	danger:  { dark: '#e5484d', light: '#cd2b31', 'high-contrast': '#ff6369' },
	warning: { dark: '#f0a000', light: '#d97706', 'high-contrast': '#ffc53d' },
	success: { dark: '#30a46c', light: '#18794e', 'high-contrast': '#3dd68c' },
	info:    { dark: '#3b82f6', light: '#2563eb', 'high-contrast': '#70b8ff' },
	neutral: { dark: '#6b7280', light: '#4b5563', 'high-contrast': '#9ca3af' },
};

// ---------------------------------------------------------------------------
// Semantic map  (option label, lower-cased -> SemanticRole)
// ---------------------------------------------------------------------------

export const SEMANTIC_MAP: Record<string, SemanticRole> = {
	// Priority values
	critical:      'danger',
	urgent:        'danger',
	high:          'danger',
	medium:        'warning',
	low:           'success',
	none:          'neutral',

	// Status values
	'not started': 'neutral',
	todo:          'neutral',
	'to do':       'neutral',
	backlog:       'neutral',
	cancelled:     'neutral',
	canceled:      'neutral',
	'in progress': 'info',
	active:        'info',
	doing:         'info',
	'in review':   'info',
	done:          'success',
	complete:      'success',
	completed:     'success',
	closed:        'success',
	shipped:       'success',
	blocked:       'danger',
	'on hold':     'warning',
};

// ---------------------------------------------------------------------------
// Hash palette  (12 distinct hues, each with 3 theme variants)
// ---------------------------------------------------------------------------

export const HASH_PALETTE: Array<Record<ThemeKind, string>> = [
	/* 0  Rose    */ { dark: '#f43f5e', light: '#e11d48', 'high-contrast': '#ff6b81' },
	/* 1  Orange  */ { dark: '#f97316', light: '#ea580c', 'high-contrast': '#ff9f43' },
	/* 2  Amber   */ { dark: '#eab308', light: '#ca8a04', 'high-contrast': '#fcd34d' },
	/* 3  Lime    */ { dark: '#84cc16', light: '#65a30d', 'high-contrast': '#a3e635' },
	/* 4  Emerald */ { dark: '#10b981', light: '#059669', 'high-contrast': '#34d399' },
	/* 5  Teal    */ { dark: '#14b8a6', light: '#0d9488', 'high-contrast': '#2dd4bf' },
	/* 6  Cyan    */ { dark: '#06b6d4', light: '#0891b2', 'high-contrast': '#22d3ee' },
	/* 7  Blue    */ { dark: '#3b82f6', light: '#2563eb', 'high-contrast': '#60a5fa' },
	/* 8  Indigo  */ { dark: '#6366f1', light: '#4f46e5', 'high-contrast': '#818cf8' },
	/* 9  Violet  */ { dark: '#8b5cf6', light: '#7c3aed', 'high-contrast': '#a78bfa' },
	/* 10 Purple  */ { dark: '#a855f7', light: '#9333ea', 'high-contrast': '#c084fc' },
	/* 11 Pink    */ { dark: '#ec4899', light: '#db2777', 'high-contrast': '#f472b6' },
];

// ---------------------------------------------------------------------------
// Cycling palette  (indices into HASH_PALETTE for non-semantic options)
// ---------------------------------------------------------------------------

export const CYCLING_PALETTE: number[] = [0, 7, 4, 1, 10, 5, 2, 8];

// ---------------------------------------------------------------------------
// hashString  (djb2 hash, non-negative via >>> 0)
// ---------------------------------------------------------------------------

export function hashString(str: string): number {
	let hash = 5381;
	for (let i = 0; i < str.length; i++) {
		hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
	}
	return hash >>> 0;
}

// ---------------------------------------------------------------------------
// resolveStatusColor
// ---------------------------------------------------------------------------

export function resolveStatusColor(value: string, theme: ThemeKind): string {
	const role = SEMANTIC_MAP[value.toLowerCase()] ?? 'neutral';
	return SEMANTIC_PALETTE[role][theme];
}

// ---------------------------------------------------------------------------
// resolveFieldOptionColor
// ---------------------------------------------------------------------------

export function resolveFieldOptionColor(field: Field, option: string, theme: ThemeKind): string {
	// 1. Explicit optionColors override wins
	const explicit = field.optionColors?.[option];
	if (explicit) return explicit;

	// 2. Semantic match
	const role = SEMANTIC_MAP[option.toLowerCase()];
	if (role) return SEMANTIC_PALETTE[role][theme];

	// 3. Cycling fallback based on position in options list
	const options = field.options ?? [];
	const index = options.indexOf(option);
	const cycleIndex = index >= 0 ? index : 0;
	const paletteIndex = CYCLING_PALETTE[cycleIndex % CYCLING_PALETTE.length];
	return HASH_PALETTE[paletteIndex][theme];
}

// ---------------------------------------------------------------------------
// resolveRelationColor
// ---------------------------------------------------------------------------

export function resolveRelationColor(title: string, theme: ThemeKind): string {
	const index = hashString(title) % 12;
	return HASH_PALETTE[index][theme];
}
