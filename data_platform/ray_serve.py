"""Optional Ray Serve entrypoint for an explicitly managed private cluster."""
from __future__ import annotations

import hmac
import json
import math
import os
from pathlib import Path

import numpy as np
from ray import serve
from starlette.requests import Request
from starlette.responses import JSONResponse

FEATURES = [
    "previous_activations",
    "previous_amount_kobo",
    "previous_confirmed",
    "previous_confirmation_rate",
    "rolling_activations",
    "active_history_days",
    "days_since_previous",
]


class OpportunityScoringService:
    def __init__(self, model_path: str):
        self.model = json.loads(Path(model_path).read_text())
        if self.model.get("features") != FEATURES:
            raise RuntimeError("Model feature contract does not match the serving contract")
        if self.model.get("training_mode") != "temporal_history_only_logistic_regression":
            raise RuntimeError("Only a leakage-safe temporal model contract may be served")
        if self.model.get("model_approved") is not True:
            raise RuntimeError("Model approval is required before Ray Serve deployment")
        for field in ("coefficients", "means", "scales"):
            values = self.model.get(field)
            if not isinstance(values, list) or len(values) != len(FEATURES):
                raise RuntimeError(f"Model {field} must contain exactly {len(FEATURES)} values")
            if any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)) for value in values):
                raise RuntimeError(f"Model {field} contains a non-finite or non-numeric value")
        if any(float(value) <= 0 for value in self.model["scales"]):
            raise RuntimeError("Model scales must be strictly positive")
        if isinstance(self.model.get("intercept"), bool) or not isinstance(self.model.get("intercept"), (int, float)) or not math.isfinite(float(self.model["intercept"])):
            raise RuntimeError("Model intercept must be finite")
        if not isinstance(self.model.get("model_version"), str) or not 8 <= len(self.model["model_version"]) <= 100:
            raise RuntimeError("Model version is missing or unbounded")

    def _score(self, rows: list[dict]) -> list[dict]:
        if not isinstance(rows, list) or not rows or len(rows) > 256:
            raise ValueError("Provide between 1 and 256 rows")
        prohibited = {"phone", "nin", "bvn", "bank_account", "name", "email", "customer_token", "rep_token"}
        matrix = []
        for row in rows:
            if not isinstance(row, dict) or set(row) != set(FEATURES) or prohibited & set(row):
                raise ValueError("Serving accepts exactly the bounded numeric history features; identifiers and unexpected fields are prohibited")
            values = []
            for name in FEATURES:
                supplied = row[name]
                if isinstance(supplied, bool) or not isinstance(supplied, (int, float)):
                    raise ValueError(f"{name} must be a finite non-negative number")
                value = float(supplied)
                if not math.isfinite(value) or value < 0:
                    raise ValueError(f"{name} must be a finite non-negative number")
                if name == "previous_confirmation_rate" and value > 1:
                    raise ValueError("previous_confirmation_rate must be between zero and one")
                if value > 1e15:
                    raise ValueError(f"{name} exceeds the serving bound")
                values.append(value)
            matrix.append(values)
        values = (np.asarray(matrix) - np.asarray(self.model["means"])) / np.asarray(self.model["scales"])
        logits = values @ np.asarray(self.model["coefficients"]) + float(self.model["intercept"])
        probabilities = 1 / (1 + np.exp(-np.clip(logits, -30, 30)))
        return [{"opportunity_score": round(float(score), 6), "model_version": self.model["model_version"]} for score in probabilities]

    async def __call__(self, request: Request) -> JSONResponse:
        if request.url.path == "/health":
            return JSONResponse({"status": "ok", "model_version": self.model["model_version"], "boundary": "approved_temporal_scoring_only"})
        expected = os.environ.get("KF_RAY_SERVE_API_KEY", "")
        if len(expected) < 32:
            return JSONResponse({"error": "Serving authentication is not configured"}, status_code=503)
        provided = request.headers.get("x-kampusforce-key", "")
        if not hmac.compare_digest(provided, expected):
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        content_length = request.headers.get("content-length")
        if content_length and (not content_length.isdigit() or int(content_length) > 262_144):
            return JSONResponse({"error": "Request body exceeds the 256 KiB limit"}, status_code=413)
        try:
            body = await request.json()
            if not isinstance(body, dict):
                raise ValueError("A JSON object with rows is required")
            return JSONResponse({"scores": self._score(body.get("rows", [])), "automatedDecision": False})
        except (ValueError, KeyError, TypeError) as error:
            return JSONResponse({"error": str(error)}, status_code=400)


deployment = serve.deployment(
    autoscaling_config={"min_replicas": 1, "max_replicas": 4, "target_ongoing_requests": 16},
    max_ongoing_requests=32,
    max_queued_requests=128,
    health_check_period_s=10,
    health_check_timeout_s=5,
)(OpportunityScoringService)
app = deployment.bind(model_path=os.environ.get("KF_RAY_MODEL_PATH", "/models/kampusforce/model.json"))
