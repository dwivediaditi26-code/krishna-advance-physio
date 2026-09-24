-- PhysioMind — new-clinic Supabase setup.
-- Run this once in the NEW project's SQL Editor (Supabase Dashboard → SQL Editor → New query).
-- Reasonable defaults are used for RLS since the original project's exact policies aren't
-- available from the app's source file — compare against the first clinic's project if you
-- want an exact match, otherwise this is a sensible "any signed-in staff login, full access"
-- policy consistent with how the app itself gates access (client-side role checks only).

-- 1. The single table the whole app reads/writes: one row holds the entire clinic's data as JSON.
create table if not exists public.clinic_data (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.clinic_data enable row level security;

create policy "Authenticated staff can read clinic_data"
  on public.clinic_data for select
  to authenticated
  using (true);

create policy "Authenticated staff can write clinic_data"
  on public.clinic_data for insert
  to authenticated
  with check (true);

create policy "Authenticated staff can update clinic_data"
  on public.clinic_data for update
  to authenticated
  using (true)
  with check (true);

-- 2. Realtime — so a change on one device shows up live on another signed-in device.
alter publication supabase_realtime add table public.clinic_data;

-- 3. Storage buckets used by the app (documents, bill photos, assessment PDFs).
--    Private buckets — the app always reads them via short-lived signed URLs, never public links.
insert into storage.buckets (id, name, public)
values
  ('patient-documents', 'patient-documents', false),
  ('bill-photos', 'bill-photos', false),
  ('assessment-pdfs', 'assessment-pdfs', false)
on conflict (id) do nothing;

create policy "Authenticated staff can read patient-documents"
  on storage.objects for select to authenticated
  using (bucket_id = 'patient-documents');
create policy "Authenticated staff can upload patient-documents"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'patient-documents');
create policy "Authenticated staff can delete patient-documents"
  on storage.objects for delete to authenticated
  using (bucket_id = 'patient-documents');

create policy "Authenticated staff can read bill-photos"
  on storage.objects for select to authenticated
  using (bucket_id = 'bill-photos');
create policy "Authenticated staff can upload bill-photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'bill-photos');
create policy "Authenticated staff can delete bill-photos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'bill-photos');

create policy "Authenticated staff can read assessment-pdfs"
  on storage.objects for select to authenticated
  using (bucket_id = 'assessment-pdfs');
create policy "Authenticated staff can upload assessment-pdfs"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'assessment-pdfs');
create policy "Authenticated staff can delete assessment-pdfs"
  on storage.objects for delete to authenticated
  using (bucket_id = 'assessment-pdfs');

-- 4. Seed the single clinic_data row so the app's first login doesn't need to create it blind.
--    (The app's own JS seed — index.html's `const seed` — is what actually populates this on
--    first login if the row doesn't exist yet, so this insert is optional/defensive.)
insert into public.clinic_data (id, data, updated_at)
values ('main', '{}'::jsonb, now())
on conflict (id) do nothing;

-- After running this:
--   1. Authentication → Users → Add User, once per staff login (owner/therapist/receptionist),
--      each with User Metadata: {"role":"owner","name":"Dr. Whoever"}  (role must be exactly
--      "owner", "therapist" or "receptionist").
--   2. Authentication → URL Configuration → set Site URL + add this clinic's deployed URL to
--      Redirect URLs (needed for the "Forgot password" email link to work).
--   3. Deploy supabase/functions/swift-handler (this folder) — used by the owner's
--      Settings → Logins → "Set new password" screen.
