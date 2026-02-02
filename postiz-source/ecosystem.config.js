module.exports = {
  apps: [
    {
      name: "backend",
      cwd: "./",
      script: "apps/backend/dist/apps/backend/src/main.js",
      env: {
        NODE_ENV: "production",
        POSTGRES_PASSWORD: "Nuk@2202",
        POSTGRES_USER: "postiz",
        POSTGRES_DB: "postiz",
        POSTGRES_PORT: "5432",
        POSTGRES_HOST: "localhost",
        DATABASE_URL: "postgresql://postiz:Nuk@2202@localhost:5432/postiz",
        REDIS_HOST: "localhost",
        REDIS_PORT: "6379",
        REDIS_URL: "redis://localhost:6379",
        JWT_SECRET: "Nuk@2202",
        MAIN_URL: "http://localhost:4200",
        FRONTEND_URL: "http://localhost:4200",
        NEXT_PUBLIC_BACKEND_URL: "http://localhost:4200",
        BACKEND_INTERNAL_URL: "http://localhost:3000",
        TEMPORAL_ADDRESS: "localhost:7233",
        IS_GENERAL: "true",
        WORKERS: "true",
        NOT_SECURED: "true"
      }
    },
    {
      name: "orchestrator",
      cwd: "./",
      script: "apps/orchestrator/dist/apps/orchestrator/src/main.js",
      env: {
        NODE_ENV: "production",
        POSTGRES_PASSWORD: "Nuk@2202",
        POSTGRES_USER: "postiz",
        POSTGRES_DB: "postiz",
        POSTGRES_PORT: "5432",
        POSTGRES_HOST: "localhost",
        DATABASE_URL: "postgresql://postiz:Nuk@2202@localhost:5432/postiz",
        REDIS_HOST: "localhost",
        REDIS_PORT: "6379",
        REDIS_URL: "redis://localhost:6379",
        JWT_SECRET: "Nuk@2202",
        TEMPORAL_ADDRESS: "localhost:7233",
        IS_GENERAL: "true",
        NOT_SECURED: "true"
      }
    },
    {
      name: "frontend",
      cwd: "./apps/frontend",
      script: "npm",
      args: "start -- -p 4200",
      env: {
        NODE_ENV: "production",
        NEXT_PUBLIC_BACKEND_URL: "http://localhost:3000"
      }
    }
  ]
};
