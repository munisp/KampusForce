#!/usr/bin/env python3
"""Phase 15 production-browser acceptance for student and platform assurance.

All submissions use opaque synthetic references. No institution, identity,
biometric, payment, or other external provider is contacted.
"""
import json
import os
import time
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("KF_BROWSER_BASE_URL", "http://127.0.0.1:3000").rstrip("/")
EVIDENCE_DIR = Path(os.environ.get("KF_BROWSER_EVIDENCE_DIR", "/tmp/kampusforce-phase15"))
EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_HOSTS = {urlparse(BASE_URL).hostname, "127.0.0.1", "localhost", "::1"}
REPORT = {
    "mode": "local_sandbox_production_browser_acceptance",
    "externalProviderRequestMade": False,
    "liveInstitutionOrBiometricOutcomeVerified": False,
    "productionReady": False,
}
errors = []
external_requests = []
unique = str(int(time.time()))


def monitor(page, label):
    page.on("pageerror", lambda error: errors.append(f"{label} pageerror: {error}"))
    page.on("console", lambda message: errors.append(f"{label} console error: {message.text}") if message.type == "error" else None)
    page.on("response", lambda response: errors.append(f"{label} HTTP {response.status}: {response.url}") if response.status >= 400 else None)

    def check_request(request):
        hostname = urlparse(request.url).hostname
        if hostname and hostname not in ALLOWED_HOSTS:
            external_requests.append(f"{label}: {request.method} {hostname}")

    page.on("request", check_request)


def login(page, workspace, href, ready_text):
    page.goto(BASE_URL, wait_until="networkidle")
    page.get_by_role("button", name=workspace, exact=False).click()
    page.locator(".workspace-shell").wait_for(timeout=30_000)
    page.locator(f'a[href="{href}"]:visible').first.click()
    page.get_by_text(ready_text, exact=False).wait_for(timeout=30_000)


def open_assurance(page, section=None):
    page.get_by_role("button", name="Assurance", exact=True).click()
    page.get_by_text("Assurance signals require human review.", exact=False).wait_for(timeout=30_000)
    if section:
        page.get_by_role("button", name=section, exact=False).click()


def dimensions(page):
    result = page.evaluate("({viewport: window.innerWidth, document: document.documentElement.scrollWidth})")
    assert result["document"] <= result["viewport"] + 1, result
    return result


def screenshot(page, name):
    page.screenshot(path=str(EVIDENCE_DIR / name), full_page=True)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    try:
        rep_context = browser.new_context(viewport={"width": 1440, "height": 1000})
        rep = rep_context.new_page()
        monitor(rep, "representative-desktop")
        login(rep, "Team rep", "/identity", "Event-driven stakeholder verification")
        term = f"browser-{unique}"[:40]
        rep.get_by_label("Academic term", exact=True).fill(term)
        rep.get_by_label("Provider attestation reference", exact=False).fill(f"opaque-browser-enrollment-{unique}")
        rep.get_by_role("button", name="Submit for independent review", exact=True).click()
        rep.locator(".success-message").get_by_text("submitted for independent enrollment review", exact=False).wait_for(timeout=30_000)
        rep.get_by_text(term, exact=True).first.wait_for(timeout=30_000)
        screenshot(rep, "representative-enrollment-submitted-desktop.png")
        REPORT["representativeSubmission"] = {"status": "passed", "opaqueReferenceAccepted": True, "independentReviewRequested": True}

        ops_context = browser.new_context(viewport={"width": 1440, "height": 1000})
        ops = ops_context.new_page()
        monitor(ops, "operations-desktop")
        login(ops, "Operations", "/ops", "Move every deal deliberately")
        open_assurance(ops)
        enrollment_row = ops.locator("tbody tr").filter(has_text=term).first
        enrollment_row.wait_for(timeout=30_000)
        enrollment_row.get_by_role("button", name="Verify", exact=True).click()
        ops.locator(".success-message").get_by_text("changed to verified", exact=False).wait_for(timeout=30_000)
        enrollment_row.get_by_text("verified", exact=True).wait_for(timeout=30_000)
        screenshot(ops, "operations-enrollment-verified-desktop.png")
        REPORT["operationsEnrollmentReview"] = {"status": "passed", "independentVerification": True}

        rep.reload(wait_until="networkidle")
        rep.get_by_text("Current", exact=True).first.wait_for(timeout=30_000)
        rep.get_by_text(term, exact=True).first.wait_for(timeout=30_000)
        REPORT["representativeSubmission"]["currentAfterIndependentReview"] = True

        open_assurance(ops, "Uniqueness")
        subject_token = f"opaque-browser-shared-subject-{unique}"
        rep_select = ops.get_by_label("Representative", exact=False)
        token_input = ops.get_by_label("Stable provider-subject token", exact=False)
        rep_select.select_option(index=1)
        token_input.fill(subject_token)
        ops.get_by_role("button", name="Tokenize & check collision", exact=True).click()
        ops.locator(".success-message").get_by_text("without a collision", exact=False).wait_for(timeout=30_000)
        rep_select.select_option(index=2)
        token_input.fill(subject_token)
        ops.get_by_role("button", name="Tokenize & check collision", exact=True).click()
        ops.locator(".success-message").get_by_text("opened for collision review", exact=False).wait_for(timeout=30_000)
        collision_row = ops.locator("tbody tr").first
        collision_row.get_by_role("button", name="Clear & release", exact=True).click()
        ops.locator(".success-message").get_by_text("linked hold history was preserved", exact=False).wait_for(timeout=30_000)
        collision_row.get_by_text("cleared", exact=True).wait_for(timeout=30_000)
        screenshot(ops, "operations-uniqueness-desktop.png")
        REPORT["uniqueness"] = {"status": "passed", "collisionOpened": True, "clearReleasedLinkedHolds": True, "matchedPersonShownToRepresentative": False}

        open_assurance(ops, "Activation quality")
        ops.get_by_label("Opaque evidence reference", exact=True).fill(f"opaque-browser-quality-{unique}")
        ops.get_by_role("button", name="Open quality review", exact=True).click()
        ops.locator(".success-message").get_by_text("opened", exact=False).wait_for(timeout=30_000)
        screenshot(ops, "operations-activation-quality-desktop.png")
        REPORT["activationQuality"] = {"status": "passed", "warningReviewOpened": True}

        open_assurance(ops, "Vendor assurance")
        ops.locator("label").filter(has_text="Vendor").locator("select").select_option(index=1)
        ops.get_by_label("Opaque sample evidence reference", exact=False).fill(f"opaque-browser-vendor-{unique}")
        ops.get_by_role("button", name="Record reconciliation outcome", exact=True).click()
        ops.locator(".success-message").get_by_text("passed", exact=False).wait_for(timeout=30_000)
        screenshot(ops, "operations-vendor-assurance-desktop.png")
        REPORT["vendorAssurance"] = {"status": "passed", "passingSampleRecorded": True, "automaticReactivationClaimed": False}

        open_assurance(ops, "Biometric evaluation")
        ops.get_by_label("Opaque evaluation evidence reference", exact=False).fill(f"opaque-browser-biometric-{unique}")
        ops.get_by_role("button", name="Record evaluation", exact=True).click()
        ops.locator(".success-message").get_by_text("certification is not implied", exact=False).wait_for(timeout=30_000)
        desktop_dimensions = dimensions(ops)
        screenshot(ops, "operations-biometric-evaluation-desktop.png")
        REPORT["biometricEvaluation"] = {"status": "passed", "sandboxEvidenceRecorded": True, "certificationImplied": False, "dimensions": desktop_dimensions}
        ops_context.close()
        rep_context.close()

        finance_context = browser.new_context(viewport={"width": 1440, "height": 1000})
        finance = finance_context.new_page()
        monitor(finance, "finance-desktop")
        login(finance, "Finance", "/ops", "Move every deal deliberately")
        open_assurance(finance)
        finance.get_by_text("Read-only Finance oversight.", exact=False).wait_for(timeout=30_000)
        assert finance.get_by_role("button", name="Verify", exact=True).count() == 0
        assert finance.get_by_label("Independent decision rationale", exact=True).count() == 0
        finance_dimensions = dimensions(finance)
        screenshot(finance, "finance-assurance-read-only-desktop.png")
        REPORT["finance"] = {"status": "passed", "readOnly": True, "dimensions": finance_dimensions}
        finance_context.close()

        mobile_rep_context = browser.new_context(viewport={"width": 375, "height": 812}, is_mobile=True)
        mobile_rep = mobile_rep_context.new_page()
        monitor(mobile_rep, "representative-mobile")
        login(mobile_rep, "Team rep", "/identity", "Event-driven stakeholder verification")
        mobile_rep.get_by_text("Identity approval is not proof of current enrollment.", exact=False).wait_for(timeout=30_000)
        mobile_rep_dimensions = dimensions(mobile_rep)
        screenshot(mobile_rep, "representative-enrollment-mobile-375.png")
        REPORT["representativeMobile"] = {"status": "passed", "dimensions": mobile_rep_dimensions}
        mobile_rep_context.close()

        mobile_ops_context = browser.new_context(viewport={"width": 375, "height": 812}, is_mobile=True)
        mobile_ops = mobile_ops_context.new_page()
        monitor(mobile_ops, "operations-mobile")
        login(mobile_ops, "Operations", "/ops", "Move every deal deliberately")
        open_assurance(mobile_ops, "Biometric evaluation")
        mobile_ops_dimensions = dimensions(mobile_ops)
        screenshot(mobile_ops, "operations-assurance-mobile-375.png")
        REPORT["operationsMobile"] = {"status": "passed", "dimensions": mobile_ops_dimensions}
        mobile_ops_context.close()
    finally:
        browser.close()

REPORT["browserRuntimeErrors"] = errors
REPORT["externalRequests"] = external_requests
REPORT["status"] = "passed" if not errors and not external_requests else "failed"
print(json.dumps(REPORT, indent=2))
assert not errors, errors
assert not external_requests, external_requests
