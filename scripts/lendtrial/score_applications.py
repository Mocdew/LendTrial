#!/usr/bin/env python3
"""Score lender application snapshots with Can I borrow.ai and write a LendTrial CSV."""

import argparse
import csv
import json
import re
import sys
from datetime import date
from pathlib import Path

from export_scores import local_url, score_cohort

ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,63}\Z")
VERSION = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,79}\Z")
HEADER = (
    "application_id", "borrower_id", "requested_amount_kobo", "reference_risk",
    "successful_loans", "application_date", "model_type", "model_version",
)
TERMS = ("LoanAmount", "InterestRate", "LoanTerm")


def prepare(items):
    if not isinstance(items, list) or not 1 <= len(items) <= 5_000:
        raise ValueError("Provide a JSON array of 1 to 5,000 applications.")
    metadata, scorer_inputs, ids = [], [], set()
    reference_terms = None
    for number, row in enumerate(items, 1):
        if not isinstance(row, dict):
            raise ValueError(f"Row {number} must be an object.")
        app = row.get("application_id")
        borrower = row.get("borrower_id")
        amount = row.get("requested_amount_kobo")
        count = row.get("successful_loans")
        day = row.get("application_date")
        fields = row.get("score_input")
        if not all(isinstance(value, str) and ID.fullmatch(value) for value in (app, borrower)):
            raise ValueError(f"Row {number} requires pseudonymous application and borrower IDs.")
        if app in ids:
            raise ValueError(f"Row {number} repeats an application ID.")
        ids.add(app)
        if type(amount) is not int or not 1 <= amount <= 10**12:
            raise ValueError(f"Row {number} has an invalid requested amount in kobo.")
        if type(count) is not int or not 0 <= count <= 1_000:
            raise ValueError(f"Row {number} has an invalid completed-loan count.")
        if not isinstance(day, str) or date.fromisoformat(day).isoformat() != day:
            raise ValueError(f"Row {number} requires an ISO application date.")
        if not isinstance(fields, dict) or any(type(fields.get(term)) not in (int, float) for term in TERMS):
            raise ValueError(f"Row {number} requires a score_input object with numeric reference terms.")
        current_terms = tuple(fields[term] for term in TERMS)
        if reference_terms is not None and current_terms != reference_terms:
            raise ValueError(f"Row {number} uses different reference terms.")
        reference_terms = current_terms
        metadata.append((app, borrower, amount, count, day))
        scorer_inputs.append({**fields, "LoanID": app})
    return metadata, scorer_inputs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="JSON array of applications and score inputs.")
    parser.add_argument("output", type=Path, help="Path for the new LendTrial applications CSV.")
    parser.add_argument("--version", required=True, help="Exact pinned Can I borrow.ai model version.")
    parser.add_argument("--base-url", type=local_url, default="http://127.0.0.1:5000")
    parser.add_argument("--model", choices=("lightgbm", "logistic_regression"), default="lightgbm")
    args = parser.parse_args()
    if not VERSION.fullmatch(args.version) or args.version.lower() == "latest":
        parser.error("--version must identify an exact model version.")
    try:
        if args.input.stat().st_size > 10_000_000:
            raise ValueError("Choose a JSON input up to 10 MB.")
        metadata, inputs = prepare(json.loads(args.input.read_text(encoding="utf-8")))
        scores = score_cohort(args.base_url, args.model, args.version, inputs)
        with args.output.open("x", encoding="utf-8", newline="") as stream:
            writer = csv.writer(stream)
            writer.writerow(HEADER)
            writer.writerows(
                (app, borrower, amount, scores[app], count, day, args.model, args.version)
                for app, borrower, amount, count, day in metadata
            )
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
        print(f"Export failed: {exc}", file=sys.stderr)
        return 1
    print(f"Exported {len(metadata):,} applications for LendTrial.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
