-- Optional seed memes for local dev (run after schema.sql)
INSERT INTO public.memes (image_url, tags, category)
VALUES
  (
    'https://picsum.photos/seed/vibe1/800/1000',
    '["dark_humor", "sarcasm", "general"]'::jsonb,
    'seed'
  ),
  (
    'https://picsum.photos/seed/vibe2/800/1000',
    '["wholesome", "animals", "general"]'::jsonb,
    'seed'
  ),
  (
    'https://picsum.photos/seed/vibe3/800/1000',
    '["gaming", "sarcasm", "reddit"]'::jsonb,
    'seed'
  ),
  (
    'https://picsum.photos/seed/vibe4/800/1000',
    '["anime", "wholesome", "general"]'::jsonb,
    'seed'
  ),
  (
    'https://picsum.photos/seed/vibe5/800/1000',
    '["politics", "dark_humor", "general"]'::jsonb,
    'seed'
  ),
  (
    'https://picsum.photos/seed/vibe6/800/1000',
    '["wholesome", "sarcasm", "reddit"]'::jsonb,
    'seed'
  ),
  (
    'https://picsum.photos/seed/vibe7/800/1000',
    '["dark_humor", "gaming", "general"]'::jsonb,
    'seed'
  ),
  (
    'https://picsum.photos/seed/vibe8/800/1000',
    '["sarcasm", "anime", "general"]'::jsonb,
    'seed'
  ),
  (
    'https://picsum.photos/seed/vibe9/800/1000',
    '["wholesome", "animals", "reddit"]'::jsonb,
    'seed'
  ),
  (
    'https://picsum.photos/seed/vibe10/800/1000',
    '["dark_humor", "sarcasm", "reddit"]'::jsonb,
    'seed'
  ),
  (
    'https://picsum.photos/seed/vibe11/800/1000',
    '["gaming", "wholesome", "general"]'::jsonb,
    'seed'
  ),
  (
    'https://picsum.photos/seed/vibe12/800/1000',
    '["dark_humor", "politics", "general"]'::jsonb,
    'seed'
  );
