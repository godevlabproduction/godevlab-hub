# Booking System Design

**Date:** 2026-06-28
**Scope:** Add a Bookings section to the GoDevLab hub for tracking apartment bookings, expenses, and financial summary

---

## Overview

A new "Bookings" sidebar section added to the hub after "Project Tracking". Single page at `/dashboard/bookings` with three tabs: Bookings, Expenses, Summary. One apartment, currency EUR throughout.

---

## Database

### `bookings`

```sql
CREATE TABLE bookings (
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
```

- `nights` = check_out - check_in in days, computed on the client before insert
- `total_price` = nights × price_per_night, computed on the client before insert
- RLS: SELECT all authenticated; INSERT `created_by = auth.uid()`; DELETE creator or admin

### `expenses`

```sql
CREATE TABLE expenses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  description TEXT NOT NULL,
  amount      NUMERIC(10,2) NOT NULL,
  date        DATE NOT NULL,
  created_by  UUID NOT NULL REFERENCES employees(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- RLS: SELECT all authenticated; INSERT `created_by = auth.uid()`; DELETE creator or admin

No `updated_at` triggers needed — bookings and expenses are immutable after creation (delete and re-create to correct).

---

## Types

Add to `src/types/index.ts`:

```ts
export interface Booking {
  id: string;
  guest_name: string;
  phone: string;
  country: string;
  check_in: string;
  check_out: string;
  nights: number;
  price_per_night: number;
  total_price: number;
  notes: string | null;
  created_by: string;
  created_at: string;
}

export interface Expense {
  id: string;
  description: string;
  amount: number;
  date: string;
  created_by: string;
  created_at: string;
}
```

---

## Queries

Add to `src/lib/supabase/queries.ts`:

- `getBookings(supabase)` — select all, order by check_in descending
- `createBooking(supabase, input)` — insert
- `deleteBooking(supabase, bookingId)` — delete
- `getExpenses(supabase)` — select all, order by date descending
- `createExpense(supabase, input)` — insert
- `deleteExpense(supabase, expenseId)` — delete

---

## Page

### `/dashboard/bookings`

Route: `src/app/dashboard/bookings/page.tsx`

Uses the existing `Tabs` UI component. Three tabs:

**Bookings tab**
- Left panel (form):
  - Guest name (text, required)
  - Phone (text, required)
  - Country (text, required)
  - Check-in date (date, required)
  - Check-out date (date, required)
  - Price per night in EUR (number, required)
  - Notes (textarea, optional)
  - Nights + Total auto-display below date fields (computed from inputs)
  - Submit button
- Right panel (list): bookings ordered by check_in desc
  - Each card: guest name, country, phone, check-in → check-out, nights, total price (€), notes if present
  - Delete button for creator or admin

**Expenses tab**
- Left panel (form):
  - Description (text, required)
  - Amount in EUR (number, required)
  - Date (date, required)
  - Submit button
- Right panel (list): expenses ordered by date desc
  - Each card: description, amount (€), date
  - Delete button for creator or admin

**Summary tab**
- Read-only cards:
  - Total Revenue (sum of all booking total_price) in €
  - Total Expenses (sum of all expense amounts) in €
  - Net Profit (revenue - expenses) in €
  - Total Bookings (count)
  - Total Nights Booked (sum of nights)
- All computed client-side from the already-fetched bookings and expenses data

---

## Sidebar

Update `src/components/sidebar.tsx` — add new section after "Project Tracking":

```ts
{
  title: "Bookings",
  items: [
    { href: "/dashboard/bookings", label: "Bookings", icon: BedDouble },
  ],
},
```

Import `BedDouble` from `lucide-react`.
