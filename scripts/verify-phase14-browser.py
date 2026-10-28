#!/usr/bin/env python3
"""Phase 14 production-browser acceptance for stakeholder identity workflows.

Run the Phase 14 database journey first so a separate synthetic applicant is
waiting in manual review. No external identity provider is contacted.
"""
import json
import os
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("KF_BROWSER_BASE_URL", "http://127.0.0.1:3000").rstrip("/")
EVIDENCE_DIR = Path(os.environ.get("KF_BROWSER_EVIDENCE_DIR", "/tmp/kampusforce-phase14"))
EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_HOSTS = {urlparse(BASE_URL).hostname, "127.0.0.1", "localhost", "::1"}
REPORT = {
    "mode": "local_sandbox_production_browser_acceptance",
    "externalProviderRequestMade": False,
    "liveProviderVerified": False,
    "productionReady": False,
}
errors = []
external_requests = []


def monitor(page, label):
    page.on("pageerror", lambda error: errors.append(f"{label} pageerror: {error}"))
    page.on("console", lambda message: errors.append(f"{label} console error: {message.text}") if message.type == "error" else None)
    page.on("response", lambda response: errors.append(f"{label} HTTP {response.status}: {response.url}") if response.status >= 400 else None)

    def check_request(request):
        hostname = urlparse(request.url).hostname
        if hostname and hostname not in ALLOWED_HOSTS:
            external_requests.append(f"{label}: {request.method} {hostname}")

    page.on("request", check_request)


def login_identity(page, workspace):
    page.goto(BASE_URL, wait_until="networkidle")
    page.get_by_role("button", name=workspace, exact=False).click()
    page.locator(".workspace-shell").wait_for(timeout=30_000)
    page.locator('a[href="/identity"]:visible').first.click()
    page.get_by_text("Event-driven stakeholder verification", exact=False).wait_for(timeout=30_000)
    page.get_by_text("Production readiness gates", exact=True).wait_for(timeout=30_000)


def no_horizontal_overflow(page):
    dimensions = page.evaluate("({viewport: window.innerWidth, document: document.documentElement.scrollWidth})")
    assert dimensions["document"] <= dimensions["viewport"] + 1, dimensions
    return dimensions


def screenshot(page, name):
    page.screenshot(path=str(EVIDENCE_DIR / name), full_page=True)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    try:
        operations_context = browser.new_context(viewport={"width": 1440, "height": 1000})
        operations = operations_context.new_page()
        monitor(operations, "operations-desktop")
        login_identity(operations, "Operations")
        operations.get_by_role("button", name="Start Operations KYC", exact=True).click()
        operations.locator(".success-message").get_by_text("ready for consent and submission", exact=False).wait_for(timeout=30_000)

        identity_notice = operations.get_by_role("button", name="Acknowledge identity notice", exact=True)
        if identity_notice.is_visible():
            identity_notice.click()
            operations.locator(".success-message").get_by_text("acknowledgement recorded", exact=False).wait_for(timeout=30_000)
            operations.get_by_role("button", name="Acknowledge liveness notice", exact=True).click()
            operations.locator(".success-message").get_by_text("acknowledgement recorded", exact=False).wait_for(timeout=30_000)
            operations.get_by_role("button", name="Submit for processing", exact=True).click()
            operations.locator(".success-message").get_by_text("submitted for processing", exact=False).wait_for(timeout=30_000)

        assert operations.get_by_role("button", name="Run synthetic sandbox controls", exact=True).count() == 0
        assert operations.get_by_role("button", name="Approve", exact=True).count() == 0
        operations.get_by_role("button", name="Withdraw consent & stop processing", exact=True).click()
        operations.locator(".success-message").get_by_text("revoked after consent withdrawal", exact=False).wait_for(timeout=30_000)
        operations.get_by_text("revoked", exact=True).first.wait_for(timeout=30_000)

        review_case = operations.locator(".identity-case-list button").filter(has_text="representative kyc").filter(has_text="manual review").first
        review_case.wait_for(timeout=30_000)
        review_case.click()
        operations.get_by_role("button", name="Approve", exact=True).click()
        operations.locator(".success-message").get_by_text("changed to approved", exact=False).wait_for(timeout=30_000)
        operations.get_by_text("synthetic-control-fixture-v1", exact=True).first.wait_for(timeout=30_000)
        operations_dimensions = no_horizontal_overflow(operations)
        screenshot(operations, "operations-identity-desktop.png")
        REPORT["operations"] = {
            "status": "passed",
            "ownApplicantWorkflow": True,
            "selfProcessingAndApprovalNotOffered": True,
            "consentWithdrawalRevokes": True,
            "independentReviewCompleted": True,
            "dimensions": operations_dimensions,
        }
        operations_context.close()

        representative_context = browser.new_context(viewport={"width": 1440, "height": 1000})
        representative = representative_context.new_page()
        monitor(representative, "representative-desktop")
        login_identity(representative, "Team rep")
        representative.get_by_text("representative kyc", exact=True).first.wait_for(timeout=30_000)
        representative.get_by_text("bank name match", exact=True).first.wait_for(timeout=30_000)
        representative.get_by_text("synthetic-control-fixture-v1", exact=True).first.wait_for(timeout=30_000)
        representative_dimensions = no_horizontal_overflow(representative)
        screenshot(representative, "representative-identity-desktop.png")
        REPORT["representative"] = {"status": "passed", "approvalAndEvidenceVisible": True, "dimensions": representative_dimensions}
        representative_context.close()

        vendor_context = browser.new_context(viewport={"width": 1440, "height": 1000})
        vendor = vendor_context.new_page()
        monitor(vendor, "vendor-desktop")
        login_identity(vendor, "Vendor partner")
        vendor.get_by_text("registry kyb", exact=True).first.wait_for(timeout=30_000)
        vendor.get_by_role("button", name="Customer KYC handoff", exact=True).click()
        vendor.locator(".success-message").get_by_text("no customer identity data was accepted", exact=False).wait_for(timeout=30_000)
        vendor_dimensions = no_horizontal_overflow(vendor)
        screenshot(vendor, "vendor-identity-desktop.png")
        REPORT["vendor"] = {"status": "passed", "kybVisible": True, "customerHandoffWithoutCustomerIdentifiers": True, "dimensions": vendor_dimensions}
        vendor_context.close()

        mobile_context = browser.new_context(viewport={"width": 375, "height": 812}, is_mobile=True)
        mobile = mobile_context.new_page()
        monitor(mobile, "campus-lead-mobile")
        login_identity(mobile, "Campus Lead")
        mobile.get_by_text("campus lead kyc", exact=True).first.wait_for(timeout=30_000)
        mobile.get_by_text("Privacy boundary:", exact=False).wait_for(timeout=30_000)
        mobile_dimensions = no_horizontal_overflow(mobile)
        screenshot(mobile, "campus-lead-identity-mobile-375.png")
        REPORT["campusLeadMobile"] = {"status": "passed", "reverificationWorkflowVisible": True, "dimensions": mobile_dimensions}
        mobile_context.close()
    finally:
        browser.close()

REPORT["browserRuntimeErrors"] = errors
REPORT["externalRequests"] = external_requests
REPORT["status"] = "passed" if not errors and not external_requests else "failed"
print(json.dumps(REPORT, indent=2))
assert not errors, errors
assert not external_requests, external_requests
