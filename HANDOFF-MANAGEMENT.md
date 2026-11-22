# Management implementation handoff

## API integration

Register the module from the API bootstrap:

```ts
import { registerManagementRoutes } from './management/index.ts';
await registerManagementRoutes(app, ctx);
```

The module exports `registerManagementRoutes(app: FastifyInstance, ctx: AppContext): Promise<void>` and uses the existing context, error, auth, shared schemas, and documented database tables. All successful JSON routes use `{ data }`; the class export is a UTF-8 BOM CSV response.

## Implemented routes

- Classes: list by current user scope, create, join by invite code, members, remove member, assignments, report, CSV export, and groups.
- Content: list by ownership/publication scope, create draft, read current version by authorized user, edit as a new immutable version, preview via `ctx.createSession`, publish to a class or globally as admin, rollback by cloning a historical version into a new draft, and disable without deleting history.
- Administration: list/update users, prevent demoting or disabling the last active admin, reset password and revoke sessions, audit list, runtime overview, settings, local `/assets/...` metadata registration, and season creation.
- Question bank: private question authoring/list/detail/update, copy, class/global publication, and soft-disable routes are implemented in `services/api/src/questions/index.ts`. The API bootstrap must import and call `registerQuestionRoutes(app, ctx)`; core-agent owns that bootstrap integration.

## Boundaries and follow-up

- No controlled backup/restore operation exists in `AppContext` or the declared API contract. Backup/restore management remains unavailable pending the core agent's controlled operations interface; this module does not simulate it.
- The main API bootstrap is absent from this worktree. The core agent must register this module there.
- Database-backed integration acceptance was not run here. Core agent should verify routes against the real MySQL schema and confirm security boundaries, particularly class report field scope and the available season/settings conventions.
- The standalone management UI is in `apps/web/src/management/ManagementApp.tsx` with styles in `management.css`. It default-exports `ManagementApp({ user: UserView, onExit })`; lazy import and navigation remain the web shell's integration task.
- The UI includes class/member/group/assignment/report/export/replay workflows; an editable scene canvas, device properties, NPC dialogue, predicate task forms and rule rows; preview sessions and version/publish controls; question bank CRUD and 20 professional knowledge templates; and administrator accounts, audit, settings, local assets, and season tools.
- `GET /api/content/:id/versions` returns authorized version metadata for the editor. Content detail is limited to teachers/admins; teachers can read public content to copy it into an owned draft. Class roster/report/export require teacher/admin write-scope authorization.
- Question-bank routes require teacher/admin role; draft details are author/admin only, published details require global or class access. Student clients must receive question data through `publicLevel`, which removes answer fields. Global publication is admin-only; teachers need write access to their own class. Editing a bank question returns it to draft, while embedded level question copies remain independent.
- The level editor can copy questions from the authorized bank into `level.questions`, then edit or remove that independent copy. Task completion conditions can use `flag` + `answered:<questionId>` + `exists`.
- Visual screenshot review was not possible in this API checkout because it has no web application shell and the browser preview surface was unavailable. TypeScript and a Vite-served temporary harness module were checked; temporary harness files were removed.

## Verification

- `npm run typecheck` passed after implementation.
- No production server was accessed.
