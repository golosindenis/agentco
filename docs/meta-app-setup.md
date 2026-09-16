# Meta app setup for agentco posting

Written from the real setup on 2026-09-16, not from Meta's documentation.
Three things in the earlier version of this file were wrong and cost an hour;
they are called out below so the next person does not repeat them.

You need **two** apps. Threads cannot share an app with Facebook and
Instagram: ticking the Threads use case greys the others out, and Meta says
"some use cases can't be combined on the same app". The code expects two
apps and has separate variables for each.

Both apps stay in development mode. You are the admin, they post only to your
own accounts, and Meta does not review them. Ignore every "Become a Tech
Provider" prompt: that is for App Review and other businesses' data.

## 1. Check each Instagram account first

For @becoming_denis, @attune and @thesolutiontape, in the Instagram app:
Settings, Account type and tools. Each must say Professional (Creator or
Business). Then Settings, Accounts Centre: each must be connected to a
Facebook Page you manage. An Instagram account that fails either check shows
up later as "Not ready" with the reason, and cannot post.

## 2. App one: Threads

1. developers.facebook.com, My Apps, Create App. Name it `agentco`.
2. Use cases: tick only **Access the Threads API**.
3. Business portfolio: **I don't want to connect a business portfolio yet.**
   A portfolio scopes the app to that portfolio's assets, and your accounts
   span two portfolios.
4. Use cases, Access the Threads API, Permissions and features: add
   **threads_content_publish**. `threads_basic` is already there. Add nothing
   else; `threads_delete` in particular would let a leaked token wipe posts.
5. Settings tab of that same use case:
   - Threads Display Name: `agentco` (this is what you see when authorizing)
   - Redirect Callback URL:
     `https://agentco-golosindenis-projects.vercel.app/accounts/callback/threads`
   - **Uninstall and Delete callback URLs: the same address.** They are not
     marked required and the form refuses to save without them. (Wrong in the
     earlier version of this file, which said to leave them empty.)
6. App roles, Roles, Add People: choose **Threads Tester**, not plain Tester.
   Plain Tester does not grant Threads API access. Then accept the invite in
   the Threads app: Settings, Account, Website permissions, Invites.

## 3. App two: Facebook and Instagram

1. Create App. Name it `agentco posting`.
2. Use cases, filter **Content management**, tick both:
   - Manage messaging & content on Instagram
   - Manage everything on your Page
   They combine fine. Do not tick Live Video or oEmbed.
3. Business portfolio: **not yet**, same reason as above.
4. App settings, Basic:
   - **App domains: `agentco-golosindenis-projects.vercel.app`**
   - **Add platform, Website, Site URL:
     `https://agentco-golosindenis-projects.vercel.app/`**
   Both are required and neither was in the earlier version of this file.
5. Facebook Login for Business, Settings, Valid OAuth Redirect URIs:
   `https://agentco-golosindenis-projects.vercel.app/accounts/callback/meta`
   This one saves itself, with no Save button.
6. **Facebook Login for Business, Configurations, Create configuration.**
   This is the step whose absence caused the worst wild goose chase: without
   a configuration, the OAuth dialog fails with "The domain of this URL isn't
   included in the app's domains", which has nothing to do with the real
   cause. Business Login takes a `config_id` and ignores `scope` entirely.
   - Assets: Pages, Instagram accounts
   - Permissions: pages_show_list, pages_manage_posts, pages_read_engagement,
     instagram_basic, instagram_content_publish
   - Copy the Configuration ID it gives you.

## 4. The five, now six, environment variables

From `~/agentco`, one command per value. Each waits silently; paste and press
enter, nothing echoes. Never paste a secret into a chat.

```bash
read -rs META_APP_ID && printf %s "$META_APP_ID" | npx vercel env add META_APP_ID production
read -rs META_APP_SECRET && printf %s "$META_APP_SECRET" | npx vercel env add META_APP_SECRET production
read -rs META_CONFIG_ID && printf %s "$META_CONFIG_ID" | npx vercel env add META_CONFIG_ID production
read -rs THREADS_APP_ID && printf %s "$THREADS_APP_ID" | npx vercel env add THREADS_APP_ID production
read -rs THREADS_APP_SECRET && printf %s "$THREADS_APP_SECRET" | npx vercel env add THREADS_APP_SECRET production
printf %s "https://agentco-golosindenis-projects.vercel.app" | npx vercel env add PUBLIC_BASE_URL production
```

App IDs are public and can simply be typed. Secrets live at App settings,
Basic (Facebook app) and the Threads use case Settings tab (Threads app).

An env var only reaches the running app after a production deploy.

## 5. When you connect

On the Accounts page, press Connect Meta and grant **every** Page it offers.
A Page you deselect takes its Instagram account with it, and the only fix is
disconnecting and running the whole flow again.
