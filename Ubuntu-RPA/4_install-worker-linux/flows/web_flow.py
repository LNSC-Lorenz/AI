"""
Web Automation Flow
Runs on Windows RPA Agent via Prefect Worker.
Uses Playwright for browser automation.
"""

from prefect import flow, task, get_run_logger
from playwright.sync_api import sync_playwright
from typing import Optional
import json


@task(retries=2, retry_delay_seconds=5)
def web_login(
    url: str,
    username: str,
    password: str,
    username_selector: str = "#username",
    password_selector: str = "#password",
    submit_selector: str = "button[type='submit']",
) -> dict:
    """Login to a web application."""
    logger = get_run_logger()
    logger.info(f"Logging in to: {url}")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(url, wait_until="networkidle")
        page.fill(username_selector, username)
        page.fill(password_selector, password)
        page.click(submit_selector)
        page.wait_for_load_state("networkidle")

        # Store cookies for session reuse
        cookies = page.context.cookies()
        current_url = page.url
        browser.close()

    logger.info(f"Login successful, redirected to: {current_url}")
    return {"url": current_url, "cookies": cookies}


@task(retries=1)
def web_scrape_table(
    url: str,
    table_selector: str = "table",
    cookies: Optional[list] = None,
) -> list:
    """Scrape a table from a web page."""
    logger = get_run_logger()
    logger.info(f"Scraping table from: {url}")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()

        if cookies:
            context.add_cookies(cookies)

        page = context.new_page()
        page.goto(url, wait_until="networkidle")

        # Extract table data
        rows = page.query_selector_all(f"{table_selector} tr")
        data = []
        for row in rows:
            cells = row.query_selector_all("td, th")
            data.append([cell.inner_text() for cell in cells])

        browser.close()

    logger.info(f"Scraped {len(data)} rows")
    return data


@task
def web_fill_form(
    url: str,
    form_data: dict,
    submit_selector: str = "button[type='submit']",
    cookies: Optional[list] = None,
) -> dict:
    """Fill and submit a web form."""
    logger = get_run_logger()
    logger.info(f"Filling form at: {url}")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()

        if cookies:
            context.add_cookies(cookies)

        page = context.new_page()
        page.goto(url, wait_until="networkidle")

        for selector, value in form_data.items():
            page.fill(selector, value)

        page.click(submit_selector)
        page.wait_for_load_state("networkidle")

        result_url = page.url
        browser.close()

    logger.info(f"Form submitted, result page: {result_url}")
    return {"submitted": True, "result_url": result_url}


@flow(name="web-automation-flow", log_prints=True)
def web_automation_flow(
    url: str = "https://example.com/login",
    username: str = "",
    password: str = "",
    action: str = "login",
):
    """Main web automation flow."""
    login_result = web_login(url=url, username=username, password=password)
    print(f"Login result: {login_result['url']}")

    if action == "scrape":
        data = web_scrape_table(url=url, cookies=login_result["cookies"])
        print(f"Scraped {len(data)} rows")
        return data

    return login_result


if __name__ == "__main__":
    web_automation_flow()
