#!/usr/bin/env python3
"""Open a Phase 17 request-time attachment URL in Chromium and verify its bytes."""
import json
import sys
from pathlib import Path

from playwright.sync_api import Error, sync_playwright

metadata_path = Path(sys.argv[1])
metadata = json.loads(metadata_path.read_text())
downloads = []

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    try:
        context = browser.new_context(accept_downloads=True)
        page = context.new_page()
        page.on("download", lambda download: downloads.append(download))
        response = None
        try:
            response = page.goto(metadata["url"], wait_until="domcontentloaded", timeout=60_000)
        except Error as error:
            if "Download is starting" not in str(error) and not downloads:
                raise
        if downloads:
            failure = downloads[0].failure()
            assert failure is None, f"Browser attachment download failed: {failure}"
            download_path = downloads[0].path()
            assert download_path is not None, "Browser download did not produce a local file"
            actual = Path(download_path).read_bytes().decode("utf-8")
        elif response is not None:
            assert response.ok, f"Attachment URL returned HTTP {response.status}"
            actual = response.body().decode("utf-8")
        else:
            page.locator("body").wait_for(timeout=30_000)
            actual = page.locator("body").text_content() or ""
        verificationMethod = "navigation"
        if not actual:
            fallback = context.request.get(metadata["url"], timeout=60_000)
            assert fallback.ok, f"Browser request context returned HTTP {fallback.status}"
            actual = fallback.body().decode("utf-8")
            verificationMethod = "browser_request_context"
        assert metadata["expectedText"] in actual, (
            "Browser content did not match the uploaded attachment: "
            f"expected {metadata['expectedText']!r}, received {actual[:300]!r}, "
            f"download={bool(downloads)}, status={response.status if response else None}"
        )
        report = {
            "phase": 17,
            "storageBrowserContentMatched": True,
            "requestTimeUrlPersisted": False,
            "browserDownloadObserved": bool(downloads),
            "verificationMethod": verificationMethod,
        }
        metadata_path.with_suffix(".result.json").write_text(json.dumps(report, indent=2))
        print(json.dumps(report))
    finally:
        browser.close()
