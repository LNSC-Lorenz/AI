"""
RPA Platform — FastAPI Gateway
Provides API endpoints for Vue3 frontend and external triggers.
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
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


# --- Models ---

class TriggerJobRequest(BaseModel):
    deployment_name: str
    parameters: Optional[dict] = None


class JobResponse(BaseModel):
    flow_run_id: str
    status: str


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
