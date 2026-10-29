#!/usr/bin/env python3
"""Phase 19 production-browser acceptance for institutional, document, connector and recurrence workflows."""
import json
import os
import time
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("KF_BROWSER_BASE_URL", "http://127.0.0.1:3000").rstrip("/")
EVIDENCE_DIR = Path(os.environ.get("KF_BROWSER_EVIDENCE_DIR", "/tmp/kampusforce-phase19-browser"))
EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_HOSTS = {urlparse(BASE_URL).hostname, "127.0.0.1", "localhost", "::1"}
STAMP = str(int(time.time()))
CAMPAIGN = f"Browser public grant {STAMP}"
APPLICANT = f"Browser Grant Student {STAMP}"
EMAIL = f"browser-grant-{STAMP}@example.test"
CONNECTOR = f"Browser CompanyA connector {STAMP}"
DOCUMENT = f"browser-grant-{STAMP}.pdf"
REPORT = {
    "phase": 19,
    "mode": "local_sandbox_production_browser_acceptance",
    "documentProcessor": "explicit_metadata_only_fixture_no_ocr",
    "realPaddleOcrDoclingVlmExecuted": False,
    "externalProviderRequestMade": False,
    "productionReady": False,
}
errors = []
external_requests = []
checks = []
mutations = []
contexts = []


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


def new_page(browser, role, label, width=1440, height=1000):
    context = browser.new_context(viewport={"width": width, "height": height})
    contexts.append(context)
    page = context.new_page()
    monitor(page, label)
    page.goto(BASE_URL, wait_until="networkidle")
    page.locator(".role-card").filter(has_text=role).first.click()
    page.locator(".workspace-shell").wait_for(timeout=30_000)
    return page


def open_sales(page, tab):
    page.locator('a[href="/sales"]:visible').first.click()
    page.locator(".sales-view-tabs").wait_for(timeout=30_000)
    page.locator(".sales-view-tabs").get_by_role("button", name=tab, exact=True).click()
    expected = {"Opportunity ATS": ".talent-workspace", "Onboarding connectors": ".connector-workspace", "Renewal evidence": ".recurrence-workspace"}[tab]
    page.locator(expected).wait_for(timeout=30_000)


def select_feature(page, label):
    nav = page.locator(".innovation-feature-nav")
    nav.get_by_role("button").filter(has_text=label).first.click()
    page.locator(".innovation-inspector-head h2").filter(has_text=label).wait_for(timeout=15_000)
    assert page.locator(".innovation-inspector-head h2").inner_text() == label
    checks.append({"feature": label, "dimensions": dimensions(page)})


def select_option_by_text(select, text):
    option = select.locator("option").filter(has_text=text).first
    option.wait_for(state="attached", timeout=30_000)
    select.select_option(option.get_attribute("value"))


def select_campaign(page, title=CAMPAIGN):
    select_option_by_text(page.locator(".talent-contexts select").nth(0), title)


def select_application(page, name=APPLICANT):
    select_option_by_text(page.locator(".talent-contexts select").nth(1), name)


def select_programme(page, title=CAMPAIGN):
    select_option_by_text(page.locator(".institutional-governance > .innovation-context select"), title)


def select_connector(page, name=CONNECTOR):
    select_option_by_text(page.locator(".connector-workspace > .innovation-context select"), name)


def campaign_record(page):
    return page.locator(".innovation-record").filter(has_text=CAMPAIGN).first


def connector_record(page):
    return page.locator(".innovation-record").filter(has_text=CONNECTOR).first


def wait_saved(page):
    page.locator(".innovation-success").last.wait_for(timeout=45_000)


def screenshot(page, name):
    dimensions(page)
    page.screenshot(path=str(EVIDENCE_DIR / name), full_page=True)


def synthetic_pdf(path):
    stream = "BT /F1 12 Tf 72 720 Td (Synthetic browser grant evidence) Tj ET"
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        f"<< /Length {len(stream.encode('ascii'))} >>\nstream\n{stream}\nendstream",
    ]
    pdf = "%PDF-1.4\n"
    offsets = []
    for index, obj in enumerate(objects):
        offsets.append(len(pdf.encode("ascii")))
        pdf += f"{index + 1} 0 obj\n{obj}\nendobj\n"
    xref = len(pdf.encode("ascii"))
    pdf += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n"
    for offset in offsets:
        pdf += f"{offset:010d} 00000 n \n"
    pdf += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
    path.write_bytes(pdf.encode("ascii"))


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    try:
        # Vendor drafts an institutional campaign and its complete governance evidence.
        vendor = new_page(browser, "Vendor partner", "vendor")
        open_sales(vendor, "Opportunity ATS")
        select_feature(vendor, "Campaign studio")
        form = vendor.locator("form").filter(has_text="Create an external campus opportunity")
        form.get_by_label("Campaign title", exact=True).fill(CAMPAIGN)
        form.locator('select[name="campaignType"]').select_option("grant")
        form.locator('input[name="targetCount"]').fill("10")
        targets = form.locator('textarea[name="targets"]')
        # Campus 1 is the seeded Team rep's campus; vendor campus ordering is not a visibility contract.
        targets.fill("1:10")
        form.get_by_role("button", name="Create draft campaign", exact=True).click()
        campaign_record(vendor).wait_for(timeout=30_000)
        mutations.append("vendor institutional grant draft")
        select_feature(vendor, "Institutional governance")
        select_programme(vendor)
        vendor.get_by_role("button", name="Save governance draft", exact=True).click()
        vendor.locator(".innovation-record").filter(has_text="Synthetic public programme sponsor").wait_for(timeout=30_000)
        vendor.get_by_role("button", name="Add for independent review", exact=True).click()
        vendor.locator(".innovation-record").filter(has_text="Synthetic partner institution").wait_for(timeout=30_000)
        mutations.append("vendor governance draft and institutional partner")
        screenshot(vendor, "vendor-institutional-governance-desktop.png")

        # Operations reviews the partner; the vendor submits governance and the campaign.
        ops = new_page(browser, "Operations", "operations-governance")
        open_sales(ops, "Opportunity ATS")
        select_feature(ops, "Institutional governance")
        select_programme(ops)
        ops.get_by_role("button", name="Approve partner", exact=True).click()
        ops.locator(".innovation-record").filter(has_text="Institution identity, programme role").wait_for(timeout=30_000)
        mutations.append("independent Operations partner approval")

        vendor = new_page(browser, "Vendor partner", "vendor-governance-submit")
        open_sales(vendor, "Opportunity ATS")
        select_feature(vendor, "Institutional governance")
        select_programme(vendor)
        submit = vendor.get_by_role("button", name="Submit approved governance", exact=True)
        submit.wait_for(timeout=30_000)
        assert submit.is_enabled()
        submit.click()
        vendor.get_by_role("button", name="Submit approved governance", exact=True).wait_for(state="detached", timeout=30_000)

        ops = new_page(browser, "Operations", "operations-governance-review")
        open_sales(ops, "Opportunity ATS")
        select_feature(ops, "Institutional governance")
        select_programme(ops)
        ops.get_by_role("button", name="Approve governance", exact=True).click()
        ops.get_by_role("button", name="Approve governance", exact=True).wait_for(state="detached", timeout=30_000)
        mutations.append("independent Operations governance approval")

        vendor = new_page(browser, "Vendor partner", "vendor-campaign-submit")
        open_sales(vendor, "Opportunity ATS")
        select_feature(vendor, "Campaign studio")
        campaign_record(vendor).get_by_role("button", name="Submit for independent review", exact=True).click()
        campaign_record(vendor).get_by_role("button", name="Submit for independent review", exact=True).wait_for(state="detached", timeout=30_000)

        ops = new_page(browser, "Operations", "operations-campaign-review")
        open_sales(ops, "Opportunity ATS")
        select_feature(ops, "Campaign studio")
        campaign_record(ops).get_by_role("button", name="Approve", exact=True).click()
        campaign_record(ops).get_by_role("button", name="Activate in window", exact=True).wait_for(timeout=30_000)
        campaign_record(ops).get_by_role("button", name="Activate in window", exact=True).click()
        campaign_record(ops).get_by_role("button", name="Pause", exact=True).wait_for(timeout=30_000)
        mutations.append("independent campaign approval and activation")

        # Representative applies, stores a real PDF, and runs the explicitly metadata-only fixture.
        rep = new_page(browser, "Team rep", "representative-documents", width=390, height=844)
        open_sales(rep, "Opportunity ATS")
        select_feature(rep, "Application desk")
        select_campaign(rep)
        form = rep.locator("form").filter(has_text="Consented application form")
        form.get_by_label("Full name", exact=True).fill(APPLICANT)
        form.get_by_label("Email", exact=True).fill(EMAIL)
        form.get_by_role("button", name="Submit application", exact=True).click()
        rep.locator(".innovation-record").filter(has_text=APPLICANT).wait_for(timeout=30_000)
        select_feature(rep, "Documents & intelligence")
        select_campaign(rep)
        select_application(rep)
        pdf_path = EVIDENCE_DIR / DOCUMENT
        synthetic_pdf(pdf_path)
        rep.locator('input[name="file"]').set_input_files(str(pdf_path))
        rep.get_by_role("button", name="Upload for synchronous review", exact=True).click()
        rep.locator(".innovation-record").filter(has_text=DOCUMENT).wait_for(timeout=45_000)
        analysis_form = rep.locator("form").filter(has_text=f"Analyse {DOCUMENT}")
        analysis_form.locator('input[type="checkbox"]').check()
        analysis_form.get_by_role("button", name="Run consented analysis", exact=True).click()
        analysis = rep.locator(".innovation-record").filter(has_text="Document analysis #").first
        analysis.wait_for(timeout=45_000)
        analysis.get_by_text("needs review", exact=True).wait_for(timeout=45_000)
        assert "raw text persisted: false" in analysis.inner_text()
        assert "automated decision: false" in analysis.inner_text()
        assert "sandbox fixture" in analysis.inner_text()
        screenshot(rep, "representative-document-intelligence-mobile.png")
        mutations.append("representative application, object storage and consented metadata-only analysis")

        ops = new_page(browser, "Operations", "operations-document-review")
        open_sales(ops, "Opportunity ATS")
        select_feature(ops, "Documents & intelligence")
        select_campaign(ops)
        select_application(ops)
        analysis = ops.locator(".innovation-record").filter(has_text="Document analysis #").first
        analysis.get_by_role("button", name="Approve evidence", exact=True).click()
        analysis.get_by_text("approved", exact=True).wait_for(timeout=30_000)
        assert "Human review:" in analysis.inner_text()
        mutations.append("independent human document-evidence review")

        rep = new_page(browser, "Team rep", "representative-document-withdraw", width=390, height=844)
        open_sales(rep, "Opportunity ATS")
        select_feature(rep, "Documents & intelligence")
        select_campaign(rep)
        select_application(rep)
        analysis = rep.locator(".innovation-record").filter(has_text="Document analysis #").first
        analysis.get_by_role("button", name="Withdraw & purge analysis", exact=True).click()
        analysis.get_by_text("withdrawn", exact=True).wait_for(timeout=30_000)
        mutations.append("document-analysis withdrawal and purge")

        # CompanyA-style connector: independent approval, representative consent and observed registration.
        vendor = new_page(browser, "Vendor partner", "vendor-connector-create")
        open_sales(vendor, "Onboarding connectors")
        form = vendor.locator("form").filter(has_text="Configure a CompanyA-style onboarding connector")
        promotion = form.locator('select[name="promotionId"]')
        assert promotion.locator("option").count() > 1, "No active approved promotion available for connector browser acceptance"
        promotion.select_option(index=1)
        form.get_by_label("Connector name", exact=True).fill(CONNECTOR)
        form.get_by_role("button", name="Create controlled connector", exact=True).click()
        connector_record(vendor).wait_for(timeout=30_000)
        mutations.append("vendor connector draft")

        ops = new_page(browser, "Operations", "operations-connector-review")
        open_sales(ops, "Onboarding connectors")
        select_connector(ops)
        connector_record(ops).get_by_role("button", name="Approve connector", exact=True).click()
        connector_record(ops).get_by_role("button", name="Activate sandbox connector", exact=True).wait_for(timeout=30_000)
        connector_record(ops).get_by_role("button", name="Activate sandbox connector", exact=True).click()
        connector_record(ops).get_by_text("active", exact=True).wait_for(timeout=30_000)
        mutations.append("independent connector approval and sandbox activation")

        vendor = new_page(browser, "Vendor partner", "vendor-handoff")
        open_sales(vendor, "Onboarding connectors")
        select_connector(vendor)
        form = vendor.locator("form").filter(has_text="Select a student representative")
        rep_select = form.locator('select[name="repId"]')
        if rep_select.locator("option").filter(has_text="KF-UNILAG-0002").count():
            select_option_by_text(rep_select, "KF-UNILAG-0002")
        form.get_by_role("button", name="Create consented handoff", exact=True).click()
        vendor.locator(".innovation-record").filter(has_text="representative-handoff-v1").first.wait_for(timeout=30_000)
        mutations.append("consented representative handoff")

        rep = new_page(browser, "Team rep", "representative-handoff", width=390, height=844)
        open_sales(rep, "Onboarding connectors")
        select_connector(rep)
        rep.get_by_role("button", name="Accept & create signed link", exact=True).click()
        rep.locator(".promotion-link-result").wait_for(timeout=30_000)
        assert "/p/" in rep.locator(".promotion-link-result input").input_value()
        screenshot(rep, "representative-signed-connector-link-mobile.png")
        mutations.append("representative acceptance and signed first-touch link")

        vendor = new_page(browser, "Vendor partner", "vendor-observed-progress")
        open_sales(vendor, "Onboarding connectors")
        select_connector(vendor)
        form = vendor.locator("form").filter(has_text="Record signed sandbox progress")
        form.locator('select[name="stage"]').select_option("registered")
        form.locator('input[name="externalEventKey"]').fill(f"browser-registration-{STAMP}")
        form.locator('input[name="externalCustomerRef"]').fill(f"browser-customer-{STAMP}")
        form.get_by_role("button", name="Record & verify through existing ingestion", exact=True).click()
        event = vendor.locator(".innovation-record").filter(has_text="registered").first
        event.wait_for(timeout=30_000)
        assert "Deal none" in event.inner_text()
        assert "observed" in event.inner_text()
        screenshot(vendor, "vendor-connector-observed-progress-desktop.png")
        mutations.append("observed registration with no deal")

        # Recurrence is executable by Operations but read-only for Finance.
        ops = new_page(browser, "Operations", "operations-recurrence")
        open_sales(ops, "Renewal evidence")
        ops.get_by_role("button", name="Run recurrence evidence sweep", exact=True).click()
        wait_saved(ops)
        message = ops.locator(".innovation-success").last.inner_text()
        assert "0 deals and 0 ledger entries" in message
        assert "Fixed economics" in ops.locator(".recurrence-controls").inner_text()
        screenshot(ops, "operations-recurrence-desktop.png")
        mutations.append("recurrence sweep with zero financial creation")

        lead = new_page(browser, "Campus Lead", "campus-lead", width=390, height=844)
        open_sales(lead, "Opportunity ATS")
        select_feature(lead, "Institutional governance")
        select_programme(lead)
        assert lead.get_by_role("button", name="Save governance draft", exact=True).count() == 0
        assert lead.get_by_role("button", name="Approve governance", exact=True).count() == 0
        screenshot(lead, "campus-lead-governance-scope-mobile.png")

        finance = new_page(browser, "Finance", "finance", width=1280, height=900)
        open_sales(finance, "Renewal evidence")
        assert finance.get_by_role("button", name="Run recurrence evidence sweep", exact=True).count() == 0
        assert finance.locator(".recurrence-workspace form").count() == 0
        screenshot(finance, "finance-recurrence-read-only-desktop.png")
        open_sales(finance, "Opportunity ATS")
        finance.locator(".innovation-feature-nav > button").first.wait_for(timeout=15_000)
        assert finance.locator(".innovation-feature-nav > button").count() == 3
        for label in ["Portfolio & analytics", "Campaign studio", "Verified outcomes"]:
            select_feature(finance, label)
            assert finance.locator(".innovation-inspector form").count() == 0
            assert "@" not in finance.locator(".innovation-inspector").inner_text()
        screenshot(finance, "finance-ats-read-only-desktop.png")

        # Cold mobile layout pass over every new Operations inspector.
        ops.set_viewport_size({"width": 375, "height": 812})
        open_sales(ops, "Opportunity ATS")
        for label in ["Portfolio & analytics", "Institutional governance", "Documents & intelligence"]:
            select_feature(ops, label)
        screenshot(ops, "operations-phase19-mobile.png")
    finally:
        for context in contexts:
            context.close()
        browser.close()

assert not errors, "\n".join(errors)
assert not external_requests, "\n".join(external_requests)
REPORT.update({
    "status": "passed",
    "browserMutations": mutations,
    "desktopAndMobileFeatureChecks": len(checks),
    "institutionalGovernanceWorkflow": True,
    "documentStorageFixtureReviewAndWithdrawal": True,
    "connectorHandoffSignedLinkAndObservedProgress": True,
    "recurrenceSweepCreatedNoFinance": True,
    "campusLeadScope": True,
    "financeAggregateReadOnlyWithoutContacts": True,
    "pageOverflow": False,
    "runtimeErrors": 0,
    "httpErrors": 0,
    "externalRequests": 0,
    "evidenceDirectory": str(EVIDENCE_DIR),
})
(EVIDENCE_DIR / "report.json").write_text(json.dumps(REPORT, indent=2))
print(json.dumps(REPORT, indent=2))
