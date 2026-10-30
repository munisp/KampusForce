#!/usr/bin/env python3
"""Transient, consented ATS document-intelligence adapter.

PaddleOCR and Docling representations are crossed-checked by a bounded VLM.
Source documents and extracted text are never printed or returned. Only the
versioned, bounded candidate-evidence contract reaches stdout. This worker does
not score candidates, make selection decisions, or persist any source content.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import multiprocessing
import os
import re
import resource
import statistics
import sys
import urllib.request
from pathlib import Path
from typing import Any

MAX_INPUT_BYTES = 10 * 1024 * 1024
MAX_TEXT_CHARS = 60_000
MAX_VLM_RESPONSE_BYTES = 64 * 1024
ATS_JSON_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "document_kind": {"type": "string", "enum": ["cv", "transcript", "certificate", "course_document", "other"]},
        "course_names": {"type": "array", "maxItems": 20, "items": {"type": "string", "maxLength": 120}},
        "institutions": {"type": "array", "maxItems": 10, "items": {"type": "string", "maxLength": 120}},
        "qualifications": {"type": "array", "maxItems": 10, "items": {"type": "string", "maxLength": 120}},
        "skills": {"type": "array", "maxItems": 30, "items": {"type": "string", "maxLength": 120}},
        "education_summary": {"type": "string", "maxLength": 500},
        "experience_summary": {"type": "string", "maxLength": 500},
        "language": {"type": "string", "maxLength": 40, "pattern": "^[a-z]{2,3}([_-][A-Za-z0-9]{2,8})*$"},
        "quality_flags": {
            "type": "array",
            "maxItems": 10,
            "items": {
                "type": "string",
                "enum": ["no_text_detected", "empty_structure", "low_quality_source", "illegible_text", "possible_truncation", "provider_disagreement"],
            },
        },
    },
    "required": [
        "document_kind", "course_names", "institutions", "qualifications", "skills",
        "education_summary", "experience_summary", "language", "quality_flags",
    ],
}
ALLOWED_FIELDS = set(ATS_JSON_SCHEMA["properties"])


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


def _document_provider_child(provider: str, source: str, connection: Any) -> None:
    """Run native document models in a disposable process; never print source text."""
    try:
        result = run_paddleocr(Path(source)) if provider == "paddleocr" else run_docling(Path(source))
        connection.send((True, result))
    except Exception as error:  # pragma: no cover - exact native failures are platform-specific
        connection.send((False, f"{type(error).__name__}: {error}"[:500]))
    finally:
        connection.close()


def run_document_provider_isolated(provider: str, source: Path) -> tuple[Any, ...]:
    """Release native OCR/layout allocations before the VLM is invoked."""
    if provider not in {"paddleocr", "docling"}:
        raise RuntimeError("Unknown isolated document provider")
    timeout = int(os.environ.get("KF_DOCUMENT_PROVIDER_TIMEOUT_SECONDS", "300"))
    if timeout < 1 or timeout > 600:
        raise RuntimeError("Document provider timeout must be between 1 and 600 seconds")
    context = multiprocessing.get_context("spawn")
    receiver, sender = context.Pipe(duplex=False)
    process = context.Process(target=_document_provider_child, args=(provider, str(source), sender))
    process.start()
    sender.close()
    try:
        process.join(timeout)
        if process.is_alive():
            process.terminate()
            process.join(5)
            if process.is_alive():
                process.kill()
                process.join()
            raise RuntimeError(f"Isolated {provider} exceeded its bounded execution time")
        if not receiver.poll():
            raise RuntimeError(f"Isolated {provider} exited without a result ({process.exitcode})")
        succeeded, payload = receiver.recv()
        if not succeeded:
            raise RuntimeError(f"Isolated {provider} failed: {payload}")
        if process.exitcode != 0:
            raise RuntimeError(f"Isolated {provider} exited with status {process.exitcode}")
        return payload
    finally:
        receiver.close()
        if process.is_alive():
            process.kill()
            process.join()


def _bounded_string(value: Any, maximum: int) -> str:
    if not isinstance(value, str):
        raise RuntimeError("VLM text fields must be strings")
    return value.strip()[:maximum]


def _bounded_list(value: Any, maximum_items: int) -> list[str]:
    if not isinstance(value, list) or len(value) > maximum_items:
        raise RuntimeError("VLM list fields exceeded their bounded contract")
    items = [_bounded_string(item, 120) for item in value if _bounded_string(item, 120)][:maximum_items]
    if len({item.casefold() for item in items}) != len(items):
        raise RuntimeError("VLM list fields must not contain duplicate evidence")
    return items


def run_vlm(
    ocr_text: str,
    structured_text: str,
    source: Path | None = None,
) -> tuple[dict[str, Any], str]:
    endpoint = os.environ.get("KF_VLM_ENDPOINT", "")
    model = os.environ.get("KF_VLM_MODEL", "")
    if not endpoint.startswith("https://") or not model:
        raise RuntimeError("An HTTPS VLM endpoint and pinned model are required")
    timeout = int(os.environ.get("KF_VLM_TIMEOUT_SECONDS", "30"))
    if timeout < 1 or timeout > 300:
        raise RuntimeError("VLM timeout must be between 1 and 300 seconds")
    prompt = (
        "Extract bounded educational evidence from the source image and two text representations. Return only minified JSON with exactly: "
        "document_kind (cv, transcript, certificate, course_document, other), course_names (max 20 strings), "
        "institutions (max 10), qualifications (max 10), skills (max 30), education_summary (max 500 chars), "
        "experience_summary (max 500 chars), language (BCP 47 code such as en), quality_flags (max 10). "
        "course_names contains only individual course/module names, never degrees. For a transcript, list its modules in course_names. "
        "Never put any value containing BSc, BA, MSc, MA, PhD, Diploma, or Certificate in course_names. Never put section labels, skills lines, or comma-separated lists in course_names. "
        "qualifications contains only complete degree, diploma, or certificate titles with a qualification designator such as BSc, BA, MSc, MA, PhD, Diploma, or Certificate; never list modules there. "
        "For example, BSc Geology is a qualification while Mineralogy is a course. Return one distinct item per array and never copy a value across course_names and qualifications. "
        "Do not put skills in course_names unless explicitly listed as courses. Ignore disclaimers and document metadata as educational or experience evidence. "
        "education_summary must concisely summarize the qualification and institution when present. "
        "experience_summary must be exactly \"\" when no employment or volunteer experience is explicitly present; do not write 'No experience' or describe the absence. "
        "Use quality_flags only for source or extraction problems, otherwise return []. "
        "Do not return names, email addresses, phone numbers, identity numbers, street addresses, raw document text, "
        "scores, rankings, recommendations, or selection decisions. Use empty arrays/strings when evidence is absent. "
        "Unrelated format example only; never copy its values: {\"document_kind\":\"transcript\",\"course_names\":[\"Archival Methods\"],"
        "\"institutions\":[\"Example College\"],\"qualifications\":[\"BA History\"],\"skills\":[\"cataloguing\"],"
        "\"education_summary\":\"BA History at Example College.\",\"experience_summary\":\"\",\"language\":\"en\",\"quality_flags\":[]}\n"
        f"OCR:\n{ocr_text}\nSTRUCTURED:\n{structured_text}"
    )
    content: str | list[dict[str, Any]] = prompt
    mime = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
    }.get(source.suffix.lower()) if source is not None else None
    if source is not None and mime is not None:
        encoded = base64.b64encode(source.read_bytes()).decode("ascii")
        content = [
            {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{encoded}"}},
            {"type": "text", "text": prompt},
        ]
    body = json.dumps({
        "model": model,
        "temperature": 0,
        "max_tokens": 900,
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "talent_document_evidence",
                "strict": True,
                "schema": ATS_JSON_SCHEMA,
            },
        },
        "messages": [{"role": "user", "content": content}],
    }).encode("utf-8")
    request = urllib.request.Request(endpoint, data=body, method="POST", headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {os.environ.get('KF_VLM_API_KEY', '')}",
    })
    with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 - HTTPS required above
        payload = response.read(MAX_VLM_RESPONSE_BYTES + 1)
    if len(payload) > MAX_VLM_RESPONSE_BYTES:
        raise RuntimeError("VLM response exceeded its bounded size")
    content = json.loads(payload)["choices"][0]["message"]["content"]
    findings = json.loads(content)
    if set(findings) != ALLOWED_FIELDS:
        raise RuntimeError("VLM returned fields outside the ATS evidence contract")
    if findings["document_kind"] not in {"cv", "transcript", "certificate", "course_document", "other"}:
        raise RuntimeError("VLM document kind is invalid")
    language = _bounded_string(findings["language"], 40)
    if not re.fullmatch(r"[a-z]{2,3}([_-][A-Za-z0-9]{2,8})*", language):
        raise RuntimeError("VLM language must be a bounded BCP 47 code")
    quality_flags = _bounded_list(findings["quality_flags"], 10)
    allowed_quality_flags = set(ATS_JSON_SCHEMA["properties"]["quality_flags"]["items"]["enum"])
    if any(flag not in allowed_quality_flags for flag in quality_flags):
        raise RuntimeError("VLM returned an unsupported quality flag")
    if "no_text_detected" in quality_flags and (ocr_text.strip() or structured_text.strip()):
        raise RuntimeError("VLM no-text flag conflicts with the provider representations")
    if "empty_structure" in quality_flags and structured_text.strip():
        raise RuntimeError("VLM empty-structure flag conflicts with Docling output")
    course_names = _bounded_list(findings["course_names"], 20)
    qualifications = _bounded_list(findings["qualifications"], 10)
    if {item.casefold() for item in course_names} & {item.casefold() for item in qualifications}:
        raise RuntimeError("VLM courses and qualifications must contain distinct evidence")
    experience_summary = _bounded_string(findings["experience_summary"], 500)
    if experience_summary.casefold() in {
        "no experience", "no experience.", "no employment or volunteer experience",
        "no employment or volunteer experience.", "none", "n/a", "not applicable",
    }:
        experience_summary = ""
    return {
        "document_kind": findings["document_kind"],
        "course_names": course_names,
        "institutions": _bounded_list(findings["institutions"], 10),
        "qualifications": qualifications,
        "skills": _bounded_list(findings["skills"], 30),
        "education_summary": _bounded_string(findings["education_summary"], 500),
        "experience_summary": experience_summary,
        "language": language,
        "quality_flags": quality_flags,
    }, model


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    args = parser.parse_args()
    source = Path(args.input).resolve()
    if not source.is_file() or source.stat().st_size < 1 or source.stat().st_size > MAX_INPUT_BYTES:
        raise RuntimeError("Input is missing or exceeds the document size limit")
    cpu_seconds = int(os.environ.get("KF_WORKER_CPU_SECONDS", "50"))
    if cpu_seconds < 1 or cpu_seconds > 600:
        raise RuntimeError("Worker CPU limit must be between 1 and 600 seconds")
    resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds + 5))
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    isolate = os.environ.get("KF_DOCUMENT_PROVIDER_ISOLATION", "false").lower() == "true"
    ocr_text, ocr_confidence, ocr_version, ocr_flags = (
        run_document_provider_isolated("paddleocr", source) if isolate else run_paddleocr(source)
    )
    structured_text, page_count, docling_version, structure_flags = (
        run_document_provider_isolated("docling", source) if isolate else run_docling(source)
    )
    fields, vlm_model = run_vlm(ocr_text, structured_text, source)
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
