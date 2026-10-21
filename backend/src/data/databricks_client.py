import os
from pathlib import Path

from dotenv import load_dotenv
from databricks import sql

# Load .env from backend/.env (3 levels up from backend/src/data) or current directory
load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")
load_dotenv()

def get_connection():
    hostname = os.getenv("DATABRICKS_SERVER_HOSTNAME")
    http_path = os.getenv("DATABRICKS_HTTP_PATH")
    token = os.getenv("DATABRICKS_TOKEN")

    if not hostname:
        raise ValueError(
            "DATABRICKS_SERVER_HOSTNAME is missing from .env"
        )

    if not http_path:
        raise ValueError(
            "DATABRICKS_HTTP_PATH is missing from .env"
        )

    if not token:
        raise ValueError(
            "DATABRICKS_TOKEN is missing from .env"
        )

    try:
        return sql.connect(
            server_hostname = hostname,
            http_path = http_path,
            access_token = token,
        )

    except Exception as e:
        raise RuntimeError(
            "Could not create a Databricks SQL connection. Verify that the values in "
            "DATABRICKS_SERVER_HOSTNAME, DATABRICKS_HTTP_PATH, and DATABRICKS_TOKEN "
            "are valid for the current Databricks workspace, and that the SQL warehouse "
            "or endpoint referenced by DATABRICKS_HTTP_PATH is available."
        )