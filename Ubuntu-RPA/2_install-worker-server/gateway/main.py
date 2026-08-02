"""
RPA Platform — FastAPI Gateway
Provides API endpoints for Vue3 frontend and external triggers.
"""

import re
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional
import httpx

from config import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.http_client = httpx.AsyncClient(
        base_url=settings.PREFECT_API_URL,
        timeout=30.0,
    )
    yield
    await app.state.http_client.aclose()


app = FastAPI(
    title="RPA Gateway",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Job 包存储目录（Worker 通过 /packages/<file> 下载）
PACKAGES_DIR = Path(settings.PACKAGES_DIR)
PACKAGES_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/packages", StaticFiles(directory=str(PACKAGES_DIR)), name="packages")


# --- Models ---

class TriggerJobRequest(BaseModel):
    deployment_name: str
    parameters: Optional[dict] = None


class JobResponse(BaseModel):
    flow_run_id: str
    status: str


class DispatchRequest(BaseModel):
    package_file: str                      # 上传接口返回的文件名
    job_name: str                          # 解压到 flows/<job_name>/
    work_pools: list[str]                  # 目标池，如 ["windows-gui-pool", "linux-rpa-pool"]
    register_entrypoint: str = ""          # zip 内注册脚本相对路径，留空=只上传不注册


# --- Routes ---

@app.get("/health")
@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "rpa-gateway"}


@app.post("/api/jobs/trigger", response_model=JobResponse)
async def trigger_job(req: TriggerJobRequest):
    """Trigger a Prefect deployment by name."""
    client = app.state.http_client

    # Find deployment by name
    resp = await client.post(
        "/deployments/filter",
        json={"deployments": {"name": {"any_": [req.deployment_name]}}},
    )
    if resp.status_code != 200:
        raise HTTPException(502, "Failed to query Prefect API")

    deployments = resp.json()
    if not deployments:
        raise HTTPException(404, f"Deployment '{req.deployment_name}' not found")

    deployment_id = deployments[0]["id"]

    # Create flow run
    body = {}
    if req.parameters:
        body["parameters"] = req.parameters

    resp = await client.post(
        f"/deployments/{deployment_id}/create_flow_run",
        json=body,
    )
    if resp.status_code not in (200, 201):
        raise HTTPException(502, "Failed to create flow run")

    run = resp.json()
    return JobResponse(flow_run_id=run["id"], status=run["state"]["type"])


@app.get("/api/jobs")
async def list_jobs(limit: int = 50):
    """List recent flow runs."""
    client = app.state.http_client
    resp = await client.post(
        "/flow_runs/filter",
        json={
            "sort": "EXPECTED_START_TIME_DESC",
            "limit": limit,
        },
    )
    if resp.status_code != 200:
        raise HTTPException(502, "Failed to query flow runs")
    return resp.json()


@app.get("/api/jobs/{flow_run_id}")
async def get_job(flow_run_id: str):
    """Get a specific flow run status."""
    client = app.state.http_client
    resp = await client.get(f"/flow_runs/{flow_run_id}")
    if resp.status_code == 404:
        raise HTTPException(404, "Flow run not found")
    if resp.status_code != 200:
        raise HTTPException(502, "Failed to query Prefect API")
    return resp.json()


@app.get("/api/deployments")
async def list_deployments():
    """List all deployments."""
    client = app.state.http_client
    resp = await client.post("/deployments/filter", json={})
    if resp.status_code != 200:
        raise HTTPException(502, "Failed to query deployments")
    return resp.json()


@app.get("/api/work-pools")
async def list_work_pools():
    """List all work pools (for the upload page pool selector)."""
    client = app.state.http_client
    resp = await client.post("/work_pools/filter", json={})
    if resp.status_code != 200:
        raise HTTPException(502, "Failed to query work pools")
    return resp.json()


@app.post("/api/packages/upload")
async def upload_package(file: UploadFile = File(...), job_name: str = Form(...)):
    """接收 job zip 包，存到 PACKAGES_DIR，返回文件名供分发使用。"""
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(400, "Only .zip packages are accepted")
    if not re.fullmatch(r"[A-Za-z0-9_\-]+", job_name):
        raise HTTPException(400, "job_name: letters/digits/underscore/hyphen only")

    stamp = time.strftime("%Y%m%d-%H%M%S")
    safe_name = f"{job_name}-{stamp}.zip"
    dest = PACKAGES_DIR / safe_name
    with open(dest, "wb") as f:
        while chunk := await file.read(1024 * 1024):
            f.write(chunk)

    return {
        "package_file": safe_name,
        "size": dest.stat().st_size,
        "url": f"{settings.PUBLIC_BASE_URL}/packages/{safe_name}",
    }


@app.post("/api/packages/dispatch")
async def dispatch_package(req: DispatchRequest):
    """向每个目标池的每台在线 Worker 各触发一次 deploy-job flow（定向到 Worker 专属队列），
    保证包落地到池内所有 Worker，而不是只有抢到任务的那一台。"""
    if not (PACKAGES_DIR / req.package_file).exists():
        raise HTTPException(404, f"Package '{req.package_file}' not found - upload first")

    client = app.state.http_client
    package_url = f"{settings.PUBLIC_BASE_URL}/packages/{req.package_file}"
    parameters = {
        "package_url": package_url,
        "job_name": req.job_name,
        "register_entrypoint": req.register_entrypoint,
    }
    results = []

    for pool in req.work_pools:
        # deploy-job 的 deployment 名即池名（见 must_deploy.py）
        resp = await client.get(f"/deployments/name/deploy-job/{pool}")
        if resp.status_code != 200:
            results.append({"pool": pool, "error": f"deploy-job/{pool} not registered on this pool"})
            continue
        deployment_id = resp.json()["id"]

        # 查询池内在线 Worker（Worker 启动时监听 default + 自己名字的专属队列）
        resp = await client.post(f"/work_pools/{pool}/workers/filter", json={})
        workers = resp.json() if resp.status_code == 200 else []
        online = [w["name"] for w in workers if w.get("status") == "ONLINE"]

        if not online:
            # 兜底：查不到在线 Worker 时按旧行为触发一次（default 队列，单台落地）
            resp = await client.post(
                f"/deployments/{deployment_id}/create_flow_run",
                json={"parameters": parameters},
            )
            if resp.status_code not in (200, 201):
                results.append({"pool": pool, "error": "Failed to create flow run"})
            else:
                run = resp.json()
                results.append({
                    "pool": pool, "worker": None,
                    "flow_run_id": run["id"], "status": run["state"]["type"],
                    "warning": "no online workers found - dispatched once to default queue",
                })
            continue

        # 每台在线 Worker 各一个 flow run，定向到它的专属队列
        for worker_name in online:
            resp = await client.post(
                f"/deployments/{deployment_id}/create_flow_run",
                json={"parameters": parameters, "work_queue_name": worker_name},
            )
            if resp.status_code not in (200, 201):
                results.append({"pool": pool, "worker": worker_name, "error": "Failed to create flow run"})
                continue
            run = resp.json()
            results.append({
                "pool": pool, "worker": worker_name,
                "flow_run_id": run["id"], "status": run["state"]["type"],
            })

    return {"package_url": package_url, "dispatched": results}
