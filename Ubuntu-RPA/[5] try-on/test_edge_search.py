r"""
浏览器自动化测试（单文件）：用 Playwright 驱动浏览器打开 Bing 搜索 lechler。

Usage (复制本文件到 Worker 的 flows 目录后执行):
    Windows: cd C:\RPA-Agent\flows
             C:\RPA-Agent\.venv\Scripts\python.exe test_edge_search.py

注册成功后:
    Prefect UI (http://10.86.180.120:4200) → Deployments → edge-search-flow/edge-search → Run

验证:
    截图保存在 C:\Temp\edge-search-lechler.png，记录追加到 C:\Temp\edge-search-proof.txt

注意:
    Worker 以 Windows 服务运行在非交互会话，浏览器窗口不会显示在桌面上，
    以截图作为执行证据。Edge 无法在 LocalSystem 服务账户下运行，会自动回退 Chromium。
"""

import platform
import socket
from datetime import datetime
from pathlib import Path

from prefect import flow, task, get_run_logger
from prefect.flows import Flow

WORK_POOL = "windows-rpa-pool" if platform.system() == "Windows" else "linux-rpa-pool"

FLOWS_DIR = Path(__file__).parent.resolve()

TEMP_DIR = Path(r"C:\Temp") if platform.system() == "Windows" else Path("/tmp")
SCREENSHOT_FILE = TEMP_DIR / "edge-search-lechler.png"
PROOF_FILE = TEMP_DIR / "edge-search-proof.txt"

SEARCH_URL = "https://cn.bing.com"
SEARCH_TERM = "lechler"


@task(retries=1, retry_delay_seconds=10)
def edge_search(term: str) -> dict:
    """启动浏览器 → 打开 Bing → 搜索关键词 → 截图。"""
    logger = get_run_logger()
    from playwright.sync_api import sync_playwright

    TEMP_DIR.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        # 优先 Edge（channel="msedge"）；但 Edge 无法在 LocalSystem 服务账户下运行
        # （立即退出 exitCode=1002），失败则回退到 Playwright 自带 Chromium
        try:
            browser = p.chromium.launch(channel="msedge", headless=True)
            logger.info("Browser: Microsoft Edge")
        except Exception as e:
            logger.warning(f"Edge launch failed ({type(e).__name__}), falling back to bundled Chromium")
            browser = p.chromium.launch(headless=True)
            logger.info("Browser: bundled Chromium")
        page = browser.new_page(viewport={"width": 1440, "height": 900})

        logger.info(f"Opening {SEARCH_URL} ...")
        page.goto(SEARCH_URL, timeout=30000)

        # Bing 搜索框（input[name=q]），输入关键词并回车
        box = page.locator("input[name='q']")
        box.wait_for(timeout=10000)
        box.fill(term)
        box.press("Enter")

        # 等待搜索结果；失败不报错，无论如何都截图留存实际看到的页面，便于诊断
        try:
            page.wait_for_selector("#b_results", timeout=15000)
            status = "ok"
        except Exception:
            status = "results-not-found"
            logger.warning(f"Results selector not found, current URL: {page.url}")

        page.wait_for_load_state("domcontentloaded")
        title = page.title()
        url = page.url
        logger.info(f"Status: {status}, title: {title}, url: {url}")

        page.screenshot(path=str(SCREENSHOT_FILE), full_page=False)
        logger.info(f"Screenshot saved: {SCREENSHOT_FILE}")

        browser.close()

    return {"status": status, "title": title, "url": url, "screenshot": str(SCREENSHOT_FILE)}


@task
def write_proof(result: dict) -> str:
    """写入本地证据文件。"""
    logger = get_run_logger()
    line = (
        f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] "
        f"edge-search ran on {socket.gethostname()}, "
        f"status = {result['status']}, title = {result['title']}, "
        f"url = {result['url']}, screenshot = {result['screenshot']}\n"
    )
    with open(PROOF_FILE, "a", encoding="utf-8") as f:
        f.write(line)
    logger.info(f"Proof file written: {PROOF_FILE}")
    return str(PROOF_FILE)


def _run_name() -> str:
    """自定义 Flow Run 名（默认是随机的“形容词-动物”）。"""
    return f"edge-search-{datetime.now():%m%d-%H%M%S}"


@flow(name="edge-search-flow", flow_run_name=_run_name, log_prints=True)
def edge_search_flow(term: str = SEARCH_TERM):
    """浏览器自动化验证 Flow：Bing 搜索 + 截图。"""
    result = edge_search(term)
    proof = write_proof(result)
    print(f"Searched '{term}', page title: {result['title']}")
    print(f"Screenshot: {result['screenshot']}")
    print(f"Proof file: {proof}")
    return {**result, "proof": proof}


def deploy():
    Flow.from_source(
        source=str(FLOWS_DIR),
        entrypoint="test_edge_search.py:edge_search_flow",
    ).deploy(
        name="edge-search",
        work_pool_name=WORK_POOL,
        tags=["try-on", "test", "browser"],
    )
    print("Deployed: edge-search-flow/edge-search")
    print(f"Work pool: {WORK_POOL}")
    print(f"Code path: {FLOWS_DIR}")
    print("Trigger it from Prefect UI -> Deployments -> edge-search -> Run")
    print(f"After the run, check screenshot: {SCREENSHOT_FILE}")


if __name__ == "__main__":
    deploy()
