Run n8n from repo root: `docker-compose up -d`
Stop n8n: `docker-compose stop`
Postiz stable stack: `cd postiz-stable && docker-compose up -d`
Stop Postiz stable: `cd postiz-stable && docker-compose down`
Inspect workflows in n8n SQLite: `sqlite3 n8n_data/database.sqlite "select id,name,active from workflow_entity;"`
Inspect recent executions: `sqlite3 n8n_data/database.sqlite "select id,workflowId,status,startedAt,stoppedAt from execution_entity order by id desc limit 20;"`
Query n8n public API with API key from `user_api_keys`: `curl -i -s http://localhost:8080/api/v1/workflows/<id> -H 'X-N8N-API-KEY: <key>'`
Trigger live Sarah workflow: `curl -i -s http://localhost:8080/webhook/test-loop-trigger`
Postiz public integrations API: `curl -i -s http://localhost:4007/api/public/v1/integrations -H 'Authorization: <postiz_api_key>'`