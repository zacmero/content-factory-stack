#!/bin/bash
set -e

# Define the user and DB names explicitly
echo "Initializing Databases..."

# 1. Create n8n user and DB
echo "  Creating n8n..."
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
    CREATE USER n8n WITH PASSWORD '$POSTGRES_PASSWORD' SUPERUSER;
    CREATE DATABASE n8n OWNER n8n;
    GRANT ALL PRIVILEGES ON DATABASE n8n TO n8n;
EOSQL

# 2. Create postiz user and DB
echo "  Creating postiz..."
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
    CREATE USER postiz WITH PASSWORD '$POSTGRES_PASSWORD' SUPERUSER;
    CREATE DATABASE postiz OWNER postiz;
    GRANT ALL PRIVILEGES ON DATABASE postiz TO postiz;
EOSQL

echo "Initialization complete."