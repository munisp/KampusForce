from __future__ import annotations

import base64
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
        with self.assertRaisesRegex(RuntimeError, "duplicate evidence"):
            worker._bounded_list(["Repeated", "repeated"], 3)

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
        body = json.loads(outbound.data)
        self.assertEqual(body["response_format"]["type"], "json_schema")
        self.assertTrue(body["response_format"]["json_schema"]["strict"])
        self.assertEqual(body["response_format"]["json_schema"]["schema"], worker.ATS_JSON_SCHEMA)
        self.assertEqual(set(worker.ATS_JSON_SCHEMA["required"]), worker.ALLOWED_FIELDS)
        self.assertFalse(worker.ATS_JSON_SCHEMA["additionalProperties"])

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
        invalid_language = {**VALID_FIELDS, "language": "Synthetic University"}
        with mock.patch.object(worker.urllib.request, "urlopen", return_value=_Response(_vlm_payload(invalid_language))):
            with self.assertRaisesRegex(RuntimeError, "BCP 47"):
                worker.run_vlm("ocr", "structured")
        invalid_flag = {**VALID_FIELDS, "quality_flags": ["Synthetic University"]}
        with mock.patch.object(worker.urllib.request, "urlopen", return_value=_Response(_vlm_payload(invalid_flag))):
            with self.assertRaisesRegex(RuntimeError, "unsupported quality flag"):
                worker.run_vlm("ocr", "structured")
        inconsistent_flag = {**VALID_FIELDS, "quality_flags": ["no_text_detected"]}
        with mock.patch.object(worker.urllib.request, "urlopen", return_value=_Response(_vlm_payload(inconsistent_flag))):
            with self.assertRaisesRegex(RuntimeError, "conflicts with the provider representations"):
                worker.run_vlm("actual OCR text", "actual Docling structure")

    @mock.patch.dict(worker.os.environ, {"KF_VLM_ENDPOINT": "https://vlm.invalid/chat", "KF_VLM_MODEL": "pinned-vlm"}, clear=False)
    def test_vlm_normalizes_only_absence_only_experience_summaries(self):
        for phrase in ("No experience.", "No employment or volunteer experience", "N/A"):
            with self.subTest(phrase=phrase), mock.patch.object(
                worker.urllib.request,
                "urlopen",
                return_value=_Response(_vlm_payload({**VALID_FIELDS, "experience_summary": phrase})),
            ):
                fields, _ = worker.run_vlm("ocr", "structured")
                self.assertEqual(fields["experience_summary"], "")
        with mock.patch.object(
            worker.urllib.request,
            "urlopen",
            return_value=_Response(_vlm_payload({**VALID_FIELDS, "experience_summary": "Volunteer geology tutor."})),
        ):
            fields, _ = worker.run_vlm("ocr", "structured")
            self.assertEqual(fields["experience_summary"], "Volunteer geology tutor.")

    @mock.patch.dict(worker.os.environ, {"KF_VLM_ENDPOINT": "https://vlm.invalid/chat", "KF_VLM_MODEL": "pinned-vlm"}, clear=False)
    def test_vlm_rejects_course_qualification_duplication(self):
        duplicated = {**VALID_FIELDS, "qualifications": ["applied mathematics"]}
        with mock.patch.object(worker.urllib.request, "urlopen", return_value=_Response(_vlm_payload(duplicated))):
            with self.assertRaisesRegex(RuntimeError, "distinct evidence"):
                worker.run_vlm("ocr", "structured")

    @mock.patch.dict(worker.os.environ, {"KF_VLM_ENDPOINT": "https://vlm.invalid/chat", "KF_VLM_MODEL": "pinned-vlm"}, clear=False)
    def test_vlm_rejects_oversized_provider_response(self):
        with mock.patch.object(worker.urllib.request, "urlopen", return_value=_Response(b"x" * (worker.MAX_VLM_RESPONSE_BYTES + 1))):
            with self.assertRaisesRegex(RuntimeError, "bounded size"):
                worker.run_vlm("ocr", "structured")

    @mock.patch.dict(worker.os.environ, {"KF_VLM_ENDPOINT": "https://vlm.invalid/chat", "KF_VLM_MODEL": "pinned-vlm", "KF_VLM_TIMEOUT_SECONDS": "120"}, clear=False)
    def test_vlm_forwards_source_image_and_configured_timeout(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "synthetic.png"
            source.write_bytes(b"synthetic-image-bytes")
            with mock.patch.object(worker.urllib.request, "urlopen", return_value=_Response(_vlm_payload(VALID_FIELDS))) as request:
                worker.run_vlm("transient OCR", "transient structure", source)
        outbound = request.call_args.args[0]
        body = json.loads(outbound.data)
        content = body["messages"][0]["content"]
        self.assertEqual(content[0]["type"], "image_url")
        encoded = content[0]["image_url"]["url"].split(",", 1)[1]
        self.assertEqual(base64.b64decode(encoded), b"synthetic-image-bytes")
        self.assertEqual(request.call_args.kwargs["timeout"], 120)

    @mock.patch.dict(worker.os.environ, {"KF_VLM_ENDPOINT": "https://vlm.invalid/chat", "KF_VLM_MODEL": "pinned-vlm"}, clear=False)
    def test_vlm_rejects_unbounded_timeout(self):
        for value in ("0", "301", "not-a-number"):
            with self.subTest(value=value), mock.patch.dict(worker.os.environ, {"KF_VLM_TIMEOUT_SECONDS": value}):
                with self.assertRaises((RuntimeError, ValueError)):
                    worker.run_vlm("ocr", "structured")

    def test_main_can_isolate_native_document_providers(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "synthetic.txt"
            source.write_text("synthetic")
            output = io.StringIO()
            with (
                mock.patch.dict(worker.os.environ, {"KF_DOCUMENT_PROVIDER_ISOLATION": "true"}),
                mock.patch.object(worker.sys, "argv", ["worker", "--input", str(source)]),
                mock.patch.object(worker.resource, "setrlimit"),
                mock.patch.object(
                    worker,
                    "run_document_provider_isolated",
                    side_effect=[("transient ocr", 0.99, "paddle-test", []), ("transient structure", 1, "docling-test", [])],
                ) as isolated,
                mock.patch.object(worker, "run_vlm", return_value=(VALID_FIELDS, "vlm-test")),
                contextlib.redirect_stdout(output),
            ):
                worker.main()
        self.assertEqual([call.args[0] for call in isolated.call_args_list], ["paddleocr", "docling"])
        self.assertEqual(json.loads(output.getvalue())["providers"], ["paddleocr", "docling", "vlm"])
        with mock.patch.dict(worker.os.environ, {"KF_DOCUMENT_PROVIDER_TIMEOUT_SECONDS": "601"}):
            with self.assertRaisesRegex(RuntimeError, "between 1 and 600"):
                worker.run_document_provider_isolated("paddleocr", source)

    def test_main_rejects_unbounded_cpu_limit(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "synthetic.txt"
            source.write_text("synthetic")
            for value in ("0", "601", "not-a-number"):
                with self.subTest(value=value), mock.patch.dict(worker.os.environ, {"KF_WORKER_CPU_SECONDS": value}), mock.patch.object(worker.sys, "argv", ["worker", "--input", str(source)]):
                    with self.assertRaises((RuntimeError, ValueError)):
                        worker.main()

    def test_main_outputs_only_bounded_evidence_and_source_hash(self):
        source_text = "raw source must never reach stdout"
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "synthetic.txt"
            source.write_text(source_text)
            output = io.StringIO()
            with (
                mock.patch.object(worker.sys, "argv", ["worker", "--input", str(source)]),
                mock.patch.dict(worker.os.environ, {"KF_WORKER_CPU_SECONDS": "300"}),
                mock.patch.object(worker.resource, "setrlimit") as setrlimit,
                mock.patch.object(worker, "run_paddleocr", return_value=("transient ocr", 0.99, "paddle-test", [])),
                mock.patch.object(worker, "run_docling", return_value=("transient structure", 1, "docling-test", [])),
                mock.patch.object(worker, "run_vlm", return_value=(VALID_FIELDS, "vlm-test")) as vlm,
                contextlib.redirect_stdout(output),
            ):
                worker.main()
        payload = output.getvalue()
        self.assertNotIn(source_text, payload)
        self.assertNotIn("transient ocr", payload)
        self.assertNotIn("transient structure", payload)
        result = json.loads(payload)
        self.assertEqual(result["source_sha256"], hashlib.sha256(source_text.encode()).hexdigest())
        setrlimit.assert_called_once_with(worker.resource.RLIMIT_CPU, (300, 305))
        self.assertEqual(result["providers"], ["paddleocr", "docling", "vlm"])
        self.assertEqual(vlm.call_args.args[2], source)
        self.assertEqual(result["confidence_bps"], 9900)
        self.assertFalse(result["automated_decision"])
        self.assertIn("human_review_required", result["quality_flags"])


if __name__ == "__main__":
    unittest.main()
