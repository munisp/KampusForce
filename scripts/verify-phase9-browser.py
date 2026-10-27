#!/usr/bin/env python3
"""Phase 9 production-browser acceptance. Requires Python Playwright and Chromium."""

import json
import os
import random
import re
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("KF_BROWSER_BASE_URL", "http://127.0.0.1:3000")
EVIDENCE_DIR = Path(os.environ.get("KF_BROWSER_EVIDENCE_DIR", "/tmp/kampusforce-phase9"))
EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
REPORT = {
    "mode": "local_sandbox_production_browser",
    "boundary": "Local sandbox measurements; not a device lab, staging, production, provider-capacity or campus-rollout certification.",
}


def login(page, workspace):
    page.goto(BASE_URL, wait_until="networkidle")
    page.get_by_role("button", name=re.compile(workspace)).click()
    page.wait_for_url(re.compile(r"/(rep|vendor|ops)$"), timeout=30_000)
    page.locator(".workspace-shell").wait_for()


def assisted_onboarding(browser, errors):
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    page = context.new_page()
    page.on("pageerror", lambda error: errors.append(f"assist pageerror: {error}"))
    cdp = context.new_cdp_session(page)
    cdp.send("Network.enable")
    cdp.send("Network.emulateNetworkConditions", {
        "offline": False,
        "latency": 400,
        "downloadThroughput": 62_500,
        "uploadThroughput": 62_500,
    })
    cdp.send("Emulation.setCPUThrottlingRate", {"rate": 4})
    started = time.monotonic()
    login(page, "Team rep")
    page.get_by_role("link", name="Assisted onboarding").click()
    page.get_by_role("button", name="Record consent & start").wait_for(timeout=60_000)
    page.get_by_label("Customer phone").fill(f"080{random.randint(10_000_000, 99_999_999)}")
    page.get_by_role("checkbox").check()
    page.get_by_role("button", name="Record consent & start").click()
    for step in range(1, 6):
        page.get_by_role("heading", name=f"Step {step} of 6").wait_for(timeout=60_000)
        label = "Complete handoff" if step == 5 else "Mark step complete"
        page.get_by_role("button", name=label).click()
    page.get_by_text("HANDOFF COMPLETE", exact=True).wait_for(timeout=60_000)
    page.get_by_role("button", name="Start another session").wait_for()
    elapsed = time.monotonic() - started
    page.screenshot(path=str(EVIDENCE_DIR / "assisted-onboarding-complete.png"), full_page=True)
    assert elapsed < 600, f"Assisted onboarding exceeded ten minutes: {elapsed:.2f}s"
    REPORT["assistedOnboarding"] = {
        "status": "passed",
        "elapsedSeconds": round(elapsed, 2),
        "targetSeconds": 600,
        "profile": {"roundTripLatencyMs": 400, "downloadKbps": 500, "uploadKbps": 500, "cpuThrottle": 4},
        "stepsCompleted": 6,
    }
    context.close()


def offline_and_logout(browser, errors):
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    page = context.new_page()
    page.on("pageerror", lambda error: errors.append(f"offline pageerror: {error}"))
    login(page, "Team rep")
    page.evaluate("navigator.serviceWorker.ready.then(() => true)")
    page.get_by_role("link", name="Product catalog").click()
    page.locator(".product-card").first.wait_for(timeout=30_000)
    warmed_products = page.locator(".product-card").count()
    assert warmed_products > 0
    page.get_by_role("link", name="Earnings ledger").click()
    page.wait_for_function("localStorage.getItem('kf_private_snapshot:earnings') !== null", timeout=30_000)
    page.wait_for_timeout(1_000)

    context.set_offline(True)
    page.reload(wait_until="domcontentloaded")
    page.get_by_text("Offline earnings snapshot.", exact=True).wait_for(timeout=60_000)
    assert page.get_by_title("Open dispute").count() == 0
    page.screenshot(path=str(EVIDENCE_DIR / "offline-earnings.png"), full_page=True)

    page.get_by_role("link", name="Product catalog").click()
    page.get_by_text("Offline catalog.", exact=True).wait_for(timeout=60_000)
    assert page.locator(".product-card").count() == warmed_products
    assert page.get_by_role("link", name=re.compile("Share this offer")).count() == 0
    disabled_sharing = page.get_by_role("button", name="Sharing requires a connection").count()
    assert disabled_sharing == warmed_products
    page.screenshot(path=str(EVIDENCE_DIR / "offline-catalog.png"), full_page=True)

    context.set_offline(False)
    page.get_by_role("button", name="Switch workspace").first.click()
    page.wait_for_url(BASE_URL + "/", timeout=30_000)
    assert page.evaluate("localStorage.getItem('kf_private_snapshot:earnings')") is None
    REPORT["offline"] = {
        "status": "passed",
        "earningsSnapshotRecoveredAfterReload": True,
        "disputeActionsVisible": 0,
        "catalogProductsRecovered": warmed_products,
        "disabledSharingActions": disabled_sharing,
        "privateSnapshotClearedOnLogout": True,
    }
    context.close()


def vendor_rotation(browser, errors):
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    page = context.new_page()
    page.on("pageerror", lambda error: errors.append(f"vendor pageerror: {error}"))
    login(page, "Vendor partner")
    panel = page.locator(".panel").filter(has_text="Webhook reliability")
    panel.wait_for(timeout=30_000)
    match = re.search(r"Key v(\d+)", panel.inner_text())
    assert match, "Current webhook key version not shown"
    previous_version = int(match.group(1))
    panel.get_by_role("button", name="Rotate webhook credential").click()
    panel.get_by_role("button", name="Rotate credential", exact=True).click()
    secret_input = panel.get_by_label("One-time webhook secret")
    secret_input.wait_for(timeout=30_000)
    assert len(secret_input.input_value()) == 96
    assert f"KEY V{previous_version + 1}" in panel.inner_text()
    panel.get_by_role("button", name="Dismiss one-time secret").click()
    secret_input.wait_for(state="detached")
    panel.get_by_text(f"Key v{previous_version + 1}", exact=False).first.wait_for(timeout=30_000)
    page.screenshot(path=str(EVIDENCE_DIR / "vendor-rotation-dismissed.png"), full_page=True)
    REPORT["vendorCredentialRotation"] = {
        "status": "passed",
        "previousVersion": previous_version,
        "newVersion": previous_version + 1,
        "oneTimeSecretDisplayed": True,
        "secretDismissed": True,
        "secretIncludedInReport": False,
    }
    context.close()


def mobile_layout(browser, errors):
    context = browser.new_context(viewport={"width": 375, "height": 812}, is_mobile=True)
    page = context.new_page()
    page.on("pageerror", lambda error: errors.append(f"mobile pageerror: {error}"))
    login(page, "Team rep")
    page.goto(BASE_URL + "/rep/earnings", wait_until="networkidle")
    page.get_by_role("heading", name="The commission ledger, line by line.").wait_for(timeout=30_000)
    dimensions = page.evaluate("({viewport: window.innerWidth, document: document.documentElement.scrollWidth})")
    assert dimensions["document"] <= dimensions["viewport"] + 1, dimensions
    page.screenshot(path=str(EVIDENCE_DIR / "mobile-earnings-375.png"), full_page=True)
    REPORT["mobile"] = {"status": "passed", "viewportWidth": dimensions["viewport"], "documentWidth": dimensions["document"]}
    context.close()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    errors = []
    try:
        assisted_onboarding(browser, errors)
        offline_and_logout(browser, errors)
        vendor_rotation(browser, errors)
        mobile_layout(browser, errors)
    finally:
        browser.close()

REPORT["browserRuntimeErrors"] = errors
REPORT["status"] = "passed" if not errors else "failed"
print(json.dumps(REPORT, indent=2))
assert not errors, errors
