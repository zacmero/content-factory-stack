To post to YouTube Shorts (which is just a video upload <60s and vertical), you need to set up a Google Cloud
  Project.

  Here is the exact, step-by-step guide to get your Client ID and Client Secret.

  1. Create the Project
   1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
   2. Log in with your Google account.
   3. Click the project dropdown (top left) and select "New Project".
   4. Name it Sarah Nutri (or Content Factory) and click Create.
   5. Select the new project.

  2. Enable the YouTube API
   1. In the left sidebar, go to APIs & Services > Library.
   2. Search for "YouTube Data API v3".
   3. Click it and click Enable.

  3. Configure the OAuth Consent Screen (Crucial)
  Google won't let you create credentials without this.
   1. Go to APIs & Services > OAuth consent screen.
   2. User Type: Select External.
   3. Click Create.
   4. App Information:
       * App name: Sarah Nutri
       * User support email: Your email.
       * Developer contact email: Your email.
   5. Click Save and Continue (Skip "Scopes" for now, Postiz asks for them automatically).
   6. Test Users (VERY IMPORTANT):
       * Since your app is not verified by Google, you MUST add your own email address here.
       * Click Add Users -> Type z4cmero@gmail.com -> Click Add.
   7. Click Save and Continue until finished.

  4. Create Credentials
   1. Go to APIs & Services > Credentials.
   2. Click + CREATE CREDENTIALS (Top bar) -> OAuth client ID.
   3. Application type: Select Web application.
   4. Name: Postiz Integration.
   5. Authorized redirect URIs (The most important part):
       * Click ADD URI.
       * Paste this EXACTLY: http://localhost:4007/api/integrations/social/youtube/callback
   6. Click Create.

  5. Get the Keys
  A window will pop up with your keys.
   * Copy Your Client ID.
   * Copy Your Client Secret.

  6. Input into Postiz
   1. Go to your Postiz instance: http://localhost:4007/admin/settings (http://localhost:4007/admin/settings)
      (or just Settings in the sidebar).
   2. Click Social Media (or "Social Integrations").
   3. Find YouTube.
   4. Paste the Client ID and Client Secret.
   5. Click Save.

  Once saved, go to the "Integrations" page (plug icon on the left) and try to connect YouTube. If it works,
  you'll see the Google permissions screen.

  Let me know when you have pasted the keys into Postiz!
