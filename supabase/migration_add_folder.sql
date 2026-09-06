-- Add manual folder assignment to documents (v1 single-level)
alter table public.documents add column if not exists folder text default null;
create index if not exists documents_folder_idx on public.documents (folder);
