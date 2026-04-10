# Gemini CLI Master Instructions - My Development Environment

## Start 
My Primary goal is to get immediate, actionable terminal commands to manage services, primarily Docker containers, environments, accounts, within my specific development environment. I am an expert DevOps assistant, providing commands that are ready to copy and paste.

## My Environment:
- **Operating System:** Ubuntu on WSL(usually).
- **Virtualization:** I am using Windows Subsystem for Linux (WSL 2). My primary command-line interface is the Ubuntu terminal within WSL 2.
- **Docker:** I have Docker Desktop for Windows installed and running. It is configured to use the WSL 2 backend. This means I run all `docker` commands from my Ubuntu WSL terminal.
- **Project Structure:** I often work inside a project directory, for example, `~/n8n-docker`. Commands should be executable from within such a directory.
- **Network Access:** I access web services running inside Docker containers from my Windows host machine (e.g., using Google Chrome). The correct address to use is typically `http://localhost:<PORT>` and NOT `http://0.0.0.0:<PORT>`.


- **Application:** If not already setup, I should try tor run  an n8n (n8nio/n8n) Docker container.

## How I Help (AI Instructions):
1.  **Prioritize Solutions:** Always assume a conflicting container might exist. Before providing a `docker run` command to create a new container, first provide the necessary `docker stop <container_name>` and `docker rm <container_name>` commands as a preliminary step.
2.  **Provide Complete Commands:** Give the full, correct `docker run` command. For n8n, this should include port mapping (`-p 5678:5678`), a persistent volume (`-v n8n_data:/home/node/.n8n`), a name (`--name n8n`), and detached mode (`-d`).
3.  **Explain the "Why":** Briefly explain each part of the command (e.g., what `-p` and `-v` do).
4.  **Verification Steps:** After providing the solution commands, always include a command to verify that the container is running correctly (e.g., `docker ps`).
5.  **State the Correct Access URL:** Explicitly state the URL I need to use in my Windows browser to access the service (e.g., "Access n8n at http://localhost:5678"). Acknowledge that `0.0.0.0` in the container logs means `localhost` for me on the host machine.

---
## CORE INFRASTRUCTURE - CURRENT STATUS (Feb 2, 2026)

This project runs two primary services in parallel: **n8n** (for workflow automation) and **Postiz** (for social media scheduling).

### 1. Postiz: The Social Media Scheduler

**Problem:** The standard "All-in-One" Postiz Docker image is unstable for self-hosting due to complex internal dependencies (Temporal, database permissions, networking) that fail silently, preventing the application from starting. Local source installations also failed due to environment conflicts.

**The Solution: "The Expert Stack"**
We have deployed the official, multi-container `postiz-docker-compose` stack. This is the only stable, known-good configuration. It runs a full microservices architecture.

- **Location:** `content-factory-stack/postiz-stable/`
- **Access URL:** `http://localhost:4007`
- **Key Components:**
    - `postiz`: The main application container.
    - `postiz-postgres`: Dedicated database for Postiz.
    - `postiz-redis`: Dedicated cache for Postiz.
    - `temporal`: The critical workflow engine required by Postiz.
    - `temporal-postgresql`: A separate, dedicated database *just for Temporal*.
    - `temporal-elasticsearch`: Search index for Temporal.

**Management Commands (MUST be run from the `postiz-stable` directory):**

- **To Start Postiz:**
  ```bash
  cd /home/zacmero/projects/content-factory-stack/postiz-stable
  docker-compose up -d
  ```

- **To Stop Postiz:**
  ```bash
  cd /home/zacmero/projects/content-factory-stack/postiz-stable
  docker-compose down
  ```
**IMPORTANT:** Do NOT attempt to simplify this stack or use the single-container image. The current setup is the result of extensive troubleshooting and is the only reliable path.

---

### 2. n8n: The Workflow Engine

n8n is running in a separate, simplified Docker container managed by the `docker-compose.yml` in the project root.

- **Location:** `content-factory-stack/`
- **Access URL:** `http://localhost:8080`
- **Data:** All workflows and credentials are saved in the `n8n_data` folder, which is essential to back up.

**Management Commands (run from the project root):**
- **To Start n8n:**
  ```bash
  cd /home/zacmero/projects/content-factory-stack
  docker-compose up -d
  ```

- **To Stop n8n:**
  ```bash
  cd /home/zacmero/projects/content-factory-stack
  docker-compose stop
  ```

- **To Update n8n:**
  ```bash
  cd /home/zacmero/projects/content-factory-stack
  docker-compose pull
  docker-compose up -d --force-recreate
  ```

---

### Global Master Credentials
For both **n8n** and **Postiz**, the centralized master credentials are:
- **Email / Username:** `z4cmero@gmail.com`
- **Password:** `Nuk@2202`

### Meta / Instagram Credentials
These credentials were used during the Meta page and Instagram connection flow:
- **Facebook login:** `manuel_melo81@hotmail.com`
- **Facebook password:** `2202@2202@nuk`
- **Instagram login:** `sarahsmithnutri@gmail.com`
- **Instagram password:** `2202@2202@nuk`

### Meta / Postiz Connection Steps Used In This Project
When future agents need to recreate or debug the social account setup, use this sequence:
1. Open Meta Business Suite while logged into the Facebook account that owns the Page.
2. From the Page home, click `Editar Página do Facebook | Conectar o Instagram`.
3. Accept the Instagram inbox / messaging permission prompt.
4. Complete any Meta verification or checkpoint prompt before continuing.
5. Create or connect the Instagram business account for Sarah Nutri.
6. Link that Instagram business account to the existing Facebook Page.
7. Open Postiz and add the Instagram integration again if it does not appear automatically.
8. Verify the integration in Postiz by publishing a real test post.
9. Confirm the new Instagram integration appears in `http://localhost:4007/api/public/v1/integrations`.
10. Re-run the n8n approval webhook and confirm it routes to both `facebook` and `instagram`.



### Connecting an AI Assistant to a Local n8n Instance: The Direct API Method

  1. Overview & Architecture

  The most robust and reliable method for an AI assistant to control a local n8n instance is to
  interact directly with the n8n REST API. This approach avoids incompatible middleman tools (like
  stdio-based MCP servers) and uses official, stable interfaces.

  The correct architecture is:

  `AI Assistant  ->  curl command  ->  n8n REST API`

  The AI's role is to act as an n8n developer. It translates natural language requests into the JSON
  structure of an n8n workflow and uses the curl command-line tool to send this JSON to the n8n
  instance's API endpoint.

  2. Setup Instructions

  These steps describe how to set up the n8n environment itself.

  Step 2.1: Create the docker-compose.yml File

  In your project directory (e.g., n8n-docker), create a file named docker-compose.yml with the
  following content. This file defines your n8n service, sets a password, and maps the necessary
  port.(Make sure the file is not already created)

    1 services:
    2   n8n:
    3     image: n8nio/n8n:latest
    4     container_name: n8n
    5     restart: unless-stopped
    6     ports:
    7       - "0.0.0.0:8080:5678"
    8     environment:
    9       N8N_BASIC_AUTH_ACTIVE: "true"
   10       N8N_BASIC_AUTH_USER: "${N8N_BASIC_AUTH_USER}"
   11       N8N_BASIC_AUTH_PASSWORD: "${N8N_BASIC_AUTH_PASSWORD}"
   12       N8N_UI_THEME: "dark"
   13       N8N_HOST: "0.0.0.0"
   14       N8N_PORT: "5678"
   15       N8N_PROTOCOL: "http"
   16       NODE_ENV: "production"
   17       EXECUTIONS_PROCESS: "main"
   18       DB_TYPE: "sqlite"
   19       DB_SQLITE_POOL_SIZE: 5
   20       N8N_RUNNERS_ENABLED: "true"
   21     volumes:
   22       - ./n8n_data:/home/node/.n8n

  Step 2.2: Run the n8n Container

  Open a terminal in the same directory as your docker-compose.yml file and run the following
  command:

   1 docker-compose up -d

  This will start the n8n container in the background. You can verify it's running with docker ps.

  Step 2.3: Get API Credentials

  You now need two pieces of information from your running n8n instance.

   1. API Endpoint URL:
      Because the docker-compose.yml file maps port 8080 on your machine to port 5678 inside the
  container, the correct API endpoint is:
      http://localhost:8080/api/v1/workflows

   2. API Key:
       * Open your n8n instance in a web browser at http://localhost:8080.
       * Log in with the credentials from the .env file.
       * In the left-hand menu, go to Settings > API.
       * Click "Create new API key".
       * Copy the generated key. This is your API key.

  3. Instructions for the AI Assistant

  This is the "master prompt" or context that should be given to the AI assistant. It tells the AI
  what its job is, what its tools are, and how to use them.

    # AI Assistant Master Instructions: n8n Automation Developer
    
    ## Primary Goal
    You are an expert n8n automation developer. Your task is to translate my natural language
      requests into complete, functional n8n workflows. You will do this by generating the
      necessary JSON structure for a workflow and then using the `curl` command in the shell to
      interact directly with my n8n instance's REST API.
    
    ## My Environment & Your Tools
    - **n8n Instance URL:** `http://localhost:8080`
    - **n8n API Endpoint for Workflows:** `http://localhost:8080/api/v1/workflows`
    - **Authentication:** You MUST use my n8n API key in an HTTP header for all requests. The
      header must be formatted exactly as: `-H "X-N8N-API-KEY: YOUR_API_KEY_HERE"`
    - **Your Primary Tool:** You will ONLY use the `curl` command to create and update
      workflows.
   
    ## The Process
   1.  Understand my request for a new workflow.
   2.  Construct the full JSON object for the n8n workflow. A workflow is a JSON object
      containing a `name`, a `nodes` array, and a `connections` object.
   3.  Construct the final `curl` command to `POST` this JSON to the `/api/v1/workflows`
      endpoint.
   4.  Execute the command to create the workflow.
   5.  Report back with the URL of the newly created workflow.
   
    ## Example Request & Your Expected Action
   
    ### User Request:
   "Create a workflow that starts with a manual trigger and then waits for 10 seconds."
   
   ### Your `curl` Command Action:
  curl -X POST 'http://localhost:8080/api/v1/workflows' \
  -H "Content-Type: application/json" \
  -H "X-N8N-API-KEY: YOUR_API_KEY_HERE" \
  --data-raw '{
    "name": "My Wait Workflow",
    "nodes": [
      {
        "parameters": {},
        "id": "5e388036-2615-4642-a810-9833f9909292",
        "name": "Start",
        "type": "n8n-nodes-base.start",
        "typeVersion": 1,
        "position": [ 240, 300 ]
      },
      {
        "parameters": { "value": 10, "unit": "seconds" },
        "id": "27f8a7d1-5580-472d-a2f0-d3d0c23a7b1b",
        "name": "Wait",
        "type": "n8n-nodes-base.wait",
        "typeVersion": 1.1,
        "position": [ 460, 300 ]
      }
    ],
    "connections": {
      "Start": { "main": [ [ { "node": "Wait", "type": "main", "index": 0 } ] ] }
    },
    "settings": {},
    "staticData": null
  }'




----> Official n8n documentation, where you can chat with an assistant there to get your answers: <BS>https://docs.n8n.io/integrations/builtin/cluster-nodes/sub-nodes/n8n-nodes-langchain.toolmcp/?utm_source=n8n_app&utm_medium=node_settings_modal-credential_link&utm_campaign=%40n8n%2Fn8n-nodes-langchain.mcpClientTool#related-resources
