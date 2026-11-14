# Contributing

Bug reports and PRs welcome. The security model is the product — keep these invariants:

1. Every query runs inside `withTenant()`. No exceptions, ever.
2. Tools never accept a tenant id as an argument.
3. Tokens are stored and compared as SHA-256 hashes only.
4. New tables get `tenant_id`, RLS enabled + forced, and the isolation policy.
5. The app role stays minimal: add grants, never ownership or superuser.

Run `npm test && npm run test:integration` in `server/` before submitting.
