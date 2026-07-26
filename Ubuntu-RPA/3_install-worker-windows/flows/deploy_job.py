"""
System flow: deploy-job
Worker 自助部署通道 —— 从 Gateway 下载 job 包(zip)，解压到本机 flows 目录，
并执行包内入口脚本完成 Prefect deployment 注册。

由安装脚本在装机时预注册到本 Worker 的池中（见 must_deploy.py），
之后即可通过网页上传 zip → 一键分发到各 Worker。

zip 包约定:
    - 解压到 <flows目录>/<job_name>/ 下（保留 zip 内目录结构）
    - register_entrypoint 为 zip 内相对路径的 .py 文件，
      Worker 会以本机 venv python 执行它（该脚本内部调用 .deploy() 注册）
    - 不传 register_entrypoint 则只上传解压，不注册

跨平台: 路径均相对本文件所在 flows 目录推导，Windows/Linux 通用。
"""

import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

import httpx
from prefect import flow, get_run_logger

FLOWS_DIR = Path(__file__).parent.resolve()


@flow(name="deploy-job", log_prints=True)
def deploy_job_flow(
    package_url: str,
    job_name: str,
    register_entrypoint: str = "",
    clean_existing: bool = True,
) -> str:
    """下载 job 包 → 解压到 flows/<job_name> → 可选执行注册脚本。

    Args:
        package_url: zip 包下载地址（Gateway 提供，如 http://10.86.180.120/packages/xxx.zip）
        job_name: 目标目录名，解压到 flows/<job_name>/
        register_entrypoint: zip 内注册脚本相对路径，如 "05_DataJobFile/RPACN01_07_downloadfile_flow.py"；留空则只部署文件
        clean_existing: 解压前是否清空旧目录（默认 True，保证干净部署）
    """
    logger = get_run_logger()
    target_dir = FLOWS_DIR / job_name
    zip_path = FLOWS_DIR / f"_{job_name}.zip"

    # 1. 下载
    logger.info(f"Downloading {package_url}")
    with httpx.stream("GET", package_url, timeout=300.0, follow_redirects=True) as r:
        r.raise_for_status()
        with open(zip_path, "wb") as f:
            for chunk in r.iter_bytes():
                f.write(chunk)
    logger.info(f"Downloaded {zip_path.stat().st_size} bytes")

    # 2. 解压
    if clean_existing and target_dir.exists():
        shutil.rmtree(target_dir)
        logger.info(f"Removed existing {target_dir}")
    target_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(target_dir)
    zip_path.unlink()
    logger.info(f"Extracted to {target_dir}")

    # 3. 注册（用当前 venv 的 python 执行入口脚本）
    if register_entrypoint:
        script = target_dir / register_entrypoint
        if not script.exists():
            raise FileNotFoundError(f"register_entrypoint not found: {script}")
        logger.info(f"Registering via {script}")
        result = subprocess.run(
            [sys.executable, str(script)],
            cwd=str(script.parent),
            capture_output=True,
            text=True,
            timeout=600,
        )
        if result.stdout:
            logger.info(result.stdout)
        if result.returncode != 0:
            logger.error(result.stderr)
            raise RuntimeError(f"Registration failed (exit {result.returncode})")
        logger.info("Registration completed")
    else:
        logger.info("No register_entrypoint given - files deployed only")

    return f"deployed: {target_dir}"


if __name__ == "__main__":
    # 本地调试用法:
    #   python deploy_job.py <package_url> <job_name> [register_entrypoint]
    deploy_job_flow(
        package_url=sys.argv[1],
        job_name=sys.argv[2],
        register_entrypoint=sys.argv[3] if len(sys.argv) > 3 else "",
    )
