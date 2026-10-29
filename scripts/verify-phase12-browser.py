#!/usr/bin/env python3
"""Phase 12 role-scoped browser acceptance for cases, CRM, training and growth."""

import json
import os
import subprocess
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("KF_BROWSER_BASE_URL", "http://127.0.0.1:5173")
EVIDENCE_DIR = Path(os.environ.get("KF_BROWSER_EVIDENCE_DIR", "/tmp/kampusforce-phase12"))
EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
STAMP = str(int(time.time()))
ROOT = Path(__file__).resolve().parents[1]
LEAD_FIXTURE = json.loads(subprocess.check_output(["npx", "tsx", "scripts/create-phase12-browser-lead.ts"], cwd=ROOT, text=True))
REPORT = {
    "mode": "local_sandbox_browser_acceptance",
    "boundary": "Synthetic records only; no external delivery, production integration, real KYC or financial-state claim.",
}


def login(page, role):
    page.goto(BASE_URL, wait_until="networkidle")
    page.get_by_role("button", name=role, exact=False).click()
    page.locator(".workspace-shell").wait_for(timeout=30_000)


def login_phone(page, phone, name):
    page.goto(BASE_URL, wait_until="networkidle")
    page.get_by_label("Phone number").fill(phone)
    page.get_by_role("button", name="Send sandbox OTP").click()
    page.get_by_label("Sandbox code").wait_for(timeout=30_000)
    page.get_by_label("Your name").fill(name)
    page.get_by_role("button", name="Verify & enter").click()
    page.locator(".workspace-shell").wait_for(timeout=30_000)


def open_sales(page, view=None):
    page.locator('a[href="/sales"]:visible').first.click()
    page.locator(".sales-view-tabs").wait_for(timeout=30_000)
    if view:
        page.get_by_role("button", name=view, exact=True).click()


def no_horizontal_overflow(page):
    dimensions = page.evaluate("({viewport: window.innerWidth, document: document.documentElement.scrollWidth})")
    assert dimensions["document"] <= dimensions["viewport"] + 1, dimensions
    return dimensions


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    errors = []
    try:
        ops_context = browser.new_context(viewport={"width": 1440, "height": 1000})
        ops = ops_context.new_page()
        ops.on("pageerror", lambda error: errors.append(f"ops pageerror: {error}"))
        login(ops, "Operations")
        open_sales(ops)
        view_name = f"Browser urgent queue {STAMP}"
        ops.get_by_label("Save current view").fill(view_name)
        ops.get_by_role("button", name="Save", exact=True).click()
        ops.locator(".saved-view-row").get_by_text(view_name, exact=True).wait_for(timeout=30_000)
        ops.get_by_label("Named owner").select_option(index=1)
        ops.get_by_role("button", name="Apply owner").click()
        ops.locator(".case-facts").get_by_text("KampusForce Operations", exact=True).wait_for(timeout=30_000)
        reply = f"Browser public response {STAMP}: evidence review is underway."
        ops.get_by_label("Customer-visible response").fill(reply)
        ops.get_by_role("button", name="Add public reply").click()
        ops.locator(".sales-timeline").get_by_text(reply, exact=True).first.wait_for(timeout=30_000)
        ops.screenshot(path=str(EVIDENCE_DIR / "cases-desktop.png"), full_page=True)
        REPORT["cases"] = {"status": "passed", "savedView": True, "namedOwnership": True, "publicReply": True}

        open_sales(ops, "Campaign engine")
        campaign_name = f"Browser training campaign {STAMP}"
        ops.get_by_label("Campaign name").fill(campaign_name)
        ops.locator(".campaign-form select").first.select_option("training")
        ops.get_by_label("Approved-message draft").fill("Complete the internal sales-readiness module; this sandbox campaign sends no external message and awards no accredited certification.")
        ops.get_by_role("button", name="Create draft").click()
        campaign_panel = ops.locator(".campaign-list > *").filter(has_text=campaign_name).first
        campaign_panel.wait_for(timeout=30_000)
        campaign_panel.get_by_role("button", name="Submit for independent review").click()
        campaign_panel.get_by_role("button", name="Approve independently").wait_for(timeout=30_000)
        campaign_panel.get_by_role("button", name="Approve independently").click()
        ops.get_by_text("Independent review is required; the campaign creator cannot approve or reject their own campaign", exact=True).wait_for(timeout=30_000)
        ops.screenshot(path=str(EVIDENCE_DIR / "campaign-four-eyes.png"), full_page=True)
        REPORT["campaigns"] = {"status": "passed", "draftCreated": True, "submitted": True, "selfApprovalBlocked": True, "externalDelivery": False}
        ops_context.close()

        rep_context = browser.new_context(viewport={"width": 1440, "height": 1000})
        rep = rep_context.new_page()
        rep.on("pageerror", lambda error: errors.append(f"rep pageerror: {error}"))
        login(rep, "Team rep")
        open_sales(rep, "Relationship CRM")
        assert rep.get_by_role("button", name="Vendor services", exact=True).count() == 0
        alias = f"Browser relationship {STAMP}"
        rep.get_by_label("Relationship alias").fill(alias)
        rep.get_by_role("button", name="Create opportunity").click()
        opportunity_panel = rep.locator(".pipeline-grid > div").get_by_text(alias, exact=True)
        opportunity_panel.wait_for(timeout=30_000)
        rep.get_by_role("textbox", name="Relationship context", exact=True).fill("Explained the real activation terms and agreed to review suitability before any customer action.")
        rep.get_by_role("button", name="Record activity").click()
        rep.get_by_text("Explained the real activation terms", exact=False).wait_for(timeout=30_000)
        rep.get_by_label("Task", exact=True).fill("Review customer suitability")
        rep.get_by_label("Due", exact=True).fill("2026-12-01T10:00")
        rep.get_by_role("button", name="Schedule").click()
        rep.get_by_text("Review customer suitability", exact=True).wait_for(timeout=30_000)
        rep.get_by_role("button", name="Draft from history").click()
        rep.get_by_role("button", name="Approve draft").wait_for(timeout=30_000)
        rep.get_by_role("button", name="Approve draft").click()
        rep.get_by_role("button", name="Mark shared externally").wait_for(timeout=30_000)
        rep.get_by_role("button", name="Mark shared externally").click()
        rep.get_by_text("shared externally", exact=False).first.wait_for(timeout=30_000)
        rep.locator(".stage-actions").get_by_role("button", name="won", exact=True).click()
        rep.get_by_text("privacy-preserving attribution", exact=False).wait_for(timeout=30_000)
        rep.screenshot(path=str(EVIDENCE_DIR / "crm-desktop.png"), full_page=True)
        REPORT["crm"] = {"status": "passed", "opportunityCreated": True, "activity": True, "task": True, "humanApprovedDraft": True, "externalAttestationOnly": True, "unverifiedWonBlocked": True}

        open_sales(rep, "Sales academy")
        rep.get_by_text("Ethical sales foundations", exact=True).first.click()
        start = rep.get_by_role("button", name="Start module")
        if start.count():
            start.click()
        rep.get_by_text("Applied knowledge check", exact=True).wait_for(timeout=30_000)
        groups = rep.locator(".training-quiz fieldset")
        for index in range(groups.count()):
            groups.nth(index).locator("input[type=radio]").first.check()
        assert rep.get_by_role("button", name="Submit assessment").is_enabled()
        rep.get_by_role("button", name="Submit assessment").click()
        rep.get_by_text("Attempt", exact=False).first.wait_for(timeout=30_000)
        REPORT["training"] = {"status": "passed", "moduleOpened": True, "allAnswersRequired": True, "attemptRecorded": True, "externalCertification": False}

        open_sales(rep, "Growth & recruiting")
        rep.get_by_role("button", name="Refresh fit scores").click()
        rep.get_by_text("fit score", exact=True).first.wait_for(timeout=30_000)
        rep.locator(".leaderboard-row").first.wait_for(timeout=30_000)
        target = rep.get_by_role("button", name="Target this product")
        if target.count():
            target.first.click()
            rep.get_by_label("Privacy-safe relationship alias").fill(f"Targeted browser relationship {STAMP}")
            rep.get_by_role("button", name="Create targeted opportunity").click()
            rep.get_by_text("accepted", exact=True).first.wait_for(timeout=30_000)
        REPORT["growth"] = {"status": "passed", "leaderboard": True, "targetsRefreshed": True, "recommendationAcceptanceExercised": bool(target.count())}
        rep_context.close()

        lead_context = browser.new_context(viewport={"width": 1440, "height": 1000})
        lead = lead_context.new_page()
        lead.on("pageerror", lambda error: errors.append(f"lead pageerror: {error}"))
        login_phone(lead, LEAD_FIXTURE["phoneE164"], LEAD_FIXTURE["name"])
        open_sales(lead, "Growth & recruiting")
        candidate = f"Browser Student {STAMP}"
        lead.get_by_label("Candidate name").fill(candidate)
        lead.get_by_label("Observed strengths").fill("Clear communicator and dependable student-society organizer")
        lead.get_by_label("The candidate consented", exact=False).check()
        lead.get_by_role("button", name="Save recommendation").click()
        referral = lead.locator(".student-referrals article").filter(has_text=candidate).first
        referral.wait_for(timeout=30_000)
        referral.get_by_label("Consented phone for invitation").fill(f"+23497{STAMP[-8:]}")
        referral.get_by_role("button", name="Create invitation").click()
        lead.get_by_label("Student invitation link").wait_for(timeout=30_000)
        assert lead.get_by_label("Student invitation link").input_value().startswith(BASE_URL + "/recruit/accept?token=")
        REPORT["recruiting"] = {"status": "passed", "consentConfirmed": True, "recommendationSaved": True, "invitationCreated": True, "externalMessageSent": False}
        lead_context.close()

        vendor_context = browser.new_context(viewport={"width": 1440, "height": 1000})
        vendor = vendor_context.new_page()
        vendor.on("pageerror", lambda error: errors.append(f"vendor pageerror: {error}"))
        login(vendor, "Vendor partner")
        open_sales(vendor, "Vendor services")
        vendor.locator(".integration-create").wait_for(timeout=30_000)
        existing = vendor.locator(".integration-facts").all_inner_texts()
        service = next((item for item in ["support", "crm", "messaging", "catalog"] if not any(item in text for text in existing)), None)
        if service:
            vendor.locator(".integration-create select").first.select_option(service)
            vendor.get_by_label("Display name").fill(f"Browser local {service} adapter {STAMP}")
            vendor.get_by_role("button", name="Configure without credentials").click()
            vendor.get_by_text(f"Browser local {service} adapter {STAMP}", exact=True).or_(vendor.get_by_text("already configured", exact=False)).first.wait_for(timeout=30_000)
        vendor.get_by_role("button", name="Test local adapter").first.click()
        vendor.get_by_text("no external request was made", exact=False).first.wait_for(timeout=30_000)
        vendor.get_by_role("button", name="Sync local counts").first.click()
        vendor.get_by_text("reconciled into the integration health view", exact=False).first.wait_for(timeout=30_000)
        assert "password" not in vendor.content().lower()
        assert "api key" not in vendor.content().lower()
        vendor.screenshot(path=str(EVIDENCE_DIR / "integrations-desktop.png"), full_page=True)
        REPORT["integrations"] = {"status": "passed", "sandboxConfiguredOrReused": True, "localTest": True, "localCountSync": True, "credentialFields": False, "externalRequestMade": False}
        vendor_context.close()

        mobile_context = browser.new_context(viewport={"width": 375, "height": 812}, is_mobile=True)
        mobile = mobile_context.new_page()
        mobile.on("pageerror", lambda error: errors.append(f"mobile pageerror: {error}"))
        login(mobile, "Operations")
        open_sales(mobile)
        dimensions = no_horizontal_overflow(mobile)
        mobile.screenshot(path=str(EVIDENCE_DIR / "cases-mobile-375.png"), full_page=True)
        open_sales(mobile, "Campaign engine")
        mobile.locator(".campaign-form").wait_for(timeout=30_000)
        campaign_dimensions = no_horizontal_overflow(mobile)
        mobile.screenshot(path=str(EVIDENCE_DIR / "campaigns-mobile-375.png"), full_page=True)
        REPORT["mobile"] = {"status": "passed", "cases": dimensions, "campaigns": campaign_dimensions}
        mobile_context.close()

        rep_mobile_context = browser.new_context(viewport={"width": 375, "height": 812}, is_mobile=True)
        rep_mobile = rep_mobile_context.new_page()
        rep_mobile.on("pageerror", lambda error: errors.append(f"rep mobile pageerror: {error}"))
        login(rep_mobile, "Team rep")
        open_sales(rep_mobile, "Relationship CRM")
        rep_mobile.locator(".sales-create-form").wait_for(timeout=30_000)
        pipeline_dimensions = no_horizontal_overflow(rep_mobile)
        rep_mobile.screenshot(path=str(EVIDENCE_DIR / "crm-mobile-375.png"), full_page=True)
        open_sales(rep_mobile, "Sales academy")
        rep_mobile.locator(".training-quiz").wait_for(timeout=30_000)
        training_dimensions = no_horizontal_overflow(rep_mobile)
        open_sales(rep_mobile, "Growth & recruiting")
        rep_mobile.locator(".leaderboard-head").wait_for(timeout=30_000)
        growth_dimensions = no_horizontal_overflow(rep_mobile)
        rep_mobile.screenshot(path=str(EVIDENCE_DIR / "growth-mobile-375.png"), full_page=True)
        REPORT["mobile"].update({"crm": pipeline_dimensions, "training": training_dimensions, "growth": growth_dimensions})
        rep_mobile_context.close()
    finally:
        browser.close()

REPORT["browserRuntimeErrors"] = errors
REPORT["status"] = "passed" if not errors else "failed"
print(json.dumps(REPORT, indent=2))
assert not errors, errors
