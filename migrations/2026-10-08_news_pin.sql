-- Pin a story to the top of the News tab (set from the admin app's News screen).
-- pinned_at is when it was pinned; NULL means not pinned. Pinned stories sort
-- first, most recently pinned on top. Admins can already update news_articles
-- (is_news_admin), so no policy change is needed.
alter table public.news_articles add column if not exists pinned_at timestamptz;
create index if not exists news_articles_pinned_idx on public.news_articles (pinned_at desc) where pinned_at is not null;
