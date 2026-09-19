export const DEMO_PROJECT_ID = '7f63f0c8-9a4e-4e2a-8ebd-a8f2b3f8c101';
export const DEMO_TASK = 'Fix duplicate Stripe webhook processing';
export const EXPECTED_RELEVANT_KEYS = [
  'bug.repeated-delivery-side-effects',
  'constraint.provider-event-id-unique',
  'decision.record-before-side-effects',
  'component.stripe-webhooks',
  'component.event-receipt-store',
  'file.webhook-handler',
  'file.event-receipts',
] as const;
export const EXPECTED_DISTRACTOR_KEYS = [
  'decision.catalog-reindex-nightly',
  'constraint.email-brand-colors',
  'decision.analytics-batch-size',
  'constraint.admin-session-timeout',
  'decision.tax-rates-daily',
] as const;
