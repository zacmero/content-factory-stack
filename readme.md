# Content Factory Stack: Instructions

## Running the Multiple Containers Stack

This project uses a multi-container architecture to ensure stability and separation of concerns. You have two main applications: **Postiz** (Social Media Scheduler) and **n8n** (Workflow Automation).

*(Note: The root `docker-compose.yml` has been surgically cleaned. All obsolete, conflicting database and redis containers previously clashing with Postiz have been removed. The stack now strictly uses `n8n` in the root and the full microservice stack in `postiz-stable`.)*

### 1. Starting Postiz (Social Media Scheduler)
Postiz runs as a microservices stack (PostgreSQL, Redis, Temporal, ElasticSearch). 
To start it, open a terminal and run:
```bash
cd /home/zacmero/content-factory-stack/postiz-stable
docker-compose up -d
```
- **Access Postiz:** `http://localhost:4007`
- **To Stop Postiz:** `docker-compose down` (from the same directory)

### 2. Starting n8n (Workflow Automation)
n8n runs as its own service with a dedicated data volume.
To start it, open a terminal and run:
```bash
cd /home/zacmero/content-factory-stack
docker-compose up -d
```
- **Access n8n:** `http://localhost:8080`
- **To Stop n8n:** `docker-compose stop`

---

### Global Master Credentials
For both **n8n** and **Postiz**, the centralized master credentials are:
- **Email / Username:** `z4cmero@gmail.com`
- **Password:** `Nuk@2202`

---

✦ Yes, your docker-compose.yml file is well-configured for regular use.

   1. Starting and Stopping: You can use docker-compose up -d to start your n8n service and
      docker-compose stop to stop it whenever you want. Because of the volumes: -
      ./n8n_data:/home/node/.n8n configuration, all your data, workflows, and credentials are saved in
      the n8n_data folder, so everything will be right where you left it when you start it again.

   2. Automatic Updates: Your docker-compose.yml is set to use image: n8nio/n8n:latest. This means it
      will use the "latest" version of the n8n image that exists on your computer, but it will not
      automatically download a newer version from the internet each time you start it.

  To update n8n to the newest version, you should first run this command:
  docker-compose pull

  This will download the latest image. After it's finished, run docker-compose up -d again. Docker
  Compose is smart enough to see that the image has been updated and it will recreate your container
  using the new version.

n8n API: check .env file


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











### The Self-Healing System with Human Approval

  This setup involves two workflows: the workflow that might fail, and the "Fix-It" workflow that
  responds.

  Workflow A: Any Workflow
   * This is any of your standard workflows. It runs as normal, but at some point, it encounters an
     error and fails.

  ---

  Workflow B: The "Fix-It" Workflow

  1. Node: `Error Trigger`
   * Action: This workflow starts automatically when Workflow A (or any other workflow) fails.
   * Output: Passes a JSON object containing the details of the failure (error message, workflow ID,
     etc.) to the next node.

  2. Node: `AI Agent` (or a specific Gemini/AI model node)
   * Input: Receives the error data from the Error Trigger.
   * Prompt: You would configure this node with a prompt like:
      > "You are an n8n expert developer. A workflow has failed with the following error:
  {{$json.error.message}}. The workflow ID is {{$json.workflow.id}}. Your task is to diagnose the
  problem and generate the complete, corrected JSON for the entire workflow. Do not execute the fix.
  Your only output should be the raw JSON of the proposed new workflow version."
   * Output: A single JSON object representing the complete, corrected workflow.

  3. Node: `Email` (or `Slack`, `Discord`, etc.)
   * Action: Sends a notification message to you.
   * Content: The message would contain the AI's proposed fix and two unique webhook URLs generated by
     the next step. For example:
      > "Workflow {{$json.workflow.name}} has failed. The AI proposes a fix.
      >
      > To Approve: Click http://localhost:5678/webhook/approve-fix-123
  (http://localhost:5678/webhook/approve-fix-123)
      >
      > To Deny: Click http://localhost:5678/webhook/deny-fix-123
  (http://localhost:5678/webhook/deny-fix-123)"

  4. Nodes: `Webhook` (x2)
   * Action: The workflow now pauses, waiting for an incoming HTTP request. You will have two of these
     nodes, one for the "Approve" URL and one for the "Deny" URL. When you click a link in the email,
     you trigger one of them.

  5. Node: `If`
   * Action: This node checks which of the two webhooks was triggered.
   * Output: It routes the execution down one of two paths: "Approve" or "Deny".

  6. Node: `HTTP Request` (This node is on the "Approve" path)
   * Input: Receives the corrected workflow JSON that was generated by the AI Agent in Step 2.
   * Action: If you approved the fix, this node activates. It makes a PUT request to your n8n API
     endpoint (http://localhost:5678/api/v1/workflows/{{$json.workflow.id}}) with the corrected JSON
     as the body, updating and fixing the broken workflow.

  7. Node: `NoOp` (This node is on the "Deny" path)
   * Action: If you denied the fix, the workflow simply ends, and no changes are made.

  This design gives you the best of both worlds: the speed of AI-powered diagnostics and the safety
  and control of human oversight.
