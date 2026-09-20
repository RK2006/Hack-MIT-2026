import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The Tripline layout fixed by docs/specs/demo-tripline.md §6.1 T2. */
export const TRIPLINE_LAYOUT = [
  'README.md',
  'CONTRIBUTING.md',
  'src/server.ts',
  'src/db/schema.sql',
  'src/db/client.ts',
  'src/db/migrate.ts',
  'src/db/seed.ts',
  'src/auth/session.ts',
  'src/auth/middleware.ts',
  'src/trips/routes.ts',
  'src/trips/service.ts',
  'src/trips/types.ts',
  'src/itinerary/routes.ts',
  'src/itinerary/service.ts',
  'src/itinerary/timezone.ts',
  'src/itinerary/types.ts',
  'src/pricing/money.ts',
  'src/pricing/quote.ts',
  'src/pricing/fx.ts',
  'src/providers/flights.ts',
  'src/providers/hotels.ts',
  'src/providers/cache.ts',
  'src/providers/rateLimit.ts',
  'src/providers/retry.ts',
  'src/providers/fake/flightsFake.ts',
  'src/providers/fake/hotelsFake.ts',
  'src/bookings/routes.ts',
  'src/bookings/service.ts',
  'src/bookings/idempotency.ts',
  'src/bookings/types.ts',
  'src/notifications/reminders.ts',
  'src/notifications/scheduler.ts',
  'src/notifications/email.ts',
  'tests/reminders.test.ts',
  'tests/hotels.test.ts',
  'docs/adr/ADR-001-store-utc-render-in-stop-zone.md',
  'docs/adr/ADR-002-minor-units-and-locked-fx.md',
  'docs/adr/ADR-003-client-booking-ref-idempotency.md',
  'docs/adr/ADR-004-provider-search-cache.md',
  'docs/adr/ADR-005-soft-delete-stops.md',
];

/** Task sentences from the demo spec §5.1 (primary) and its backup. */
export const TRIPLINE_PRIMARY_TASK =
  'Trip reminders fire at the wrong local time for stops in another time zone';
export const TRIPLINE_BACKUP_TASK =
  'Fix the hotel adapter creating duplicate reservations on retry after a provider timeout';

/** Spec §14 A3: what the primary task must select and must not. */
export const PRIMARY_EXPECTED_KEYS = [
  'file.src-notifications-reminders-ts',
  'component.src-notifications',
  'constraint.utc-storage-stop-zone-display',
  'decision.adr-001-store-utc-render-stop-zone',
  'bug.reminders-home-zone',
];
export const PRIMARY_EXCLUDED_PREFIXES = [
  'component.src-pricing',
  'component.src-providers',
  'component.src-auth',
  'file.src-pricing-',
  'file.src-providers-',
  'file.src-auth-',
];

/** A throwaway git checkout with the T2 layout, for when no real Tripline clone is available. */
export async function createLayoutCheckout(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'tripline-layout-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: root,
      stdio: 'pipe',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@t',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@t',
      },
    });
  git('init', '-q');
  for (const path of TRIPLINE_LAYOUT) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), path.endsWith('.md') ? `# ${path}\n` : `// ${path}\n`);
  }
  git('add', '-A');
  git('commit', '-q', '-m', 'layout');
  return root;
}
