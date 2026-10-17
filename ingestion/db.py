"""PostgreSQL connection, configured from the environment (.env, see .env.example)."""

import os

import psycopg
from dotenv import load_dotenv


def connect() -> psycopg.Connection:
    load_dotenv()
    return psycopg.connect(
        host=os.environ.get("POSTGRES_HOST", "localhost"),
        port=os.environ.get("POSTGRES_PORT", "5433"),
        dbname=os.environ["POSTGRES_DB"],
        user=os.environ["POSTGRES_USER"],
        password=os.environ["POSTGRES_PASSWORD"],
    )
