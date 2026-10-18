# Kiểm thử US-20 wellness

Đợt sửa sau QA ngày18/10/2026 đã hoàn thành kế hoạch [FIX_PLAN_US-20_QA.md](FIX_PLAN_US-20_QA.md).

- [Báo cáo kết quả, phạm vi và giới hạn](../test/US20_FIX_2026-10-18/REPORT.md).
- [24 test case retest đúng16 cột](../test/US20_FIX_2026-10-18/TEST_CASES_RETEST.md).
- [Lệnh chạy lại và fixtures](../test/US20_FIX_2026-10-18/REPRODUCE.md).
- [Manifest revisions/checksums](../test/US20_FIX_2026-10-18/manifest.json).
- [Vận hành/rollback M5](RUNBOOK_M5_WELLNESS.md).

Unit/module, PostgreSQL16, HTTP provider/callback, browser caregiver/resident và regression ghép thử đã chạy. Passed là kết luận kiểm chứng cục bộ, không phải số đo độ chính xác của camera thật hoặc nghiệm thu Telegram production. Không merge main khi các lỗi pose/fall trong báo cáo QA cũ còn mở.
