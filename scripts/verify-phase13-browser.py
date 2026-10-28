#!/usr/bin/env python3
"""Phase 13 production-browser acceptance for analytics and architecture boundaries."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("KF_BROWSER_BASE_URL", "http://127.0.0.1:3000")
EVIDENCE_DIR = Path(os.environ.get("KF_BROWSER_EVIDENCE_DIR", "/tmp/kampusforce-phase13"))
EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
REPORT = {"mode": "local_sandbox_production_browser_acceptance", "externalRequestMade": False, "productionReady": False}


def login_architecture(page, workspace="Operations"):
    page.goto(BASE_URL, wait_until="networkidle")
    page.get_by_role("button", name=workspace, exact=False).click()
    page.locator(".workspace-shell").wait_for(timeout=30_000)
    page.locator('a[href="/architecture"]:visible').first.click()
    page.get_by_role("button", name="Advanced analytics", exact=True).wait_for(timeout=30_000)


def no_horizontal_overflow(page):
    dimensions = page.evaluate("({viewport: window.innerWidth, document: document.documentElement.scrollWidth})")
    assert dimensions["document"] <= dimensions["viewport"] + 1, dimensions
    return dimensions


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    errors = []
    try:
        context = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append(f"desktop pageerror: {error}"))
        login_architecture(page)
        page.get_by_role("button", name="365 days", exact=True).click()
        page.get_by_text("Activation & confirmation trend", exact=True).wait_for(timeout=30_000)
        page.get_by_text("Seven-day conversion cohorts", exact=True).wait_for(timeout=30_000)
        page.get_by_role("button", name="Capture reproducible snapshot", exact=True).click()
        page.locator(".success-message").get_by_text("captured with SHA-256", exact=False).wait_for(timeout=30_000)
        page.screenshot(path=str(EVIDENCE_DIR / "analytics-desktop.png"), full_page=True)
        REPORT["analytics"] = {"status": "passed", "eventTimeTrend": True, "sevenDayCohorts": True, "immutableSnapshotCapture": True}

        page.get_by_role("button", name="Lakehouse & Ray", exact=True).click()
        page.get_by_text("Temporal holdout", exact=True).wait_for(timeout=30_000)
        page.get_by_text("Locked — local models remain unapproved", exact=True).wait_for(timeout=30_000)
        page.get_by_text("Execution evidence recorded", exact=True).first.wait_for(timeout=30_000)
        page.screenshot(path=str(EVIDENCE_DIR / "lakehouse-ray-desktop.png"), full_page=True)
        REPORT["dataPlatform"] = {"status": "passed", "localDeltaEvidence": True, "localRayEvidence": True, "temporalHoldoutVisible": True, "modelApprovalLocked": True}

        context.close()

        finance_context = browser.new_context(viewport={"width": 1440, "height": 1000})
        finance = finance_context.new_page()
        finance.on("pageerror", lambda error: errors.append(f"finance pageerror: {error}"))
        login_architecture(finance, "Finance")
        finance.get_by_role("button", name="TigerBeetle & Mojaloop", exact=True).click()
        finance.get_by_role("button", name="Run gated outbox worker", exact=True).click()
        finance.locator(".success-message").get_by_text("dispatch remains blocked", exact=False).wait_for(timeout=30_000)
        finance.get_by_role("button", name="Reconcile posted balances", exact=True).click()
        finance.locator(".success-message").get_by_text("reconciliation remains blocked", exact=False).wait_for(timeout=30_000)
        finance.get_by_text("Transfer preparation is not settlement", exact=False).wait_for(timeout=30_000)
        finance.screenshot(path=str(EVIDENCE_DIR / "financial-desktop.png"), full_page=True)
        REPORT["financial"] = {"status": "passed", "authorizedFinanceWorkspace": True, "dispatchFailClosed": True, "reconciliationFailClosed": True, "settlementBoundaryVisible": True}
        finance_context.close()

        mobile_context = browser.new_context(viewport={"width": 375, "height": 812}, is_mobile=True)
        mobile = mobile_context.new_page()
        mobile.on("pageerror", lambda error: errors.append(f"mobile pageerror: {error}"))
        login_architecture(mobile)
        mobile.get_by_text("Activation & confirmation trend", exact=True).wait_for(timeout=30_000)
        analytics_dimensions = no_horizontal_overflow(mobile)
        mobile.screenshot(path=str(EVIDENCE_DIR / "analytics-mobile-375.png"), full_page=True)
        mobile.get_by_role("button", name="Lakehouse & Ray", exact=True).click()
        mobile.get_by_text("Temporal holdout", exact=True).wait_for(timeout=30_000)
        data_dimensions = no_horizontal_overflow(mobile)
        mobile.get_by_role("button", name="TigerBeetle & Mojaloop", exact=True).click()
        mobile.get_by_role("button", name="Run gated outbox worker", exact=True).wait_for(timeout=30_000)
        financial_dimensions = no_horizontal_overflow(mobile)
        mobile.screenshot(path=str(EVIDENCE_DIR / "financial-mobile-375.png"), full_page=True)
        REPORT["mobile"] = {"status": "passed", "analytics": analytics_dimensions, "dataPlatform": data_dimensions, "financial": financial_dimensions}
        mobile_context.close()
    finally:
        browser.close()

REPORT["browserRuntimeErrors"] = errors
REPORT["status"] = "passed" if not errors else "failed"
print(json.dumps(REPORT, indent=2))
assert not errors, errors
