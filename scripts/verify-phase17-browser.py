#!/usr/bin/env python3
"""Phase 17 production-browser acceptance for all thirty innovation inspectors."""
import json
import os
import time
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("KF_BROWSER_BASE_URL", "http://127.0.0.1:3000").rstrip("/")
EVIDENCE_DIR = Path(os.environ.get("KF_BROWSER_EVIDENCE_DIR", "/tmp/kampusforce-phase17-browser"))
EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_HOSTS = {urlparse(BASE_URL).hostname, "127.0.0.1", "localhost", "::1"}
STAMP = str(int(time.time()))
REPORT = {
    "phase": 17,
    "mode": "local_sandbox_production_browser_acceptance",
    "externalProviderRequestMade": False,
    "productionReady": False,
}
errors = []
external_requests = []
checks = []

PLATFORM = [
    "Activation evidence", "Promotion digital twin", "Versioned metrics", "Consent & purpose",
    "Composable controls", "Independent outcomes", "Capability coaching", "Private benchmarks",
    "Risk-adaptive timing", "Resilience & portability",
]
CRM = [
    "Relationship 360", "Next best action", "Versioned lead scoring", "Scenario forecasts",
    "Consent-led sequences", "Team collaboration", "Duplicate review", "Influence touchpoints",
    "Capacity routing", "Voice of customer",
]
CASE = [
    "Omnichannel intake", "Skill & capacity routing", "Business-hours SLA", "Reviewed attachments",
    "Knowledge center", "Problem management", "Major incident command", "Quality & coaching",
    "CSAT & effort analytics", "Redacting case copilot",
]


def monitor(page, label):
    page.on("pageerror", lambda error: errors.append(f"{label} pageerror: {error}"))
    page.on("console", lambda message: errors.append(f"{label} console error: {message.text}") if message.type == "error" else None)
    page.on("response", lambda response: errors.append(f"{label} HTTP {response.status}: {response.url}") if response.status >= 400 else None)

    def check_request(request):
        hostname = urlparse(request.url).hostname
        if hostname and hostname not in ALLOWED_HOSTS:
            external_requests.append(f"{label}: {request.method} {hostname}")

    page.on("request", check_request)


def dimensions(page):
    result = page.evaluate("({viewport: window.innerWidth, document: document.documentElement.scrollWidth})")
    assert result["document"] <= result["viewport"] + 1, result
    return result


def login(page, role):
    page.goto(BASE_URL, wait_until="networkidle")
    page.get_by_role("button", name=role, exact=False).click()
    page.locator(".workspace-shell").wait_for(timeout=30_000)


def open_sales(page, view):
    page.locator('a[href="/sales"]:visible').first.click()
    page.locator(".sales-view-tabs").wait_for(timeout=30_000)
    page.locator(".sales-view-tabs").get_by_role("button", name=view, exact=True).click()
    page.locator(".sales-view-tabs").get_by_role("button", name=view, exact=True).and_(
        page.locator('[aria-current="page"]')
    ).wait_for(timeout=30_000)
    page.locator(".innovation-shell").wait_for(timeout=30_000)


def select_feature(page, label):
    nav = page.locator(".innovation-feature-nav")
    nav.get_by_role("button").filter(has_text=label).first.click()
    page.locator(".innovation-inspector-head h2").filter(has_text=label).wait_for(timeout=15_000)
    assert page.locator(".innovation-inspector-head h2").inner_text() == label
    checks.append({"feature": label, "dimensions": dimensions(page)})


def exercise_features(page, labels):
    for label in labels:
        select_feature(page, label)


def screenshot(page, name):
    page.screenshot(path=str(EVIDENCE_DIR / name), full_page=True)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    try:
        context = browser.new_context(viewport={"width": 1440, "height": 1000})
        ops = context.new_page()
        monitor(ops, "operations")
        login(ops, "Operations")

        open_sales(ops, "Decision intelligence")
        exercise_features(ops, PLATFORM)
        select_feature(ops, "Promotion digital twin")
        ops.get_by_label("Scenario name", exact=True).fill(f"Browser Phase 17 twin {STAMP}")
        ops.get_by_role("button", name="Simulate only", exact=True).click()
        ops.locator(".innovation-success").wait_for(timeout=30_000)
        screenshot(ops, "operations-intelligence-desktop.png")

        open_sales(ops, "Relationship CRM")
        exercise_features(ops, CRM)
        select_feature(ops, "Scenario forecasts")
        ops.get_by_label("Forecast name", exact=True).fill(f"Browser Phase 17 forecast {STAMP}")
        ops.get_by_role("button", name="Snapshot planning estimate", exact=True).click()
        ops.locator(".innovation-success").wait_for(timeout=30_000)
        screenshot(ops, "operations-crm-desktop.png")

        open_sales(ops, "Case command")
        exercise_features(ops, CASE)
        select_feature(ops, "Redacting case copilot")
        ops.get_by_role("button", name="Run redacting copilot", exact=True).click()
        ops.locator(".innovation-success").wait_for(timeout=30_000)
        screenshot(ops, "operations-cases-desktop.png")

        ops.set_viewport_size({"width": 375, "height": 812})
        for view, labels, image in [
            ("Decision intelligence", PLATFORM, "operations-intelligence-mobile.png"),
            ("Relationship CRM", CRM, "operations-crm-mobile.png"),
            ("Case command", CASE, "operations-cases-mobile.png"),
        ]:
            open_sales(ops, view)
            exercise_features(ops, labels)
            screenshot(ops, image)

        rep_context = browser.new_context(viewport={"width": 390, "height": 844})
        rep = rep_context.new_page()
        monitor(rep, "representative")
        login(rep, "Team rep")
        open_sales(rep, "Decision intelligence")
        rep.locator(".innovation-feature-nav > button").first.wait_for(timeout=15_000)
        assert rep.locator(".innovation-feature-nav > button").count() == 1
        assert rep.locator(".innovation-inspector-head h2").inner_text() == "Capability coaching"
        dimensions(rep)
        open_sales(rep, "Relationship CRM")
        rep.locator(".innovation-feature-nav > button").first.wait_for(timeout=15_000)
        assert rep.locator(".innovation-feature-nav > button").count() == 9
        dimensions(rep)
        open_sales(rep, "Case command")
        rep.locator(".innovation-feature-nav > button").first.wait_for(timeout=15_000)
        assert rep.locator(".innovation-feature-nav > button").count() == 6
        dimensions(rep)
        screenshot(rep, "representative-role-scope-mobile.png")
        rep_context.close()

        vendor_context = browser.new_context(viewport={"width": 1280, "height": 900})
        vendor = vendor_context.new_page()
        monitor(vendor, "vendor")
        login(vendor, "Vendor partner")
        open_sales(vendor, "Decision intelligence")
        vendor.locator(".innovation-feature-nav > button").first.wait_for(timeout=15_000)
        assert vendor.locator(".innovation-feature-nav > button").count() == 1
        assert vendor.locator(".innovation-inspector-head h2").inner_text() == "Promotion digital twin"
        dimensions(vendor)
        open_sales(vendor, "Relationship CRM")
        vendor.locator(".innovation-feature-nav > button").first.wait_for(timeout=15_000)
        assert vendor.locator(".innovation-feature-nav > button").count() == 8
        dimensions(vendor)
        open_sales(vendor, "Case command")
        vendor.locator(".innovation-feature-nav > button").first.wait_for(timeout=15_000)
        assert vendor.locator(".innovation-feature-nav > button").count() == 6
        dimensions(vendor)
        vendor_context.close()

        finance_context = browser.new_context(viewport={"width": 1280, "height": 900})
        finance = finance_context.new_page()
        monitor(finance, "finance")
        login(finance, "Finance")
        open_sales(finance, "Decision intelligence")
        select_feature(finance, "Activation evidence")
        assert finance.locator(".innovation-inspector form").count() == 0
        dimensions(finance)
        finance_context.close()
        context.close()
    finally:
        browser.close()

assert not errors, "\n".join(errors)
assert not external_requests, "\n".join(external_requests)
REPORT.update({
    "status": "passed",
    "platformInspectors": 10,
    "crmInspectors": 10,
    "caseInspectors": 10,
    "desktopAndMobileFeatureChecks": len(checks),
    "browserMutations": ["promotion simulation", "planning forecast", "redacting case copilot"],
    "representativeRoleScope": True,
    "vendorRoleScope": True,
    "financeReadOnly": True,
    "pageOverflow": False,
    "runtimeErrors": 0,
    "httpErrors": 0,
    "externalRequests": 0,
    "evidenceDirectory": str(EVIDENCE_DIR),
})
(EVIDENCE_DIR / "report.json").write_text(json.dumps(REPORT, indent=2))
print(json.dumps(REPORT, indent=2))
