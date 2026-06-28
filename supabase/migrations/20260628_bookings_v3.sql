-- Add booking source
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'private'
  CHECK (source IN ('private', 'airbnb', 'booking'));
