#!/usr/bin/env python3
"""Transient, consented ATS document-intelligence adapter.

PaddleOCR and Docling representations are crossed-checked by a bounded VLM.
Source documents and extracted text are never printed or returned. Only the
versioned, bounded candidate-evidence contract reaches stdout. This worker does
not score candidates, make selection decisions, or persist any source content.
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
MAX_TEXT_CHARS = 60_000
MAX_VLM_RESPONSE_BYTES = 64 * 1024
ALLOWED_FIELDS = {
    "document_kind", "course_names", "institutions", "qualifications", "skills",
    "education_summary", "experience_summary", "language", "quality_flags",
}


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


def run_paddleocr(source: Path) -> tuple[str, float | None, str, list[str]]:
    from paddleocr import PaddleOCR  # type: ignore[import-not-found]

    engine = PaddleOCR(
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        device=os.environ.get("PADDLEOCR_DEVICE", "cpu"),
        enable_mkldnn=os.environ.get("PADDLEOCR_ENABLE_MKLDNN", "false").lower() == "true",
    )
    texts, scores = _walk_strings(engine.predict(str(source)))
    confidence = statistics.fmean(scores) if scores else None
    version = getattr(__import__("paddleocr"), "__version__", "configured-model")
    flags = [] if texts else ["no_text_detected"]
    return "\n".join(texts)[:MAX_TEXT_CHARS], confidence, str(version), flags


def run_docling(source: Path) -> tuple[str, int | None, str, list[str]]:
    from docling.document_converter import DocumentConverter  # type: ignore[import-not-found]

    converted = DocumentConverter().convert(str(source))
    markdown = converted.document.export_to_markdown()
    page_count = getattr(converted.document, "num_pages", None)
    if callable(page_count):
        page_count = page_count()
    version = getattr(__import__("docling"), "__version__", "configured-model")
    return markdown[:MAX_TEXT_CHARS], page_count if isinstance(page_count, int) else None, str(version), [] if markdown.strip() else ["empty_structure"]


def _bounded_string(value: Any, maximum: int) -> str:
    if not isinstance(value, str):
        raise RuntimeError("VLM text fields must be strings")
    return value.strip()[:maximum]


def _bounded_list(value: Any, maximum_items: int) -> list[str]:
    if not isinstance(value, list) or len(value) > maximum_items:
        raise RuntimeError("VLM list fields exceeded their bounded contract")
    return [_bounded_string(item, 120) for item in value if _bounded_string(item, 120)][:maximum_items]


def run_vlm(ocr_text: str, structured_text: str) -> tuple[dict[str, Any], str]:
    endpoint = os.environ.get("KF_VLM_ENDPOINT", "")
    model = os.environ.get("KF_VLM_MODEL", "")
    if not endpoint.startswith("https://") or not model:
        raise RuntimeError("An HTTPS VLM endpoint and pinned model are required")
    prompt = (
        "Extract bounded educational evidence from the two representations. Return only JSON with exactly: "
        "document_kind (cv, transcript, certificate, course_document, other), course_names (max 20 strings), "
        "institutions (max 10), qualifications (max 10), skills (max 30), education_summary (max 500 chars), "
        "experience_summary (max 500 chars), language (max 40), quality_flags (max 10). "
        "Do not return names, email addresses, phone numbers, identity numbers, street addresses, raw document text, "
        "scores, rankings, recommendations, or selection decisions. Use empty arrays/strings when evidence is absent.\n"
        f"OCR:\n{ocr_text}\nSTRUCTURED:\n{structured_text}"
    )
    body = json.dumps({
        "model": model,
        "temperature": 0,
        "max_tokens": 900,
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
    content = json.loads(payload)["choices"][0]["message"]["content"]
    findings = json.loads(content)
    if set(findings) != ALLOWED_FIELDS:
        raise RuntimeError("VLM returned fields outside the ATS evidence contract")
    if findings["document_kind"] not in {"cv", "transcript", "certificate", "course_document", "other"}:
        raise RuntimeError("VLM document kind is invalid")
    return {
        "document_kind": findings["document_kind"],
        "course_names": _bounded_list(findings["course_names"], 20),
        "institutions": _bounded_list(findings["institutions"], 10),
        "qualifications": _bounded_list(findings["qualifications"], 10),
        "skills": _bounded_list(findings["skills"], 30),
        "education_summary": _bounded_string(findings["education_summary"], 500),
        "experience_summary": _bounded_string(findings["experience_summary"], 500),
        "language": _bounded_string(findings["language"], 40),
        "quality_flags": _bounded_list(findings["quality_flags"], 10),
    }, model


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    args = parser.parse_args()
    source = Path(args.input).resolve()
    if not source.is_file() or source.stat().st_size < 1 or source.stat().st_size > MAX_INPUT_BYTES:
        raise RuntimeError("Input is missing or exceeds the document size limit")
    resource.setrlimit(resource.RLIMIT_CPU, (50, 55))
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    ocr_text, ocr_confidence, ocr_version, ocr_flags = run_paddleocr(source)
    structured_text, page_count, docling_version, structure_flags = run_docling(source)
    fields, vlm_model = run_vlm(ocr_text, structured_text)
    flags = sorted(set(ocr_flags + structure_flags + fields["quality_flags"] + ["human_review_required"]))
    confidence_bps = round(ocr_confidence * 10_000) if ocr_confidence is not None else None
    sys.stdout.write(json.dumps({
        "schema_version": "talent-document-v1",
        "source_sha256": digest,
        "processor_mode": "external",
        "providers": ["paddleocr", "docling", "vlm"],
        "provider_versions": {"paddleocr": ocr_version, "docling": docling_version, "vlm": vlm_model},
        "page_count": page_count,
        "confidence_bps": confidence_bps,
        "quality_flags": flags,
        "fields": fields,
        "automated_decision": False,
    }, separators=(",", ":")))


if __name__ == "__main__":
    main()
