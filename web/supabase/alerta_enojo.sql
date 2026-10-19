-- Alerta por mail cuando un episodio termina con enojo marcado como alerta.
-- Se envía desde Supabase con Resend (plan gratis). No usa Zapier.
-- Solo viaja hora y duración: nada de imágenes ni datos personales.
--
-- PASOS (Supabase > SQL Editor):
--  1) Ejecutar este archivo completo (la función y el trigger).
--  2) Guardar la clave de Resend en el Vault, UNA vez, con este comando aparte
--     (reemplazar re_xxx por tu clave; no la pegues en chat ni en el repo):
--        select vault.create_secret('re_xxx', 'resend_api_key');
--  3) Cambiar el destinatario más abajo (v_destino) por tu correo de Resend.

create extension if not exists pg_net with schema extensions;

create or replace function public.avisar_enojo() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_destino constant text := 'CORREO_DESTINO';   -- <- reemplazar
  v_min_ms  constant integer := 10000;           -- enojo mínimo para alertar (10 s)
  v_clave   text;
begin
  if new.alerta and new.dominante = 'enojado' and new.duracion_ms >= v_min_ms then
    select decrypted_secret into v_clave
      from vault.decrypted_secrets where name = 'resend_api_key';
    if v_clave is null then
      return new;  -- sin clave configurada no se rompe el guardado del episodio
    end if;

    begin
    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_clave
      ),
      body := jsonb_build_object(
        'from', 'Ánima <onboarding@resend.dev>',
        'to', jsonb_build_array(v_destino),
        'subject', 'Alerta: cliente enojado en Recepción',
        'text', 'Ánima detectó enojo sostenido en Recepción.' || E'\n' ||
                'Inicio: ' || to_char(new.inicio at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI:SS') || E'\n' ||
                'Duración: ' || round(new.duracion_ms / 1000.0) || ' segundos' || E'\n\n' ||
                'Sugerencia: acercarse a recepción y ofrecer ayuda.'
      )
    );
    exception when others then
      null;  -- si el mail falla, la atención igual se guarda
    end;
  end if;
  return new;
end $$;

drop trigger if exists al_insertar_episodio on public.episodios;
create trigger al_insertar_episodio after insert on public.episodios
  for each row execute function public.avisar_enojo();

-- Para desactivar la alerta:
-- drop trigger if exists al_insertar_episodio on public.episodios;
