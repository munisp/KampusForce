from __future__ import annotations

import contextlib
import hashlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import talent_document_worker as worker


VALID_FIELDS = {
    "document_kind": "transcript",
    "course_names": ["Applied Mathematics"],
    "institutions": ["Synthetic University"],
    "qualifications": ["BSc"],
    "skills": ["Data analysis"],
    "education_summary": "Synthetic educational evidence.",
    "experience_summary": "",
    "language": "en",
    "quality_flags": [],
}


class _Response:
    def __init__(self, payload: bytes):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, _maximum: int) -> bytes:
        return self.payload


def _vlm_payload(fields: dict) -> bytes:
    return json.dumps({"choices": [{"message": {"content": json.dumps(fields)}}]}).encode()


class TalentDocumentWorkerTests(unittest.TestCase):
    def test_walk_strings_only_accepts_ocr_text_and_score_keys(self):
        texts, scores = worker._walk_strings({
            "rec_texts": ["Geology", 42],
            "rec_scores": [0.98, "invalid"],
            "unrelated": "must not be extracted",
            "nested": {"texts": ["Mathematics"], "scores": [0.95]},
        })
        self.assertEqual(texts, ["Geology", "Mathematics"])
        self.assertEqual(scores, [0.98, 0.95])

    def test_bounded_list_rejects_non_strings_and_oversized_collections(self):
        with self.assertRaisesRegex(RuntimeError, "strings"):
            worker._bounded_list(["valid", 7], 3)
        with self.assertRaisesRegex(RuntimeError, "bounded contract"):
            worker._bounded_list(["one", "two"], 1)

    def test_vlm_requires_https_endpoint_and_pinned_model(self):
        with mock.patch.dict(worker.os.environ, {"KF_VLM_ENDPOINT": "http://unsafe.invalid", "KF_VLM_MODEL": "pinned"}, clear=False):
            with self.assertRaisesRegex(RuntimeError, "HTTPS VLM endpoint"):
                worker.run_vlm("ocr", "structured")
        with mock.patch.dict(worker.os.environ, {"KF_VLM_ENDPOINT": "https://vlm.invalid", "KF_VLM_MODEL": ""}, clear=False):
            with self.assertRaisesRegex(RuntimeError, "HTTPS VLM endpoint"):
                worker.run_vlm("ocr", "structured")

    @mock.patch.dict(worker.os.environ, {"KF_VLM_ENDPOINT": "https://vlm.invalid/chat", "KF_VLM_MODEL": "pinned-vlm", "KF_VLM_API_KEY": "test-only"}, clear=False)
    def test_vlm_enforces_exact_bounded_contract(self):
        with mock.patch.object(worker.urllib.request, "urlopen", return_value=_Response(_vlm_payload(VALID_FIELDS))) as request:
            fields, model = worker.run_vlm("transient OCR", "transient structure")
        self.assertEqual(model, "pinned-vlm")
        self.assertEqual(fields["course_names"], ["Applied Mathematics"])
        self.assertEqual(set(fields), worker.ALLOWED_FIELDS)
        outbound = request.call_args.args[0]
        self.assertEqual(outbound.get_method(), "POST")
        self.assertEqual(outbound.headers["Authorization"], "Bearer test-only")

    @mock.patch.dict(worker.os.environ, {"KF_VLM_ENDPOINT": "https://vlm.invalid/chat", "KF_VLM_MODEL": "pinned-vlm"}, clear=False)
    def test_vlm_rejects_extra_fields_and_invalid_document_kind(self):
        extra = {**VALID_FIELDS, "candidate_score": 99}
        with mock.patch.object(worker.urllib.request, "urlopen", return_value=_Response(_vlm_payload(extra))):
            with self.assertRaisesRegex(RuntimeError, "outside the ATS evidence contract"):
                worker.run_vlm("ocr", "structured")
        invalid = {**VALID_FIELDS, "document_kind": "identity_document"}
        with mock.patch.object(worker.urllib.request, "urlopen", return_value=_Response(_vlm_payload(invalid))):
            with self.assertRaisesRegex(RuntimeError, "document kind is invalid"):
                worker.run_vlm("ocr", "structured")

    @mock.patch.dict(worker.os.environ, {"KF_VLM_ENDPOINT": "https://vlm.invalid/chat", "KF_VLM_MODEL": "pinned-vlm"}, clear=False)
    def test_vlm_rejects_oversized_provider_response(self):
        with mock.patch.object(worker.urllib.request, "urlopen", return_value=_Response(b"x" * (worker.MAX_VLM_RESPONSE_BYTES + 1))):
            with self.assertRaisesRegex(RuntimeError, "bounded size"):
                worker.run_vlm("ocr", "structured")

    def test_main_outputs_only_bounded_evidence_and_source_hash(self):
        source_text = "raw source must never reach stdout"
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "synthetic.txt"
            source.write_text(source_text)
            output = io.StringIO()
            with (
                mock.patch.object(worker.sys, "argv", ["worker", "--input", str(source)]),
                mock.patch.object(worker.resource, "setrlimit"),
                mock.patch.object(worker, "run_paddleocr", return_value=("transient ocr", 0.99, "paddle-test", [])),
                mock.patch.object(worker, "run_docling", return_value=("transient structure", 1, "docling-test", [])),
                mock.patch.object(worker, "run_vlm", return_value=(VALID_FIELDS, "vlm-test")),
                contextlib.redirect_stdout(output),
            ):
                worker.main()
        payload = output.getvalue()
        self.assertNotIn(source_text, payload)
        self.assertNotIn("transient ocr", payload)
        self.assertNotIn("transient structure", payload)
        result = json.loads(payload)
        self.assertEqual(result["source_sha256"], hashlib.sha256(source_text.encode()).hexdigest())
        self.assertEqual(result["providers"], ["paddleocr", "docling", "vlm"])
        self.assertEqual(result["confidence_bps"], 9900)
        self.assertFalse(result["automated_decision"])
        self.assertIn("human_review_required", result["quality_flags"])


if __name__ == "__main__":
    unittest.main()
