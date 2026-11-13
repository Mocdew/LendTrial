#!/usr/bin/env python3
"""Score fictional applications through a pinned local Can I borrow.ai model."""

import argparse
import hashlib
import json
import math
import random
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener


REFERENCE_TERMS = {"LoanAmount": 35_000, "InterestRate": 8.5, "LoanTerm": 36}
DEFAULT_SEED = 41226
BATCH_SIZE = 250


class RejectRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError(f"Scorer redirected ({code}). Use its local address directly.")


def local_url(value):
    parsed = urlsplit(value)
    if (
        parsed.scheme not in {"http", "https"}
        or parsed.hostname not in {"localhost", "127.0.0.1", "::1"}
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
        or parsed.username is not None
        or parsed.password is not None
        or parsed.port == 0
    ):
        raise argparse.ArgumentTypeError("Use a local scorer address, e.g. http://127.0.0.1:5000.")
    return value.rstrip("/")


def request_json(base_url, path, payload=None):
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = Request(
        base_url + path,
        data=data,
        headers={"Accept": "application/json", "Content-Type": "application/json"},
    )
    opener = build_opener(ProxyHandler({}), RejectRedirects())
    try:
        with opener.open(request, timeout=30) as response:
            result = json.load(response)
    except HTTPError as exc:
        details = exc.read(2_000).decode("utf-8", errors="replace")
        raise ValueError(f"{path} returned HTTP {exc.code}: {details}") from exc
    except (URLError, TimeoutError) as exc:
        raise ValueError(f"Could not reach the Can I borrow.ai scorer at {base_url}: {exc}") from exc
    if not isinstance(result, dict):
        raise ValueError(f"{path} did not return a JSON object.")
    return result


def generate_cohort(rows, seed):
    """Make source-unit model inputs and independent naira application metadata."""
    generator = random.Random(seed)
    applications = []
    scoring_records = []
    for index in range(rows):
        loan_id = f"APP-{index + 1:04d}"
        credit_score = min(850, max(300, round(generator.gauss(690, 65))))
        scoring_records.append(
            {
                "LoanID": loan_id,
                "Age": generator.randint(27, 65),
                "Income": generator.randint(42_000, 145_000),
                **REFERENCE_TERMS,
                "CreditScore": credit_score,
                "MonthsEmployed": generator.randint(12, 240),
                "NumCreditLines": generator.randint(1, 5),
                "DTIRatio": round(generator.uniform(0.10, 0.50), 3),
                "Education": generator.choice(("High School", "Bachelor's", "Master's", "PhD")),
                "EmploymentType": generator.choice(("Full-time", "Full-time", "Self-employed")),
                "LoanPurpose": generator.choice(("Auto", "Business", "Education", "Home", "Other")),
                "HasMortgage": generator.choice(("Yes", "No")),
                "HasCoSigner": generator.choice(("Yes", "No")),
            }
        )
        applications.append(
            {
                "id": loan_id,
                "borrowerId": f"BOR-{index + 1:04d}",
                "requestedAmount": generator.randrange(25, 111) * 1_000,
                "successfulLoans": generator.choices((0, 1, 2, 3, 4), (1, 5, 4, 2, 1))[0],
                "applicationDay": generator.randint(0, 55),
            }
        )
    return applications, scoring_records


def score_cohort(base_url, model, version, records):
    contract = request_json(base_url, "/api/contract")
    fields = contract.get("fields")
    if not isinstance(fields, list) or not fields:
        raise ValueError("The scorer did not return its input contract.")
    required = {field["name"] for field in fields if field.get("required") is True}
    missing = required - records[0].keys()
    if missing:
        raise ValueError("Generated inputs lack required fields: " + ", ".join(sorted(missing)))

    info = request_json(base_url, "/api/model-info?" + urlencode({"model": model}))
    if info.get("active_model") != model or info.get("model_version") != version:
        raise ValueError(
            f"Expected {model} / {version}, got {info.get('active_model')} / "
            f"{info.get('model_version')}. Check CANBORROW_MODEL_VERSION and the model name."
        )

    scores = {}
    for offset in range(0, len(records), BATCH_SIZE):
        batch = records[offset : offset + BATCH_SIZE]
        result = request_json(
            base_url, "/api/predict-batch", {"model_type": model, "records": batch}
        )
        if result.get("rejected_count") != 0:
            raise ValueError(
                f"Scorer rejected rows in batch {offset // BATCH_SIZE + 1}: {result.get('rejected')}"
            )
        if result.get("model_key") != model or result.get("model_version") != version:
            raise ValueError("Scorer model or version changed during export.")
        predictions = result.get("results")
        if not isinstance(predictions, list) or len(predictions) != len(batch):
            raise ValueError("Scorer did not return one prediction per submitted application.")

        expected_ids = {record["LoanID"] for record in batch}
        for prediction in predictions:
            loan_id = prediction.get("id")
            percent = prediction.get("default_prob")
            if loan_id not in expected_ids or loan_id in scores:
                raise ValueError(
                    f"Scorer returned an unexpected or duplicate application ID: {loan_id!r}."
                )
            if (
                type(percent) not in (int, float)
                or not math.isfinite(percent)
                or not 0 <= percent <= 100
            ):
                raise ValueError(f"Invalid default probability for {loan_id!r}: {percent!r}.")
            scores[loan_id] = round(percent / 100, 4)

    return scores


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="Path for the browser import JSON file.")
    parser.add_argument("--version", required=True, help="Exact version reported by the local scorer.")
    parser.add_argument("--base-url", type=local_url, default="http://127.0.0.1:5000")
    parser.add_argument("--model", choices=("lightgbm", "logistic_regression"), default="lightgbm")
    parser.add_argument("--rows", type=int, default=2_400)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    args = parser.parse_args(argv)

    if not 1 <= args.rows <= 5_000:
        parser.error("--rows must be between 1 and 5,000.")
    if not args.version.strip() or args.version == "latest":
        parser.error("--version must be an exact model version, e.g. 20260910T150046Z.")

    try:
        applications, scoring_records = generate_cohort(args.rows, args.seed)
        scores = score_cohort(args.base_url, args.model, args.version, scoring_records)
        for application in applications:
            application["referenceRisk"] = scores[application["id"]]
        content = {
            "schemaVersion": 1,
            "model": {"type": args.model, "version": args.version},
            "provenance": {
                "applications": "synthetic",
                "scores": "Can I borrow.ai /api/predict-batch",
                "seed": args.seed,
                "referenceTerms": REFERENCE_TERMS,
                "scoreInputSha256": hashlib.sha256(
                    json.dumps(scoring_records, sort_keys=True, separators=(",", ":")).encode("utf-8")
                ).hexdigest(),
            },
            "applications": applications,
        }
        args.output.write_text(json.dumps(content, separators=(",", ":")) + "\n", encoding="utf-8")
    except (OSError, ValueError, AttributeError, KeyError, TypeError) as exc:
        print(f"Export failed: {exc}", file=sys.stderr)
        return 1
    print(
        f"Exported {len(applications):,} synthetic applications scored by "
        f"{args.model} / {args.version}."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
