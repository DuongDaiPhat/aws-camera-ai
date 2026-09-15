<!--
  Mau PR — task 0.9.
  Nguoi review dung chinh checklist nay de duyet. PR bo trong checklist
  se bi tra lai, khong phai vi hinh thuc ma vi nhung o do chinh la DoD.
  Quy trinh day du: docs/conventions/GIT_WORKFLOW.md
-->

## Story / Task

<!-- Bat buoc. Vi du: US-13 · Escalation state machine -->

- **ID:** US-XX
- **Sprint:** S?
- **Story Point:** ?

Closes #<so issue>

## Thay doi gi

<!-- 2-5 gach dau dong, viet cho nguoi KHONG theo doi task nay doc hieu. -->

-
-

## Vi sao lam theo cach nay

<!--
  Phan quan trong nhat cua PR. Neu co lua chon kien truc, danh doi,
  hoac cach lam khong hien nhien — giai thich o day.
  Neu chi la thay doi tam thuong, ghi "Khong co gi dac biet".
-->

## Cach kiem thu

<!-- Nguoi review phai tu chay lai duoc, khong chi tin loi ban. -->

```bash
# vi du
docker compose up -d
pnpm --filter @cam/orchestrator test
```

**Ket qua mong doi:**

## Anh chup / log

<!-- Bat buoc neu co thay doi giao dien hoac output tren terminal. -->

---

## Checklist — Definition of Done

### Bat buoc cho moi PR

- [ ] CI xanh (lint, typecheck, test, openapi, migration, docker)
- [ ] Da tu doc lai diff cua chinh minh mot luot truoc khi mo PR
- [ ] Khong co `console.log`, `print()`, code chet, hoac `TODO` khong co chu
- [ ] Khong co secret / mat khau / key trong diff (NFR-09)
- [ ] Commit theo Conventional Commits (`feat(scope): ...`)

### Neu co logic nghiep vu moi

- [ ] Co unit test cho nhanh dung VA nhanh loi
- [ ] Coverage core logic khong tut xuong duoi 60% (NFR-07)
- [ ] Tham so nguong/thoi gian doc tu cau hinh, KHONG hard-code (US-15)

### Neu co doi interface

- [ ] Da sua `api/openapi.yaml` TRUOC khi sua code (contract-first)
- [ ] Da chay `pnpm contracts:generate` va commit ket qua
- [ ] Da bao cho nguoi lam dau ben kia (FE hoac BE) biet

### Neu co doi database

- [ ] Them file migration MOI (`db/migrations/000N_*.sql`), khong sua file cu
- [ ] Da cap nhat `docs/database/ERD.md`
- [ ] ENUM moi da them dong bo o ca 3 noi: SQL, `packages/contracts/src/enums.ts`, `api/openapi.yaml`

### Neu la story AI

- [ ] Co so do precision/recall tren tap test, da ghi vao bang theo doi (US-22)
- [ ] Ghi ro nguong confidence da dung

### Truoc khi bam Merge

- [ ] Da co it nhat 1 nguoi khac approve (cam merge PR cua chinh minh)
- [ ] Da chay duoc bang `docker compose up` tren may nguoi khac
- [ ] Da cap nhat README/tai lieu neu doi cach chay hoac cach cau hinh

---

## Ghi chu cho nguoi review

<!-- Cho nao ban muon duoc soi ky? Cho nao ban con phan van? -->
