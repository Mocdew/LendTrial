# Export Can I borrow.ai scores for LimitRehearsal

LimitRehearsal works with synthetic data in the browser. This optional script generates fictional applications, calls your local [Can I borrow.ai scorer](https://github.com/Mocdew/Can-I-Borrow#http-api), and exports a JSON file you can load into the demo. It uses only the Python standard library.

1. In your Can I borrow.ai checkout, install its pinned dependencies and use your saved artifact. To rebuild, set `CANBORROW_DATA` to the original `Loan_default.csv` and run the scorer's [training command](https://github.com/Mocdew/Can-I-Borrow#train-and-promote-a-model-version). Its [model card](https://github.com/Mocdew/Can-I-Borrow/blob/main/MODEL_CARD.md) lists the original data checksum.
2. Set `CANBORROW_MODEL_VERSION` to the exact artifact directory name and start the scorer with `python run_app.py`. The example below uses the original model card's version. Use the new version if you retrained.

   ```sh
   CANBORROW_MODEL_VERSION=20260910T150046Z python run_app.py
   ```

3. From the LimitRehearsal repo, run the exporter. Replace the version with the one you are serving.

   ```sh
   python3 scripts/limit-rehearsal/export_scores.py /tmp/limit-rehearsal-scored.json \
     --version 20260910T150046Z
   ```

4. Load that JSON file into LimitRehearsal. Use `--rows`, `--seed`, `--model`, and `--base-url` to choose the cohort size, generator seed, model family, or loopback port.

The exporter checks `/api/contract`, checks the selected version with `/api/model-info`, and matches each `/api/predict-batch` score to its original application ID. It refuses partial results and version changes. The output includes the model name and version, the generator seed, the reference terms and a SHA-256 checksum of the scoring inputs.

The scorer sees every application at the same reference terms: 35,000 in its original input units, 8.5% interest and 36 months. Naira requests belong to the fictional policy scenario. Scores from the artifact are reference scores, and the rollout still simulates acceptance and first payments. The export includes synthetic identifiers and policy fields only.

## Verified export

The 2,400-application export was tested against the actual Flask API using LightGBM artifact `20261113T114637Z`. The artifact was retrained with the pinned dependencies from [Can I borrow.ai commit `45e9bfe`](https://github.com/Mocdew/Can-I-Borrow/tree/45e9bfe915229faa71d60bf974a03532aba1ed51). The [Kaggle source CSV](https://www.kaggle.com/datasets/nikhil1e9/loan-default) matches the original model card's SHA-256 (`1d7556a9071e7f9e872dc05a0cad174229fb1164b1cf3470ad35eed195c24278`). The training CSV and serialized model remain local to the scorer.
