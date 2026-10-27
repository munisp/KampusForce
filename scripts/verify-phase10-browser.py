#!/usr/bin/env python3
"""Phase 10 production-browser acceptance for launch evidence controls."""

import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("KF_BROWSER_BASE_URL", "http://127.0.0.1:3000")
EVIDENCE_DIR = Path(os.environ.get("KF_BROWSER_EVIDENCE_DIR", "/tmp/kampusforce-phase10"))
EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
REPORT = {
    "mode": "local_sandbox_production_browser",
    "boundary": "Evidence workflow only; no live provider, legal, security, banking or production-launch certification.",
}


def login(page):
    page.goto(BASE_URL, wait_until="networkidle")
    page.get_by_role("button", name="Operations").click()
    page.wait_for_url(BASE_URL + "/ops", timeout=30_000)
    page.locator(".workspace-shell").wait_for()


def open_launch(page):
    page.get_by_role("button", name="Launch gates").click()
    page.get_by_text("productionReady: false.", exact=False).wait_for(timeout=30_000)
    page.get_by_text("Secret-free integration configuration", exact=True).wait_for()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    errors = []
    try:
        context = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(f"desktop pageerror: {error}"))
        login(page)
        open_launch(page)
        assert page.get_by_text("Paystack Transfers", exact=True).count() == 1
        assert page.get_by_text("Flutterwave Transfers", exact=True).count() == 1
        assert page.get_by_text("Not configured", exact=True).count() >= 1
        submit_buttons = page.get_by_role("button", name="Submit evidence")
        assert submit_buttons.count() > 0
        submit_buttons.first.click()
        evidence_ref = f"browser-launch-{int(time.time())}"
        page.get_by_label("Evidence reference").fill(evidence_ref)
        page.get_by_label("Review note").fill("Browser-submitted local evidence reference for independent review; no external certification implied.")
        page.get_by_role("button", name="Submit for independent review").click()
        page.get_by_text("Evidence reference submitted for independent review.", exact=True).wait_for(timeout=30_000)
        row = page.locator("tr").filter(has_text=evidence_ref)
        row.get_by_role("button", name="Review").click()
        page.get_by_label("External approval / rejection reference").fill(f"self-review-{int(time.time())}")
        page.get_by_label("Review note").fill("Attempted self-approval must be rejected by the independent four-eyes review policy.")
        page.get_by_role("button", name="Attest external approval").click()
        page.get_by_text("Independent review is required; the evidence submitter cannot decide their own launch gate", exact=True).wait_for(timeout=30_000)
        page.screenshot(path=str(EVIDENCE_DIR / "launch-four-eyes.png"), full_page=True)
        REPORT["launchWorkflow"] = {
            "status": "passed",
            "catalogVisible": True,
            "secretFreeConfigurationVisible": True,
            "productionReady": False,
            "evidenceSubmitted": True,
            "selfApprovalBlocked": True,
        }
        context.close()

        mobile = browser.new_context(viewport={"width": 375, "height": 812}, is_mobile=True)
        mobile_page = mobile.new_page()
        mobile_page.on("pageerror", lambda error: errors.append(f"mobile pageerror: {error}"))
        login(mobile_page)
        open_launch(mobile_page)
        dimensions = mobile_page.evaluate("({viewport: window.innerWidth, document: document.documentElement.scrollWidth})")
        assert dimensions["document"] <= dimensions["viewport"] + 1, dimensions
        mobile_page.screenshot(path=str(EVIDENCE_DIR / "launch-mobile-375.png"), full_page=True)
        REPORT["mobile"] = {"status": "passed", **dimensions}
        mobile.close()
    finally:
        browser.close()

request = urllib.request.Request(
    BASE_URL + "/api/integrations/providers/paystack/payout",
    data=b"{}",
    headers={"Content-Type": "application/json"},
    method="POST",
)
try:
    urllib.request.urlopen(request, timeout=10)
    raise AssertionError("Sandbox provider webhook route unexpectedly authorized")
except urllib.error.HTTPError as error:
    assert error.code == 403, error.code
    REPORT["providerWebhookGuard"] = {"status": "passed", "sandboxHttpStatus": 403, "liveRequestMade": False}

REPORT["browserRuntimeErrors"] = errors
REPORT["status"] = "passed" if not errors else "failed"
print(json.dumps(REPORT, indent=2))
assert not errors, errors
