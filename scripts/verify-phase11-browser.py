#!/usr/bin/env python3
"""Phase 11 production-browser acceptance for campus and national evidence controls."""

import json
import os
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("KF_BROWSER_BASE_URL", "http://127.0.0.1:3000")
EVIDENCE_DIR = Path(os.environ.get("KF_BROWSER_EVIDENCE_DIR", "/tmp/kampusforce-phase11"))
EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
REPORT = {
    "mode": "local_sandbox_production_browser",
    "boundary": "Synthetic control workflow only; no real campus outcome, provider outcome or national-launch certification.",
}


def login(page):
    page.goto(BASE_URL, wait_until="networkidle")
    page.get_by_role("button", name="Operations").click()
    page.wait_for_url(BASE_URL + "/ops", timeout=30_000)
    page.locator(".workspace-shell").wait_for()


def open_evidence(page):
    page.get_by_role("button", name="Rollout evidence").click()
    page.get_by_text("Real-world evidence register.", exact=False).wait_for(timeout=30_000)
    page.get_by_text("National launch", exact=True).wait_for()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    errors = []
    try:
        context = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(f"desktop pageerror: {error}"))
        login(page)
        open_evidence(page)
        label = f"Browser control cohort {int(time.time())}"
        page.get_by_label("Cohort label").fill(label)
        page.get_by_role("button", name="Create evidence cohort").click()
        page.get_by_text("Campus status was not changed.", exact=False).wait_for(timeout=30_000)
        cohort_row = page.locator("tr").filter(has_text=label)
        cohort_row.get_by_role("button", name="Snapshot").click()
        page.get_by_text("system snapshots recorded. They remain ineligible", exact=False).wait_for(timeout=30_000)
        assert cohort_row.get_by_text("external evidence required", exact=False).count() == 1

        evidence_ref = f"browser-control-evidence-{int(time.time())}"
        page.get_by_label("Observed value").fill("1")
        page.get_by_label("Controlled external evidence reference").fill(evidence_ref)
        page.get_by_label("Evidence scope and limitations").fill("Synthetic browser acceptance attestation for control testing only; not a real campus result.")
        page.get_by_label("I attest this references real-world evidence", exact=False).check()
        page.get_by_role("button", name="Submit for independent review").click()
        page.get_by_text("No campus or national launch state changed.", exact=False).wait_for(timeout=30_000)
        evidence_row = page.locator("tr").filter(has_text=evidence_ref)
        evidence_row.get_by_role("button", name="Review").click()
        page.get_by_label("External review reference").fill(f"browser-self-review-{int(time.time())}")
        page.get_by_label("Review rationale").fill("Attempted self-approval must be rejected by the independent rollout evidence policy.")
        page.get_by_label("I independently examined", exact=False).check()
        page.get_by_role("button", name="Approve evidence").click()
        page.get_by_text("Independent review is required; the evidence submitter cannot review their own rollout evidence", exact=True).wait_for(timeout=30_000)
        page.screenshot(path=str(EVIDENCE_DIR / "rollout-evidence-four-eyes.png"), full_page=True)
        REPORT["rolloutWorkflow"] = {
            "status": "passed",
            "cohortCreated": True,
            "systemSnapshotIneligible": True,
            "externalEvidenceSubmitted": True,
            "selfApprovalBlocked": True,
            "campusStatusChanged": False,
            "nationalLaunchCertified": False,
            "realCampusOutcome": False,
        }
        context.close()

        mobile = browser.new_context(viewport={"width": 375, "height": 812}, is_mobile=True)
        mobile_page = mobile.new_page()
        mobile_page.on("pageerror", lambda error: errors.append(f"mobile pageerror: {error}"))
        login(mobile_page)
        open_evidence(mobile_page)
        dimensions = mobile_page.evaluate("({viewport: window.innerWidth, document: document.documentElement.scrollWidth})")
        assert dimensions["document"] <= dimensions["viewport"] + 1, dimensions
        mobile_page.screenshot(path=str(EVIDENCE_DIR / "rollout-evidence-mobile-375.png"), full_page=True)
        REPORT["mobile"] = {"status": "passed", **dimensions}
        mobile_page.goto(BASE_URL + "/implementation", wait_until="networkidle")
        mobile_page.locator(".score-list").wait_for()
        assert mobile_page.locator(".score-list article").count() == 16
        assert mobile_page.locator(".overall-score strong").inner_text().replace("\n", "") == "91/100"
        score_dimensions = mobile_page.evaluate("({viewport: window.innerWidth, document: document.documentElement.scrollWidth})")
        assert score_dimensions["document"] <= score_dimensions["viewport"] + 1, score_dimensions
        REPORT["scorecard"] = {"status": "passed", "workstreams": 16, "overall": 91, **score_dimensions}
        mobile.close()
    finally:
        browser.close()

REPORT["browserRuntimeErrors"] = errors
REPORT["status"] = "passed" if not errors else "failed"
print(json.dumps(REPORT, indent=2))
assert not errors, errors
