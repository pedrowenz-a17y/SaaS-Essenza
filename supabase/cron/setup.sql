-- Primeiro, cadastre estes segredos no Vault do Supabase.
-- essenza_app_url: origem pública da instalação (HTTPS em produção).
-- essenza_cron_secret: o mesmo valor de CRON_SECRET na Vercel.
-- Este arquivo pode ser reaplicado para atualizar a tarefa com o mesmo nome.
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if (select count(distinct name) from vault.decrypted_secrets
      where name in ('essenza_app_url','essenza_cron_secret')) <> 2 then
    raise exception 'Cadastre essenza_app_url e essenza_cron_secret no Vault antes de agendar.';
  end if;
end;
$$;

select cron.schedule('essenza-lembretes','*/5 * * * *',$job$
  select net.http_post(
    url := rtrim((select decrypted_secret from vault.decrypted_secrets where name='essenza_app_url'),'/')||'/api/cron/lembretes',
    headers := jsonb_build_object('Content-Type','application/json','Authorization',
      'Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='essenza_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
$job$);
