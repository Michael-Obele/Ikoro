/**
 * The package's public surface — named, on purpose.
 *
 * `export *` would make this file a folder instead of a seam: every component
 * dropped into `components/ui/` would silently become part of what both apps can
 * import, and nothing would record that anybody agreed to it. Listing the
 * exports here is the record.
 *
 * Add a line here in the same commit that adds the component, not later.
 */

// ── primitives both apps use ─────────────────────────────────────────────────
export {
	Alert,
	AlertAction,
	AlertDescription,
	AlertTitle,
	alertVariants
} from './components/ui/alert/index.js';
export type { AlertVariant } from './components/ui/alert/index.js';

export { Badge, badgeVariants } from './components/ui/badge/index.js';
export type { BadgeVariant } from './components/ui/badge/index.js';

export { Button, buttonVariants } from './components/ui/button/index.js';
export type { ButtonProps, ButtonSize, ButtonVariant } from './components/ui/button/index.js';

export {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle
} from './components/ui/card/index.js';

export { Separator } from './components/ui/separator/index.js';

// ── the helpers the components are built on ───────────────────────────────────
export { cn } from './utils.js';
export type {
	WithElementRef,
	WithoutChild,
	WithoutChildren,
	WithoutChildrenOrChild
} from './utils.js';
