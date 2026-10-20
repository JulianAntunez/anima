-- Permite corregir nombre, habitación y estadía de un huésped sin perder su historial.
-- Pegar en Supabase > SQL Editor > Run (se puede ejecutar varias veces). Requiere huespedes.sql.

alter table public.huespedes add column if not exists actualizado timestamptz;
