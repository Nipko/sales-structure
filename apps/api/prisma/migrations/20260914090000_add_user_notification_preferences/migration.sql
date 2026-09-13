ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS notification_preferences JSONB NOT NULL DEFAULT
    '{"version":1,"soundEnabled":true,"categories":{"chat":true,"handoff":true,"compliance":true,"appointments":true,"automation":false,"orders":false,"system":true}}'::jsonb;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_notification_preferences_object;
ALTER TABLE public.users ADD CONSTRAINT users_notification_preferences_object
    CHECK (jsonb_typeof(notification_preferences) = 'object');
