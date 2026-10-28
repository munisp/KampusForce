#!/usr/bin/env python3
"""Transient identity-document adapter.

Input documents and extracted text never appear in stdout. The TypeScript caller
stores only the bounded evidence metadata returned here and deletes the input
workspace in a finally block. Production deployments must pre-cache and pin
models, apply malware/content disarm controls, and run this worker in a locked
container with no persistent volume.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import resource
import statistics
import sys
import urllib.request
from pathlib import Path
from typing import Any

MAX_INPUT_BYTES = 10 * 1024 * 1024
MAX_VLM_RESPONSE_BYTES = 64 * 1024


def _walk_strings(value: Any) -> tuple[list[str], list[float]]:
    texts: list[str] = []
    scores: list[float] = []
    if isinstance(value, dict):
        for key, item in value.items():
            if key in {"rec_texts", "texts"} and isinstance(item, list):
                texts.extend(str(entry) for entry in item if isinstance(entry, str))
            elif key in {"rec_scores", "scores"} and isinstance(item, list):
                scores.extend(float(entry) for entry in item if isinstance(entry, (int, float)))
            else:
                nested_texts, nested_scores = _walk_strings(item)
                texts.extend(nested_texts)
                scores.extend(nested_scores)
    elif isinstance(value, (list, tuple)):
        for item in value:
            nested_texts, nested_scores = _walk_strings(item)
            texts.extend(nested_texts)
            scores.extend(nested_scores)
    elif hasattr(value, "json"):
        return _walk_strings(value.json)
    elif hasattr(value, "__dict__"):
        return _walk_strings(vars(value))
    return texts, scores


def run_paddleocr(source: Path) -> tuple[str, list[str], float | None, str]:
    from paddleocr import PaddleOCR  # type: ignore[import-not-found]

    engine = PaddleOCR(
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
    )
    prediction = engine.predict(str(source))
    texts, scores = _walk_strings(prediction)
    confidence = statistics.fmean(scores) if scores else None
    version = getattr(__import__("paddleocr"), "__version__", "configured-model")
    return "\n".join(texts)[:60_000], texts, confidence, str(version)


def run_docling(source: Path) -> tuple[str, int | None, str]:
    from docling.document_converter import DocumentConverter  # type: ignore[import-not-found]

    converter = DocumentConverter()
    converted = converter.convert(str(source))
    markdown = converted.document.export_to_markdown()
    page_count = getattr(converted.document, "num_pages", None)
    if callable(page_count):
        page_count = page_count()
    version = getattr(__import__("docling"), "__version__", "configured-model")
    return markdown[:60_000], page_count if isinstance(page_count, int) else None, str(version)


def run_vlm(ocr_text: str, structured_text: str) -> tuple[dict[str, Any], str]:
    endpoint = os.environ.get("KF_VLM_ENDPOINT", "")
    model = os.environ.get("KF_VLM_MODEL", "")
    if not endpoint.startswith("https://") or not model:
        raise RuntimeError("An HTTPS VLM endpoint and pinned model are required")
    prompt = (
        "Cross-check the OCR and structured document representations. Return only JSON with "
        "cross_check_match (boolean), name_match (boolean or null), expiry_valid (boolean or null), "
        "registration_status (one of matched, mismatch, unavailable), and tamper_detected (boolean). "
        "Do not return names, identity numbers, dates, addresses, document text, or explanations.\n"
        f"OCR:\n{ocr_text}\nSTRUCTURED:\n{structured_text}"
    )
    body = json.dumps({
        "model": model,
        "temperature": 0,
        "max_tokens": 300,
        "response_format": {"type": "json_object"},
        "messages": [{"role": "user", "content": prompt}],
    }).encode("utf-8")
    request = urllib.request.Request(endpoint, data=body, method="POST", headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {os.environ.get('KF_VLM_API_KEY', '')}",
    })
    with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310 - HTTPS required above
        payload = response.read(MAX_VLM_RESPONSE_BYTES + 1)
    if len(payload) > MAX_VLM_RESPONSE_BYTES:
        raise RuntimeError("VLM response exceeded its bounded size")
    envelope = json.loads(payload)
    content = envelope["choices"][0]["message"]["content"]
    findings = json.loads(content)
    allowed = {"cross_check_match", "name_match", "expiry_valid", "registration_status", "tamper_detected"}
    if set(findings) != allowed:
        raise RuntimeError("VLM returned fields outside the identity evidence contract")
    if findings["registration_status"] not in {"matched", "mismatch", "unavailable"}:
        raise RuntimeError("VLM registry status is invalid")
    for key in allowed - {"registration_status"}:
        if findings[key] is not None and not isinstance(findings[key], bool):
            raise RuntimeError("VLM cross-check outcomes must be boolean or null")
    for key in {"cross_check_match", "tamper_detected"}:
        if not isinstance(findings[key], bool):
            raise RuntimeError(f"VLM {key} must be explicitly true or false")
    return findings, model


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    args = parser.parse_args()
    source = Path(args.input).resolve()
    if not source.is_file() or source.stat().st_size < 1 or source.stat().st_size > MAX_INPUT_BYTES:
        raise RuntimeError("Input is missing or exceeds the document size limit")
    resource.setrlimit(resource.RLIMIT_CPU, (50, 55))
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    ocr_text, texts, ocr_confidence, ocr_version = run_paddleocr(source)
    structured_text, page_count, docling_version = run_docling(source)
    vlm_findings, vlm_model = run_vlm(ocr_text, structured_text)
    extraction_confidence = round(ocr_confidence, 6) if ocr_confidence is not None else None
    results = [
        {
            "kind": "document_ocr", "provider": "paddleocr",
            "state": "passed" if texts and ocr_confidence is not None and ocr_confidence >= 0.75 else "review_required",
            "score": extraction_confidence, "threshold": 0.75, "modelVersion": ocr_version,
            "inputSha256": digest, "qualityFlags": [] if texts else ["no_text_detected"],
            "findings": {"page_count": page_count, "extraction_confidence": extraction_confidence},
        },
        {
            "kind": "document_structure", "provider": "docling",
            "state": "passed" if structured_text.strip() else "review_required",
            "score": None, "threshold": None, "modelVersion": docling_version,
            "inputSha256": digest, "qualityFlags": [] if structured_text.strip() else ["empty_structure"],
            "findings": {"page_count": page_count, "provider_outcome": "converted" if structured_text.strip() else "review"},
        },
        {
            "kind": "vlm_extraction", "provider": "vlm",
            "state": "review_required" if vlm_findings["tamper_detected"] else ("passed" if vlm_findings["cross_check_match"] else "failed"),
            "score": None, "threshold": None, "modelVersion": vlm_model,
            "inputSha256": digest, "qualityFlags": ["vlm_cross_check_only"],
            "findings": vlm_findings,
        },
    ]
    sys.stdout.write(json.dumps({"schema_version": "identity-document-v1", "results": results}, separators=(",", ":")))


if __name__ == "__main__":
    main()
