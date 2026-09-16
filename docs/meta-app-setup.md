# Meta app setup for agentco posting

Do this once. It creates the app agentco uses to post to your own accounts.
The app stays in development mode: you are its admin, it posts only to your
accounts, and Meta does not need to review it.

## 1. Check each Instagram account

For @becoming_denis, @attune and @thesolutiontape, in the Instagram app:
Settings, Account type and tools. It must say Professional (Creator or
Business). Then Settings, Accounts Centre: each must be connected to a
Facebook Page you manage. Note any that are not.

## 2. Create the app

1. Go to developers.facebook.com, My Apps, Create app.
2. Use case: "Other", then type "Business". Name it "agentco".
3. In the app dashboard, add the products **Facebook Login for Business**
   and **Instagram Graph API** (Instagram with Facebook Login).
4. Add the use case **Access the Threads API**.
5. Note the Graph API version shown at the top of the dashboard.

## 3. Redirect addresses

- Facebook Login for Business, Settings, Valid OAuth Redirect URIs:
  `https://agentco-golosindenis-projects.vercel.app/accounts/callback/meta`
- Threads API, Settings, Redirect Callback URLs:
  `https://agentco-golosindenis-projects.vercel.app/accounts/callback/threads`
  Also fill Uninstall and Delete callback URLs with the same address.

## 4. Permissions

- Facebook Login: `pages_show_list`, `pages_manage_posts`,
  `pages_read_engagement`, `instagram_basic`, `instagram_content_publish`,
  `business_management`.
- Threads: `threads_basic`, `threads_content_publish`.
- Threads, Roles: add your Threads account as a Threads Tester, then accept
  the invite in the Threads app (Settings, Account, Website permissions,
  Invites). Repeat for each Threads account you want to connect.

## 5. Give Claude the keys

App settings, Basic: App ID and App secret. Threads API settings: Threads
App ID and Threads App secret. Paste them only into the terminal prompts
Claude gives you, never into chat.
