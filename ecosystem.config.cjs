// PM2 ecosystem config for skill-bridge-api
// Used by the CD pipeline to manage processes per environment.
'use strict';

module.exports = {
  apps: [
    {
      name: 'skillbridge-api-dev',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      env_dev: {
        NODE_ENV: 'development',
      },
    },
    {
      name: 'skillbridge-api-staging',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      env_staging: {
        NODE_ENV: 'staging',
      },
    },
    {
      name: 'skillbridge-api-prod',
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      env_production: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'question-generator',
      script: 'dist/scripts/generate-question-bank.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: false,
      max_restarts: 0,
      env_dev: {
        NODE_ENV: 'development',
      },
      env_staging: {
        NODE_ENV: 'staging',
      },
      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
};
