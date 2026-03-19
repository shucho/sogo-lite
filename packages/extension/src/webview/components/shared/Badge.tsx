/**
 * ---
 * @anchor: .patterns/core-module
 * @spec: specs/vscode-extension.md#shared-components
 * @task: TASK-033
 * @validated: null
 * ---
 */

import { getReadableTextColor } from 'sogo-db-core';

interface BadgeProps {
	label: string;
	color?: string;
	onClick?: () => void;
	/** When set, non-active badges render at reduced opacity */
	active?: boolean;
}

export function Badge({ label, color, onClick, active }: BadgeProps) {
	const bg = color ?? 'var(--vscode-badge-background)';
	const fg = color ? getReadableTextColor(color) : 'var(--vscode-badge-foreground)';
	const opacity = active === undefined ? 1 : active ? 1 : 0.35;

	return (
		<span
			className="db-select-badge transition-opacity"
			style={{ backgroundColor: bg, color: fg, opacity, cursor: onClick ? 'pointer' : undefined }}
			onClick={onClick}
			role={onClick ? 'button' : undefined}
		>
			{label}
		</span>
	);
}
