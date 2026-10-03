/**
 * The shared styling helpers every shadcn component imports.
 *
 * It lives in the package rather than in an app because that is what makes the
 * components shared: `cn()` is not a project convention, it is part of how these
 * components are written.
 *
 * The `Without*` types are the shapes the bits-ui-backed components need to drop
 * props they re-implement themselves.
 */
export { cn } from 'cn';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChild<T> = T extends { child?: any } ? Omit<T, 'child'> : T;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChildren<T> = T extends { children?: any } ? Omit<T, 'children'> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };
