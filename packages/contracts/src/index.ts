/**
 * Diem export duy nhat cho kieu du lieu dung chung FE <-> BE.
 *
 * QUY TAC (task 0.4 — contract-first):
 *   1. Nguon su that la `api/openapi.yaml`. Sua spec truoc, sinh lai kieu sau.
 *   2. `src/generated/` do `pnpm contracts:generate` sinh ra — KHONG sua tay.
 *   3. Chi viet tay trong `src/enums.ts` nhung gia tri dung chung ca runtime.
 */
export * from './enums';
export type { components, operations, paths } from './generated/orchestrator';
