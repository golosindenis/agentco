import { supabase } from "../src/db.js";

const secret = process.env.CRON_SECRET;
if (!secret) throw new Error("CRON_SECRET must be set for this command");
const url = "https://agentco-golosindenis-projects.vercel.app/api/publish-due";
const { error } = await supabase.rpc("set_publish_cron", { p_url: url, p_secret: secret });
if (error) throw new Error(`set_publish_cron: ${error.message}`);
console.log(`publish-due scheduled every minute against ${url}`);
