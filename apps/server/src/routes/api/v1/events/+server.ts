/**
 * `GET /api/v1/events` — an alias for `/api/v1/stream`.
 *
 * Same stream, one implementation: this re-exports the canonical handler rather
 * than repeating it, because two SSE implementations would be two sets of
 * keepalive and teardown bugs and only one of them would ever get fixed.
 *
 * It exists because the route was named `events` in the M10 brief while
 * `docs/design/architecture.md` §6, `docs/design/milestones.md` and M11 Step 5 all
 * name `stream`. Both paths are live so neither the plan nor the brief is left
 * pointing at a 404; M11 should use `/api/v1/stream`.
 */

export { GET } from '../stream/+server';
