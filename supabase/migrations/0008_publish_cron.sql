-- Stores the publish route address and secret in Vault and schedules the
-- every minute call. Called once from scripts/set-publish-cron.ts so the
-- secret never appears in a migration.
create or replace function set_publish_cron(p_url text, p_secret text)
returns void
language plpgsql
security definer
set search_path = public, vault, cron
as $$
begin
  delete from vault.secrets where name in ('publish_due_url', 'publish_due_secret');
  perform vault.create_secret(p_url, 'publish_due_url');
  perform vault.create_secret(p_secret, 'publish_due_secret');
  perform cron.unschedule(jobid) from cron.job where jobname = 'publish-due';
  perform cron.schedule('publish-due', '* * * * *', $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'publish_due_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'publish_due_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 55000
    );
  $job$);
end;
$$;

revoke execute on function set_publish_cron(text, text) from public, anon, authenticated;
grant execute on function set_publish_cron(text, text) to service_role;
