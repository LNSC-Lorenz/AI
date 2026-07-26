"""
Python Script Flow
Generic Python automation tasks — file processing, data ETL, API calls, etc.
Can run on either Ubuntu or Windows agent.
"""

from prefect import flow, task, get_run_logger
from pathlib import Path
import json
import csv


@task(retries=2, retry_delay_seconds=5)
def read_csv_file(file_path: str, encoding: str = "utf-8") -> list:
    """Read a CSV file and return rows as list of dicts."""
    logger = get_run_logger()
    logger.info(f"Reading CSV: {file_path}")

    rows = []
    with open(file_path, "r", encoding=encoding) as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    logger.info(f"Read {len(rows)} rows from {file_path}")
    return rows


@task
def transform_data(rows: list, mapping: dict = None) -> list:
    """Apply transformations to data rows."""
    logger = get_run_logger()
    logger.info(f"Transforming {len(rows)} rows")

    if mapping:
        transformed = []
        for row in rows:
            new_row = {}
            for target_key, source_key in mapping.items():
                new_row[target_key] = row.get(source_key, "")
            transformed.append(new_row)
        return transformed

    return rows


@task
def write_json_output(data: list, output_path: str) -> str:
    """Write data to JSON file."""
    logger = get_run_logger()
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    logger.info(f"Written {len(data)} records to {output_path}")
    return output_path


@task(retries=3, retry_delay_seconds=10)
def call_external_api(
    url: str,
    method: str = "GET",
    headers: dict = None,
    payload: dict = None,
) -> dict:
    """Call an external API."""
    import httpx

    logger = get_run_logger()
    logger.info(f"Calling API: {method} {url}")

    with httpx.Client(timeout=30.0) as client:
        if method.upper() == "GET":
            resp = client.get(url, headers=headers)
        elif method.upper() == "POST":
            resp = client.post(url, headers=headers, json=payload)
        else:
            raise ValueError(f"Unsupported method: {method}")

    resp.raise_for_status()
    logger.info(f"API response: {resp.status_code}")
    return resp.json()


@flow(name="python-etl-flow", log_prints=True)
def python_etl_flow(
    input_file: str = "",
    output_file: str = "",
    field_mapping: dict = None,
):
    """Generic ETL flow: read CSV → transform → write JSON."""
    rows = read_csv_file(input_file)
    transformed = transform_data(rows, mapping=field_mapping)
    output = write_json_output(transformed, output_file)
    print(f"ETL complete: {output}")
    return output


if __name__ == "__main__":
    python_etl_flow()
