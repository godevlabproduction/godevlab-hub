-- Apartment bookings
CREATE TABLE IF NOT EXISTS bookings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_name      TEXT NOT NULL,
  phone           TEXT NOT NULL,
  country         TEXT NOT NULL,
  check_in        DATE NOT NULL,
  check_out       DATE NOT NULL,
  nights          INTEGER NOT NULL,
  price_per_night NUMERIC(10,2) NOT NULL,
  total_price     NUMERIC(10,2) NOT NULL,
  notes           TEXT,
  created_by      UUID NOT NULL REFERENCES employees(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Apartment expenses
CREATE TABLE IF NOT EXISTS expenses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  description TEXT NOT NULL,
  amount      NUMERIC(10,2) NOT NULL,
  date        DATE NOT NULL,
  created_by  UUID NOT NULL REFERENCES employees(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: bookings
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bookings_select" ON bookings FOR SELECT TO authenticated USING (true);
CREATE POLICY "bookings_insert" ON bookings FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
CREATE POLICY "bookings_delete" ON bookings FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin'));

-- RLS: expenses
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "expenses_select" ON expenses FOR SELECT TO authenticated USING (true);
CREATE POLICY "expenses_insert" ON expenses FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
CREATE POLICY "expenses_delete" ON expenses FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin'));
