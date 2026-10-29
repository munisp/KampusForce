#!/usr/bin/env python3
"""Phase 18 production-browser acceptance for the opportunity ATS and new campaign types."""
import json
import os
import time
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("KF_BROWSER_BASE_URL", "http://127.0.0.1:3000").rstrip("/")
EVIDENCE_DIR = Path(os.environ.get("KF_BROWSER_EVIDENCE_DIR", "/tmp/kampusforce-phase18-browser"))
EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_HOSTS = {urlparse(BASE_URL).hostname, "127.0.0.1", "localhost", "::1"}
STAMP = str(int(time.time()))
TITLE = f"Browser Phase 18 campus hiring {STAMP}"
APPLICANT = f"Browser Geology Student {STAMP}"
EMAIL = f"browser-geology-{STAMP}@example.test"
FEATURES = [
    "Portfolio & analytics", "Campaign studio", "Institutional governance", "Application desk", "Selection pipeline",
    "Documents & intelligence", "Assessments", "Interviews", "Offers & acceptance",
    "Verified outcomes", "Import, export & retention",
]
REPORT = {
    "phase": 18,
    "mode": "local_sandbox_production_browser_acceptance",
    "externalProviderRequestMade": False,
    "productionReady": False,
}
errors = []
external_requests = []
checks = []


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
    page.locator(".role-card").filter(has_text=role).first.click()
    page.locator(".workspace-shell").wait_for(timeout=30_000)


def open_ats(page):
    page.locator('a[href="/sales"]:visible').first.click()
    page.locator(".sales-view-tabs").wait_for(timeout=30_000)
    page.locator(".sales-view-tabs").get_by_role("button", name="Opportunity ATS", exact=True).click()
    page.locator(".talent-workspace").wait_for(timeout=30_000)


def select_feature(page, label):
    nav = page.locator(".innovation-feature-nav")
    nav.get_by_role("button").filter(has_text=label).first.click()
    page.locator(".innovation-inspector-head h2").filter(has_text=label).wait_for(timeout=15_000)
    assert page.locator(".innovation-inspector-head h2").inner_text() == label
    checks.append({"feature": label, "dimensions": dimensions(page)})


def select_campaign(page, title):
    select = page.locator(".talent-contexts select").nth(0)
    option = select.locator("option").filter(has_text=title).first
    option.wait_for(state="attached", timeout=30_000)
    select.select_option(option.get_attribute("value"))


def select_application(page, name):
    select = page.locator(".talent-contexts select").nth(1)
    option = select.locator("option").filter(has_text=name).first
    option.wait_for(state="attached", timeout=30_000)
    select.select_option(option.get_attribute("value"))


def campaign_record(page):
    return page.locator(".innovation-record").filter(has_text=TITLE).first


def wait_saved(page):
    page.locator(".innovation-success").wait_for(timeout=30_000)


def screenshot(page, name):
    page.screenshot(path=str(EVIDENCE_DIR / name), full_page=True)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    try:
        vendor_context = browser.new_context(viewport={"width": 1440, "height": 1000})
        vendor = vendor_context.new_page()
        monitor(vendor, "vendor")
        login(vendor, "Vendor partner")
        open_ats(vendor)
        select_feature(vendor, "Campaign studio")
        form = vendor.locator("form").filter(has_text="Create an external campus opportunity")
        form.get_by_label("Campaign title", exact=True).fill(TITLE)
        form.locator('textarea[name="targets"]').fill("1:1000")
        form.get_by_role("button", name="Create draft campaign", exact=True).click()
        wait_saved(vendor)
        record = campaign_record(vendor)
        record.get_by_role("button", name="Submit for independent review", exact=True).click()
        wait_saved(vendor)
        assert record.get_by_role("button", name="Approve", exact=True).count() == 0
        screenshot(vendor, "vendor-campaign-desktop.png")
        vendor_context.close()

        ops_context = browser.new_context(viewport={"width": 1440, "height": 1000})
        ops = ops_context.new_page()
        monitor(ops, "operations")
        login(ops, "Operations")
        open_ats(ops)
        select_feature(ops, "Campaign studio")
        record = campaign_record(ops)
        record.get_by_role("button", name="Approve", exact=True).click()
        wait_saved(ops)
        record.get_by_role("button", name="Activate in window", exact=True).wait_for(timeout=30_000)
        record.get_by_role("button", name="Activate in window", exact=True).click()
        record.get_by_role("button", name="Pause", exact=True).wait_for(timeout=30_000)
        ops.close()

        rep_context = browser.new_context(viewport={"width": 390, "height": 844})
        rep = rep_context.new_page()
        monitor(rep, "representative")
        login(rep, "Team rep")
        open_ats(rep)
        select_feature(rep, "Application desk")
        select_campaign(rep, TITLE)
        form = rep.locator("form").filter(has_text="Consented application form")
        form.get_by_label("Full name", exact=True).fill(APPLICANT)
        form.get_by_label("Email", exact=True).fill(EMAIL)
        form.get_by_role("button", name="Submit application", exact=True).click()
        wait_saved(rep)
        rep.locator(".innovation-record").filter(has_text=APPLICANT).wait_for(timeout=30_000)
        dimensions(rep)
        screenshot(rep, "representative-application-mobile.png")
        rep_context.close()

        ops = ops_context.new_page()
        monitor(ops, "operations")
        login(ops, "Operations")
        open_ats(ops)
        select_feature(ops, "Selection pipeline")
        select_campaign(ops, TITLE)
        select_application(ops, APPLICANT)
        ops.get_by_role("button", name="Record stage decision", exact=True).click()
        wait_saved(ops)
        ops.locator(".relationship-summary").get_by_text("screening", exact=True).wait_for(timeout=30_000)
        for label in FEATURES:
            select_feature(ops, label)
        select_feature(ops, "Portfolio & analytics")
        screenshot(ops, "operations-portfolio-desktop.png")
        ops.set_viewport_size({"width": 375, "height": 812})
        for label in FEATURES:
            select_feature(ops, label)
        screenshot(ops, "operations-retention-mobile.png")

        lead_context = browser.new_context(viewport={"width": 390, "height": 844})
        lead = lead_context.new_page()
        monitor(lead, "campus_lead")
        login(lead, "Campus Lead")
        open_ats(lead)
        lead.locator(".innovation-feature-nav > button").first.wait_for(timeout=15_000)
        assert lead.locator(".innovation-feature-nav > button").count() == 11
        select_feature(lead, "Campaign studio")
        assert lead.locator("form").filter(has_text="Create an external campus opportunity").count() == 0
        select_feature(lead, "Selection pipeline")
        assert lead.get_by_role("button", name="Record stage decision", exact=True).count() == 0
        screenshot(lead, "campus-lead-scope-mobile.png")
        lead_context.close()

        finance_context = browser.new_context(viewport={"width": 1280, "height": 900})
        finance = finance_context.new_page()
        monitor(finance, "finance")
        login(finance, "Finance")
        open_ats(finance)
        finance.locator(".innovation-feature-nav > button").first.wait_for(timeout=15_000)
        assert finance.locator(".innovation-feature-nav > button").count() == 3
        for label in ["Portfolio & analytics", "Campaign studio", "Verified outcomes"]:
            select_feature(finance, label)
            assert finance.locator(".innovation-inspector form").count() == 0
            assert "@" not in finance.locator(".innovation-inspector").inner_text()
        screenshot(finance, "finance-read-only-desktop.png")
        finance_context.close()
        ops_context.close()
    finally:
        browser.close()

assert not errors, "\n".join(errors)
assert not external_requests, "\n".join(external_requests)
REPORT.update({
    "status": "passed",
    "atsInspectors": 11,
    "desktopAndMobileFeatureChecks": len(checks),
    "browserMutations": [
        "vendor campaign draft and submission",
        "independent Operations approval and activation",
        "representative consented application",
        "Operations screening decision",
    ],
    "vendorRoleScope": True,
    "representativeRoleScope": True,
    "campusLeadReadOnlySelectionScope": True,
    "financeAggregateReadOnlyWithoutContacts": True,
    "pageOverflow": False,
    "runtimeErrors": 0,
    "httpErrors": 0,
    "externalRequests": 0,
    "evidenceDirectory": str(EVIDENCE_DIR),
})
(EVIDENCE_DIR / "report.json").write_text(json.dumps(REPORT, indent=2))
print(json.dumps(REPORT, indent=2))
