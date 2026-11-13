# Lender data for LendTrial

The lender workspace uses application snapshots for offer replay and records from the loan servicing system for pilot monitoring. The CSV examples below use fictional IDs and values to illustrate the formats. Import these examples only in a test workspace.

## Preparing the files

- Use UTF-8 comma-separated CSV with a header. The order of columns can vary. Include only the listed fields. The maximum is 5,000 data rows and 2 MB per file.
- Use stable, pseudonymous IDs issued by your lender systems. Reuse the borrower ID for later applications from that borrower. Keep the mapping to identifiable records in the source system. Leave out names, account numbers, phone numbers, and identity document data.
- Supply dates as `YYYY-MM-DD` and use the same UTC calendar-day convention for application, funding, due, and observation dates.
- Enter money as integer kobo. For example, ₦65,000 is `6500000`. Enter reference scores as fractions. For example, 8% is `0.08`.

## Applications CSV

```csv
application_id,borrower_id,requested_amount_kobo,reference_risk,successful_loans,application_date,model_type,model_version
APP-001,BOR-001,6500000,0.08,2,2026-10-01,lightgbm,20260910T150046Z
APP-002,BOR-002,7500000,0.12,1,2026-10-01,lightgbm,20260910T150046Z
APP-003,BOR-003,7000000,0.09,1,2026-10-01,lightgbm,20260910T150046Z
```

`reference_risk` is the borrower’s score at the reference terms used for both policies. Supply the type and exact version of the scorer recorded on the pilot. An application with zero successful loans can appear in replay and will fail repeat-loan eligibility. Export inputs as they were known on the application date. The score is a policy input. It is separate from the observed first-payment result.

Import historical applications into a draft to compare offers. After activating a pilot, import new applications for assignment. Draft imports and applications dated before activation remain available for replay. The first live application for each borrower whose offer would change gets an assignment. Reimporting the same application is safe. Reusing an application ID for a different snapshot is an error. Use the assignment export to route offers through the lender’s origination system.

## Funding and first payments CSV

```csv
application_id,funded_amount_kobo,funded_on,first_due_date,first_installment_kobo,paid_by_grace_kobo,observed_on
APP-001,5000000,2026-10-02,2026-10-29,1750000,,2026-10-15
APP-001,5000000,2026-10-02,2026-10-29,1750000,1750000,2026-11-06
APP-002,5000000,2026-10-02,2026-10-29,1750000,0,2026-11-06
APP-003,0,,,,,2026-10-09
```

Import observations for assigned offers using the original `application_id`. `funded_amount_kobo` is the actual disbursement and cannot exceed the assigned offer. When an offer was confirmed unfunded, use `funded_amount_kobo=0` and leave the funding date, due date, installment amount, and paid amount blank. Provide the observation date for every record.

For a funded loan with an interim observation, leave `paid_by_grace_kobo` blank. After the grace date has ended, enter the total actually credited to the first installment by the end of that date. Enter `0` when the servicing records confirm that no payment was credited. A blank is an unverified outcome. For a first payment due October 29 and a seven-day grace period, the earliest day to report a verified outcome is November 6.

Use `observed_on` for the date the extract reflects. An identical observation can be imported again. A later extract can record a verified outcome or correct an earlier observation, with the earlier snapshot retained for audit. A previously confirmed unfunded offer can later show funding if the actual funding date is after the unfunded observation. An imported funded loan cannot be marked unfunded. Applications without a funding or unfunded observation remain visible with funding unconfirmed.

The first-payment miss rate uses funded loans with verified outcomes after the grace period. Pending first payments and confirmed unfunded offers stay outside the denominator. Missing post-grace outcomes or assignments whose funding remains unconfirmed after seven days can hold a pilot recommendation. Reconcile application and funding counts against the source systems before relying on the comparison.

## Score applications with Can I borrow.ai

For a lender that already uses Can I borrow.ai, run its scorer locally with an exact model version. Prepare a JSON array in which each record has `application_id`, `borrower_id`, `requested_amount_kobo`, `successful_loans`, `application_date`, and `score_input`. The `score_input` object must follow the scorer’s `/api/contract`. Use the same `LoanAmount`, `InterestRate`, and `LoanTerm` for every reference score, in the scorer’s original input units. The tool supplies the pseudonymous application ID as `LoanID`.

```sh
python3 scripts/lendtrial/score_applications.py /path/to/application-snapshots.json /path/to/lendtrial-applications.csv --version YOUR_PINNED_VERSION
```

The bridge calls the loopback scorer, checks its model version and joins each score to its application ID. Its CSV contains the score and replay inputs. Keep the source feature file in the lender’s environment. Use a scorer validated for the lender’s population and product.
