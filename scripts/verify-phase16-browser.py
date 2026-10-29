#!/usr/bin/env python3
"""Phase 16 production-browser acceptance for promotion orchestration.

Synthetic sandbox records only. No customer, messaging, identity, payment, or
other external provider is contacted.
"""
import json
import os
import subprocess
import time
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("KF_BROWSER_BASE_URL", "http://127.0.0.1:3000").rstrip("/")
EVIDENCE_DIR = Path(os.environ.get("KF_BROWSER_EVIDENCE_DIR", "/tmp/kampusforce-phase16-browser"))
EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
ROOT = Path(__file__).resolve().parents[1]
ALLOWED_HOSTS = {urlparse(BASE_URL).hostname, "127.0.0.1", "localhost", "::1"}
STAMP = str(int(time.time()))
REPORT = {
    "phase": 16,
    "mode": "local_sandbox_production_browser_acceptance",
    "externalProviderRequestMade": False,
    "liveDeliveryClaimed": False,
    "productionReady": False,
}
errors = []
external_requests = []

subprocess.run(
    ["npx", "tsx", "scripts/prepare-phase16-browser.ts"],
    cwd=ROOT,
    check=True,
    stdout=subprocess.PIPE,
    text=True,
)


def monitor(page, label):
    page.on("pageerror", lambda error: errors.append(f"{label} pageerror: {error}"))
    page.on("console", lambda message: errors.append(f"{label} console error: {message.text}") if message.type == "error" else None)
    page.on("response", lambda response: errors.append(f"{label} HTTP {response.status}: {response.url}") if response.status >= 400 else None)

    def check_request(request):
        hostname = urlparse(request.url).hostname
        if hostname and hostname not in ALLOWED_HOSTS:
            external_requests.append(f"{label}: {request.method} {hostname}")

    page.on("request", check_request)


def login(page, role):
    page.goto(BASE_URL, wait_until="networkidle")
    page.get_by_role("button", name=role, exact=False).click()
    page.locator(".workspace-shell").wait_for(timeout=30_000)


def open_promotions(page):
    page.locator('a[href="/sales"]:visible').first.click()
    page.locator(".sales-view-tabs").wait_for(timeout=30_000)
    page.get_by_role("button", name="Vendor promotions", exact=True).click()
    page.get_by_text("External demand. Internal readiness.", exact=False).wait_for(timeout=30_000)
    page.locator(".promotion-list").wait_for(timeout=30_000)


def promotion_panel(page, name):
    panel = page.locator(".promotion-list > *").filter(has_text=name).first
    panel.wait_for(timeout=30_000)
    return panel


def dimensions(page):
    result = page.evaluate("({viewport: window.innerWidth, document: document.documentElement.scrollWidth})")
    assert result["document"] <= result["viewport"] + 1, result
    return result


def screenshot(page, name):
    page.screenshot(path=str(EVIDENCE_DIR / name), full_page=True)


promotion_name = f"Browser campus promotion {STAMP}"
candidate_name = f"Browser Candidate {STAMP}"
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    try:
        vendor_context = browser.new_context(viewport={"width": 1440, "height": 1000})
        vendor = vendor_context.new_page()
        monitor(vendor, "vendor-desktop")
        login(vendor, "Vendor partner")
        open_promotions(vendor)
        vendor.get_by_label("Promotion name", exact=True).fill(promotion_name)
        vendor.get_by_label("Product", exact=False).select_option(index=1)
        vendor.get_by_label("Campus scope", exact=False).select_option(label="University of Lagos")
        vendor.get_by_label("Customer promotion brief", exact=True).fill(
            "Synthetic back-to-campus offer with clear eligibility, vendor-verified funded activation evidence, controlled recruitment and no income guarantee."
        )
        vendor.get_by_label("Budget cap (₦)", exact=False).fill("50000")
        vendor.get_by_label("Activated-recruit target", exact=True).fill("2")
        vendor.get_by_role("button", name="Create controlled draft", exact=True).click()
        vendor_panel = promotion_panel(vendor, promotion_name)
        vendor_panel.get_by_role("button", name="Submit for review", exact=True).click()
        vendor_panel.get_by_role("button", name="Submit for review", exact=True).wait_for(state="detached", timeout=30_000)
        vendor_panel.get_by_text("pending review", exact=False).wait_for(timeout=30_000)
        screenshot(vendor, "vendor-draft-submitted-desktop.png")
        REPORT["vendorDraft"] = {"status": "passed", "selfService": True, "submittedForIndependentReview": True}

        ops_context = browser.new_context(viewport={"width": 1440, "height": 1000})
        ops = ops_context.new_page()
        monitor(ops, "operations-desktop")
        login(ops, "Operations")
        open_promotions(ops)
        ops_panel = promotion_panel(ops, promotion_name)
        ops_panel.get_by_role("button", name="Approve independently", exact=True).click()
        ops_panel.get_by_role("button", name="Start", exact=True).wait_for(timeout=30_000)
        ops_panel.get_by_role("button", name="Start", exact=True).click()
        ops_panel.get_by_role("button", name="Pause acquisition & recruiting", exact=True).wait_for(timeout=30_000)
        assert ops.locator(".promotion-rule-list article").count() == 8
        ops.get_by_text("Durable orchestration receipts", exact=True).wait_for(timeout=30_000)
        desktop_dimensions = dimensions(ops)
        screenshot(ops, "operations-approved-active-desktop.png")
        REPORT["operationsReview"] = {
            "status": "passed",
            "independentApproval": True,
            "started": True,
            "triggerRules": 8,
            "dimensions": desktop_dimensions,
        }

        lead_context = browser.new_context(viewport={"width": 1440, "height": 1000})
        lead = lead_context.new_page()
        monitor(lead, "campus-lead-desktop")
        login(lead, "Campus lead")
        open_promotions(lead)
        lead_panel = promotion_panel(lead, promotion_name)
        lead_panel.get_by_role("button", name="Create signed link & QR", exact=True).click()
        lead_panel.locator(".promotion-link-result img").wait_for(timeout=30_000)
        signed_url = lead_panel.locator(".promotion-link-result input").input_value()
        assert "/p/" in signed_url
        assert "customer" not in signed_url.lower() and "phone" not in signed_url.lower()
        lead.get_by_label("Candidate name", exact=True).fill(candidate_name)
        lead.get_by_label("Consented phone", exact=True).fill(f"+23497{STAMP[-8:]}")
        lead.get_by_label("Recruitment context", exact=False).fill("Consented synthetic candidate; no identity documents or commission entitlement.")
        lead.get_by_label("The candidate consented to this invitation", exact=True).check()
        lead.get_by_role("button", name="Create promotion invitation", exact=True).click()
        lead.locator(".invite-link input").wait_for(timeout=30_000)
        acceptance_url = lead.locator(".invite-link input").input_value()
        assert "/recruit/accept?token=" in acceptance_url
        lead.locator(".promotion-recruit-queue").get_by_text(candidate_name, exact=True).wait_for(timeout=30_000)
        lead.get_by_text("Recruitment creates no commission.", exact=False).wait_for(timeout=30_000)
        screenshot(lead, "campus-lead-link-recruitment-desktop.png")
        REPORT["campusLead"] = {
            "status": "passed",
            "signedLinkAndQr": True,
            "customerDataInSignedUrl": False,
            "consentedInvitation": True,
            "recruitmentCommissionCreated": False,
        }

        vendor.reload(wait_until="networkidle")
        vendor_panel = promotion_panel(vendor, promotion_name)
        vendor_panel.get_by_role("button", name=f"Select {promotion_name}", exact=True).click()
        vendor.get_by_label("Customer reference", exact=True).fill(f"opaque-browser-customer-{STAMP}")
        vendor.get_by_label("Opaque evidence reference", exact=True).fill("opaque-browser-consent-evidence")
        vendor.get_by_role("button", name="Record hashed consent state", exact=True).click()
        vendor.get_by_text("Consented audience: 1", exact=False).wait_for(timeout=30_000)
        vendor.get_by_role("button", name="Simulate consented delivery", exact=True).click()
        vendor.locator(".success-note").get_by_text("No external request was made.", exact=False).wait_for(timeout=30_000)
        vendor.get_by_text("Pending deals are not reported as confirmed.", exact=False).wait_for(timeout=30_000)
        screenshot(vendor, "vendor-consent-reporting-desktop.png")
        REPORT["vendorReporting"] = {
            "status": "passed",
            "hashedConsent": True,
            "sandboxDeliverySimulated": True,
            "externalRequestMade": False,
            "verifiedOutcomeBoundaryVisible": True,
        }

        finance_context = browser.new_context(viewport={"width": 1440, "height": 1000})
        finance = finance_context.new_page()
        monitor(finance, "finance-desktop")
        login(finance, "Finance")
        open_promotions(finance)
        promotion_panel(finance, promotion_name)
        finance.get_by_text("Verified reporting boundary", exact=True).wait_for(timeout=30_000)
        for control in ["Create controlled draft", "Approve independently", "Start", "Pause acquisition & recruiting", "Create signed link & QR", "Record hashed consent state", "Simulate consented delivery"]:
            assert finance.get_by_role("button", name=control, exact=True).count() == 0, control
        assert finance.get_by_label("Customer reference", exact=True).count() == 0
        finance_dimensions = dimensions(finance)
        screenshot(finance, "finance-read-only-desktop.png")
        REPORT["finance"] = {"status": "passed", "readOnly": True, "dimensions": finance_dimensions}
        finance_context.close()

        mobile_context = browser.new_context(viewport={"width": 375, "height": 812}, is_mobile=True)
        mobile = mobile_context.new_page()
        monitor(mobile, "campus-lead-mobile")
        login(mobile, "Campus lead")
        open_promotions(mobile)
        promotion_panel(mobile, promotion_name)
        mobile.get_by_text("Recruitment creates no commission.", exact=False).wait_for(timeout=30_000)
        mobile_dimensions = dimensions(mobile)
        screenshot(mobile, "campus-lead-promotions-mobile-375.png")
        REPORT["mobile375"] = {"status": "passed", "dimensions": mobile_dimensions}
        mobile_context.close()

        lead_context.close()
        ops_context.close()
        vendor_context.close()
    finally:
        browser.close()

REPORT["browserRuntimeErrors"] = errors
REPORT["externalRequests"] = external_requests
REPORT["status"] = "passed" if not errors and not external_requests else "failed"
print(json.dumps(REPORT, indent=2))
assert not errors, errors
assert not external_requests, external_requests
