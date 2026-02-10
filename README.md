# Het of De Telegram Bot

This is a [Telegram bot](https://t.me/het_of_de_artikelen_bot) that helps you learn the Dutch articles "de" and "het". It provides quizzes in the form of Telegram polls.

Inspired by the Telegram channel [Ik zie Nederlands](https://t.me/grammaNL)

## Features

- **On-demand quizzes**: Get a new quiz with a random word using the `/word` command.
- **Subscriptions**: Subscribe to receive a quiz daily using the `/subscribe` command.
- **Help command**: Get a list of available commands with `/help`.

## Tech Stack

- **Language**: Node.js
- **Framework**: Fastify
- **Database**: Google Firestore
- **Deployment**: Google Cloud Run
- **Secrets**: Google Secret Manager

## Bot setup
1. Inside Telegram go to bot @BotFather
2. Create a bot with /newbot and save a token
3. Deploy the backend and get CLOUDRUN_URL
4. Set up the webhook in Telegram by calling
    ```
    https://api.telegram.org/botTELEGRAM_TOKEN/setWebhook?url=https://CLOUDRUN_URL/webhook
    ```
See details below.

## Project setup

### 1. Firestore Database

The bot uses Firestore to store words and chat information.

**Collections:**

- `dictionary`: Stores the Dutch words with their articles and translations.
- `chats`: Stores user chat information and subscription status.


### 2. Secret Manager

The Telegram bot token is stored in Google Secret Manager.

1.  Create a secret in Secret Manager named `het-of-de-token`.
2.  Add a version to the secret with Telegram bot token as the value.

### 3. Deploy to Cloud Run

This application is designed to be deployed as a container on Google Cloud Run. The build process uses `esbuild` to bundle the entire application into a single, minified file to improve cold start performance.

1.  **Build the Docker image:**

    ```bash
    gcloud builds submit --tag gcr.io/PROJECT_ID/het-of-de-telegram-bot
    ```

    Replace `PROJECT_ID` with the Google Cloud project ID.

2.  **Deploy the service:**

    ```bash
    gcloud run deploy het-of-de-telegram-bot \
      --image gcr.io/PROJECT_ID/het-of-de-telegram-bot \
      --platform managed \
      --region REGION \
      --allow-unauthenticated \
      --service-account=SERVICE_ACCOUNT
    ```

    -   Replace `PROJECT_ID` with the Google Cloud project ID.
    -   Replace `REGION` with the desired region (e.g., `us-central1`).
    -   Replace `SERVICE_ACCOUNT` with a service account that has access to Firestore and Secret Manager.

3.  **Set the Telegram Webhook:**

    After deployment, check the URL for the Cloud Run service. Set this as the webhook for the Telegram bot.

    Make a POST request to the Telegram API:
    ```
    https://api.telegram.org/botTELEGRAM_TOKEN/setWebhook?url=https://CLOUDRUN_URL/webhook
    ```

    -   Replace `TELEGRAM_TOKEN` with the bot token.
    -   Replace `CLOUDRUN_URL` with the URL of the deployed service.

## Scheduler

To send daily quizzes to subscribers, set up a scheduler (e.g., Google Cloud Scheduler) to make a GET request to the `/scheduler` endpoint of the service once a day.
