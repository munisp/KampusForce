#!/usr/bin/env python3
"""Production-browser acceptance for audit privacy, reporting and offline-shell fixes."""

import base64
import json
import os
import random
import re
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE_URL = os.environ.get("KF_BROWSER_BASE_URL", "http://127.0.0.1:3000")
EVIDENCE_DIR = Path(os.environ.get("KF_BROWSER_EVIDENCE_DIR", "/tmp/kampusforce-audit-browser"))
EVIDENCE_DIR.mkdir(parents=True, exist_ok=True)
REPORT = {
    "mode": "local_sandbox_production_browser",
    "boundary": "Local sandbox evidence only; not production, provider, device-lab or campus-outcome certification.",
}


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    try:
        page.goto(BASE_URL + "/implementation", wait_until="networkidle")
        page.get_by_text("Phase 19 · post-audit implementation record", exact=True).wait_for()
        page.get_by_text("False", exact=True).wait_for()
        content = page.locator("body").inner_text()
        assert "Phase 12" not in content
        assert "66 unit tests" not in content
        assert "No invented score." in content
        page.screenshot(path=str(EVIDENCE_DIR / "implementation-register.png"), full_page=True)
        REPORT["implementationRegister"] = {"currentPhase": 19, "stalePhase12": False, "productionReady": False}

        page.goto(BASE_URL, wait_until="networkidle")
        page.get_by_role("button", name=re.compile("Team rep")).click()
        page.wait_for_url(re.compile(r"/rep$"), timeout=30_000)
        page.get_by_role("link", name="Product catalog").click()
        page.get_by_role("link", name=re.compile("Share this offer")).first.click()
        customer_phone = f"080{random.randint(10_000_000, 99_999_999)}"
        page.get_by_label("Customer phone").fill(customer_phone)
        page.get_by_role("button", name="Generate signed kit").click()
        share_input = page.locator(".copy-field input")
        share_input.wait_for(timeout=30_000)
        share_url = share_input.input_value()
        assert "phone=" not in share_url
        assert customer_phone not in share_url
        assert not re.search(r"\+234|\d{10,}", share_url.split("?", 1)[-1])
        page.screenshot(path=str(EVIDENCE_DIR / "privacy-preserving-share.png"), full_page=True)
        REPORT["sharePrivacy"] = {"rawPhoneInUrl": False, "phoneQueryParameter": False}

        page.evaluate("navigator.serviceWorker.ready.then(() => true)")

        # Service-worker navigation requests do not reliably pass through
        # Playwright's context.route(). Intercept at Chromium's network layer so
        # the test never depends on the real external vendor documentation page.
        cdp = context.new_cdp_session(page)
        cdp.send("Fetch.enable", {"patterns": [{"urlPattern": "*", "requestStage": "Request"}]})

        def poison_vendor(event):
            if event["request"]["url"].startswith("https://example.com/"):
                cdp.send("Fetch.fulfillRequest", {
                    "requestId": event["requestId"],
                    "responseCode": 200,
                    "responseHeaders": [{"name": "Content-Type", "value": "text/html; charset=utf-8"}],
                    "body": base64.b64encode(
                        "<html><body>EXTERNAL VENDOR FIXTURE — NOT APP SHELL</body></html>".encode()
                    ).decode("ascii"),
                })
            else:
                cdp.send("Fetch.continueRequest", {"requestId": event["requestId"]})

        cdp.on("Fetch.requestPaused", poison_vendor)
        page.goto(share_url, wait_until="domcontentloaded")
        page.wait_for_timeout(1_000)
        if not page.get_by_text("EXTERNAL VENDOR FIXTURE — NOT APP SHELL", exact=True).count():
            raise AssertionError({"vendorHost": page.url.split("/")[2], "body": page.locator("body").inner_text()[:500]})
        page.get_by_text("EXTERNAL VENDOR FIXTURE — NOT APP SHELL", exact=True).wait_for()
        assert "kf_token=" in page.url
        assert "kf_rep=" in page.url
        assert "phone=" not in page.url

        page.goto(BASE_URL, wait_until="networkidle")
        cached_shell = page.evaluate("caches.match('/').then(response => response ? response.text() : '')")
        assert "EXTERNAL VENDOR FIXTURE" not in cached_shell
        context.set_offline(True)
        page.reload(wait_until="domcontentloaded")
        page.get_by_role("heading", name=re.compile("Every activation.")).wait_for(timeout=30_000)
        assert "EXTERNAL VENDOR FIXTURE" not in page.locator("body").inner_text()
        context.set_offline(False)
        REPORT["offlineShell"] = {"signedVendorTokenPresent": True, "externalRedirectCachedAsShell": False, "offlineApplicationRecovered": True}

        REPORT["browserRuntimeErrors"] = errors
        REPORT["status"] = "passed" if not errors else "failed"
        print(json.dumps(REPORT, indent=2))
        assert not errors, errors
    finally:
        context.close()
        browser.close()
