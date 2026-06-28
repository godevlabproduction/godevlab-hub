-- Add guests count and confirmed status to bookings
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS guests INTEGER NOT NULL DEFAULT 1;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS confirmed BOOLEAN NOT NULL DEFAULT false;

-- Allow update on bookings (for confirming reservations)
CREATE POLICY "bookings_update" ON bookings FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin'));
