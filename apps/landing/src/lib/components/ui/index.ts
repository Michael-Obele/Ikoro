/**
 * The landing site's shadcn-svelte components, behind one named seam.
 *
 * This file was `packages/ui`'s public surface until that package was removed:
 * shadcn-svelte has no monorepo CLI routing, so a central UI package bought no
 * automation — only indirection. Each app now owns its own copy and lists its
 * own imports here. See AGENTS.md.
 *
 * `export *` would make this a folder rather than a seam: every component
 * dropped into `components/ui/` would silently become importable, and nothing
 * would record that anybody agreed to it. Listing the exports is the record.
 *
 * Add a line here in the same commit that adds the component, not later.
 */

// ── primitives this site uses ────────────────────────────────────────────────
export { Alert, AlertAction, AlertDescription, AlertTitle, alertVariants } from './alert/index.js';
export type { AlertVariant } from './alert/index.js';

export { Badge, badgeVariants } from './badge/index.js';
export type { BadgeVariant } from './badge/index.js';

export { Button, buttonVariants } from './button/index.js';
export type { ButtonProps, ButtonSize, ButtonVariant } from './button/index.js';

export {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle
} from './card/index.js';

export * as DropdownMenu from './dropdown-menu/index.js';

export { Separator } from './separator/index.js';

// ── the helpers the components are built on ──────────────────────────────────
export { cn } from '../../utils.js';
export type {
	WithElementRef,
	WithoutChild,
	WithoutChildren,
	WithoutChildrenOrChild
} from '../../utils.js';
