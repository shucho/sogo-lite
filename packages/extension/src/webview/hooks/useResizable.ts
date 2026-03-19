/**
 * ---
 * @anchor: .patterns/core-module
 * @spec: specs/vscode-extension.md#peek-panel
 * @task: TASK-041
 * @validated: null
 * ---
 */

import { useState, useCallback, useRef, useEffect } from 'react';

interface UseResizableOptions {
	/** Initial width in pixels */
	initialWidth: number;
	/** Minimum allowed width in pixels */
	minWidth: number;
	/** Maximum allowed width as fraction of viewport (0-1) */
	maxWidthVw: number;
	/** localStorage key for persisting width (optional) */
	storageKey?: string;
}

interface UseResizableReturn {
	/** Current panel width in pixels */
	width: number;
	/** Whether a drag is currently in progress */
	isDragging: boolean;
	/** Attach to the handle's onMouseDown */
	onDragStart: (e: React.MouseEvent) => void;
}

function clampWidth(width: number, minWidth: number, maxWidthVw: number): number {
	const maxPx = window.innerWidth * maxWidthVw;
	return Math.round(Math.max(minWidth, Math.min(width, maxPx)));
}

function loadPersistedWidth(key: string | undefined, fallback: number): number {
	if (!key) return fallback;
	try {
		const stored = localStorage.getItem(key);
		if (stored) {
			const parsed = Number(stored);
			if (Number.isFinite(parsed) && parsed > 0) return parsed;
		}
	} catch {
		// localStorage may be unavailable in webview
	}
	return fallback;
}

function persistWidth(key: string | undefined, width: number): void {
	if (!key) return;
	try {
		localStorage.setItem(key, String(width));
	} catch {
		// silently ignore
	}
}

export function useResizable({
	initialWidth,
	minWidth,
	maxWidthVw,
	storageKey,
}: UseResizableOptions): UseResizableReturn {
	const [width, setWidth] = useState(() =>
		clampWidth(loadPersistedWidth(storageKey, initialWidth), minWidth, maxWidthVw),
	);
	const [isDragging, setIsDragging] = useState(false);

	const dragState = useRef<{ startX: number; startWidth: number } | null>(null);

	const onDragStart = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			dragState.current = { startX: e.clientX, startWidth: width };
			setIsDragging(true);
		},
		[width],
	);

	useEffect(() => {
		if (!isDragging) return;

		function handleMouseMove(e: MouseEvent) {
			if (!dragState.current) return;
			// Panel is on the right edge, so dragging left (decreasing clientX) increases width
			const delta = dragState.current.startX - e.clientX;
			const next = clampWidth(dragState.current.startWidth + delta, minWidth, maxWidthVw);
			setWidth(next);
		}

		function handleMouseUp() {
			setIsDragging(false);
			if (dragState.current) {
				dragState.current = null;
			}
		}

		// Prevent text selection during drag
		const prevUserSelect = document.body.style.userSelect;
		const prevCursor = document.body.style.cursor;
		document.body.style.userSelect = 'none';
		document.body.style.cursor = 'col-resize';

		window.addEventListener('mousemove', handleMouseMove);
		window.addEventListener('mouseup', handleMouseUp);

		return () => {
			document.body.style.userSelect = prevUserSelect;
			document.body.style.cursor = prevCursor;
			window.removeEventListener('mousemove', handleMouseMove);
			window.removeEventListener('mouseup', handleMouseUp);
		};
	}, [isDragging, minWidth, maxWidthVw]);

	// Persist width when drag ends
	const prevDragging = useRef(isDragging);
	useEffect(() => {
		if (prevDragging.current && !isDragging) {
			persistWidth(storageKey, width);
		}
		prevDragging.current = isDragging;
	}, [isDragging, width, storageKey]);

	// Re-clamp on window resize
	useEffect(() => {
		function handleResize() {
			setWidth((w) => clampWidth(w, minWidth, maxWidthVw));
		}
		window.addEventListener('resize', handleResize);
		return () => window.removeEventListener('resize', handleResize);
	}, [minWidth, maxWidthVw]);

	return { width, isDragging, onDragStart };
}
