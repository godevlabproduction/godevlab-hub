# Booking System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Bookings section to the GoDevLab hub for tracking apartment bookings, expenses, and financial summary in EUR.

**Architecture:** Two new Supabase tables (`bookings`, `expenses`) with RLS. One new page at `/dashboard/bookings` with three tabs (Bookings, Expenses, Summary) using the existing `Tabs` UI component from `@base-ui/react`. Sidebar gets a new "Bookings" section.

**Tech Stack:** Next.js 16 (App Router), Supabase (`@supabase/ssr`), TanStack Query v5, Tailwind CSS, lucide-react, date-fns

## Global Constraints

- All pages are `"use client"` — no server components for data fetching (matches existing pattern)
- Data fetching via TanStack Query (`useQuery` / `useMutation`) with `queryClient.invalidateQueries` on mutations
- Supabase client from `createClient()` in `@/lib/supabase/client`
- Current employee from `useCurrentEmployee()` hook (`src/hooks/use-employee.ts`)
- Styling: Tailwind only, `brand-700` for primary actions, match existing card/form patterns
- No new dependencies — use only what is already installed
- Currency: EUR (€) throughout — display as `€${amount.toFixed(2)}`
- Tabs component: import `{ Tabs, TabsList, TabsTrigger, TabsContent }` from `@/components/ui/tabs`
- `TabsTrigger` uses `value` prop; `TabsContent` uses `value` prop; `Tabs` uses `defaultValue`
- No git commits — project has automated git handling
- Nights = `differenceInDays(new Date(check_out), new Date(check_in))` from date-fns
- `total_price` = nights × price_per_night, computed client-side before insert

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `supabase/migrations/20260628_bookings.sql` | DDL for bookings + expenses tables, RLS |
| Modify | `src/types/index.ts` | Add `Booking`, `Expense` interfaces |
| Modify | `src/lib/supabase/queries.ts` | Add 6 query/mutation functions |
| Create | `src/app/dashboard/bookings/page.tsx` | Bookings page with 3 tabs |
| Modify | `src/components/sidebar.tsx` | Add Bookings section |

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260628_bookings.sql`

**Interfaces:**
- Produces: `bookings` and `expenses` tables in Supabase, ready for queries

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/20260628_bookings.sql`:

```sql
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
```

- [ ] **Step 2: Apply the migration**

Open Supabase dashboard → SQL Editor → paste the full content of `supabase/migrations/20260628_bookings.sql` → Run.

Expected: no errors, two new tables visible in Table Editor.

- [ ] **Step 3: Verify tables exist**

In Supabase Table Editor, confirm:
- `bookings` has all columns including `nights`, `price_per_night`, `total_price`
- `expenses` has `description`, `amount`, `date`
- Both have RLS enabled

---

## Task 2: Types and Query Functions

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/lib/supabase/queries.ts`

**Interfaces:**
- Produces:
  - `Booking` interface
  - `Expense` interface
  - `getBookings(supabase): Promise<Booking[]>`
  - `createBooking(supabase, input): Promise<Booking>`
  - `deleteBooking(supabase, bookingId: string): Promise<void>`
  - `getExpenses(supabase): Promise<Expense[]>`
  - `createExpense(supabase, input): Promise<Expense>`
  - `deleteExpense(supabase, expenseId: string): Promise<void>`

- [ ] **Step 1: Add types to `src/types/index.ts`**

Append after the `PersonalTask` interface (at the end of the file, before `ReportJson`):

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

- [ ] **Step 2: Update imports in `src/lib/supabase/queries.ts`**

Replace the existing type import at the top with:

```ts
import type {
  Employee, Project, ProjectTask, ProjectUpdate, Note,
  ProjectStatus, ProjectPriority, TaskStatus, UpdateType,
  EmployeeTask, PersonalTask, Booking, Expense,
} from "@/types";
```

- [ ] **Step 3: Append query functions to `src/lib/supabase/queries.ts`**

Add at the end of the file:

```ts
export async function getBookings(supabase: SupabaseClient): Promise<Booking[]> {
  const { data } = await supabase
    .from("bookings")
    .select("*")
    .order("check_in", { ascending: false });
  return data ?? [];
}

export async function createBooking(
  supabase: SupabaseClient,
  input: {
    guest_name: string; phone: string; country: string;
    check_in: string; check_out: string; nights: number;
    price_per_night: number; total_price: number;
    notes?: string; created_by: string;
  }
): Promise<Booking> {
  const { data, error } = await supabase.from("bookings").insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function deleteBooking(supabase: SupabaseClient, bookingId: string): Promise<void> {
  const { error } = await supabase.from("bookings").delete().eq("id", bookingId);
  if (error) throw error;
}

export async function getExpenses(supabase: SupabaseClient): Promise<Expense[]> {
  const { data } = await supabase
    .from("expenses")
    .select("*")
    .order("date", { ascending: false });
  return data ?? [];
}

export async function createExpense(
  supabase: SupabaseClient,
  input: { description: string; amount: number; date: string; created_by: string }
): Promise<Expense> {
  const { data, error } = await supabase.from("expenses").insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function deleteExpense(supabase: SupabaseClient, expenseId: string): Promise<void> {
  const { error } = await supabase.from("expenses").delete().eq("id", expenseId);
  if (error) throw error;
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no output, no errors.

---

## Task 3: Bookings Page

**Files:**
- Create: `src/app/dashboard/bookings/page.tsx`

**Interfaces:**
- Consumes:
  - `getBookings`, `createBooking`, `deleteBooking` from `@/lib/supabase/queries`
  - `getExpenses`, `createExpense`, `deleteExpense` from `@/lib/supabase/queries`
  - `Booking`, `Expense` from `@/types`
  - `useCurrentEmployee` from `@/hooks/use-employee`
  - `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` from `@/components/ui/tabs`
  - `differenceInDays`, `format` from `date-fns`

- [ ] **Step 1: Create the directory and page file**

Create `src/app/dashboard/bookings/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { differenceInDays, format } from "date-fns";
import { BedDouble, PlusCircle, Trash2, TrendingUp, TrendingDown, Euro } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  getBookings, createBooking, deleteBooking,
  getExpenses, createExpense, deleteExpense,
} from "@/lib/supabase/queries";
import { useCurrentEmployee } from "@/hooks/use-employee";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export default function BookingsPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { data: employee } = useCurrentEmployee();

  // Booking form state
  const [guestName, setGuestName] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [pricePerNight, setPricePerNight] = useState("");
  const [notes, setNotes] = useState("");

  // Expense form state
  const [expDescription, setExpDescription] = useState("");
  const [expAmount, setExpAmount] = useState("");
  const [expDate, setExpDate] = useState("");

  const { data: bookings = [] } = useQuery({ queryKey: ["bookings"], queryFn: () => getBookings(supabase) });
  const { data: expenses = [] } = useQuery({ queryKey: ["expenses"], queryFn: () => getExpenses(supabase) });

  const nights = checkIn && checkOut && checkOut > checkIn
    ? differenceInDays(new Date(checkOut), new Date(checkIn))
    : 0;
  const totalPrice = nights > 0 && pricePerNight ? nights * parseFloat(pricePerNight) : 0;

  const createBookingMutation = useMutation({
    mutationFn: () => createBooking(supabase, {
      guest_name: guestName,
      phone,
      country,
      check_in: checkIn,
      check_out: checkOut,
      nights,
      price_per_night: parseFloat(pricePerNight),
      total_price: totalPrice,
      notes: notes || undefined,
      created_by: employee!.id,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bookings"] });
      setGuestName(""); setPhone(""); setCountry(""); setCheckIn(""); setCheckOut(""); setPricePerNight(""); setNotes("");
    },
  });

  const deleteBookingMutation = useMutation({
    mutationFn: (id: string) => deleteBooking(supabase, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bookings"] }),
  });

  const createExpenseMutation = useMutation({
    mutationFn: () => createExpense(supabase, {
      description: expDescription,
      amount: parseFloat(expAmount),
      date: expDate,
      created_by: employee!.id,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      setExpDescription(""); setExpAmount(""); setExpDate("");
    },
  });

  const deleteExpenseMutation = useMutation({
    mutationFn: (id: string) => deleteExpense(supabase, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["expenses"] }),
  });

  const canCreateBooking = Boolean(guestName && phone && country && checkIn && checkOut && checkOut > checkIn && pricePerNight && employee);
  const canCreateExpense = Boolean(expDescription && expAmount && expDate && employee);
  const canManage = (createdBy: string) => employee?.role === "admin" || createdBy === employee?.id;

  const totalRevenue = bookings.reduce((sum, b) => sum + Number(b.total_price), 0);
  const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
  const netProfit = totalRevenue - totalExpenses;
  const totalNights = bookings.reduce((sum, b) => sum + b.nights, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <BedDouble className="h-6 w-6 text-brand-700" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Bookings</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Track apartment bookings, expenses, and revenue.</p>
        </div>
      </div>

      <Tabs defaultValue="bookings">
        <TabsList>
          <TabsTrigger value="bookings">Bookings</TabsTrigger>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="summary">Summary</TabsTrigger>
        </TabsList>

        {/* ── BOOKINGS TAB ── */}
        <TabsContent value="bookings">
          <div className="mt-4 grid gap-6 xl:grid-cols-[400px_minmax(0,1fr)]">
            <Card className="h-fit">
              <CardHeader><CardTitle className="text-base">New Booking</CardTitle></CardHeader>
              <CardContent>
                <form
                  onSubmit={e => { e.preventDefault(); if (canCreateBooking) createBookingMutation.mutate(); }}
                  className="space-y-4"
                >
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">Guest name</label>
                    <Input value={guestName} onChange={e => setGuestName(e.target.value)} placeholder="Full name" />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">Phone</label>
                    <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+389 ..." />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">Country</label>
                    <Input value={country} onChange={e => setCountry(e.target.value)} placeholder="e.g. Germany" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium">Check-in</label>
                      <Input type="date" value={checkIn} onChange={e => setCheckIn(e.target.value)} />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium">Check-out</label>
                      <Input type="date" value={checkOut} onChange={e => setCheckOut(e.target.value)} />
                    </div>
                  </div>
                  {nights > 0 && (
                    <p className="text-xs text-muted-foreground">{nights} night{nights !== 1 ? "s" : ""}</p>
                  )}
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">Price per night (€)</label>
                    <Input type="number" min="0" step="0.01" value={pricePerNight} onChange={e => setPricePerNight(e.target.value)} placeholder="0.00" />
                  </div>
                  {totalPrice > 0 && (
                    <p className="text-sm font-semibold text-brand-700">Total: €{totalPrice.toFixed(2)}</p>
                  )}
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">Notes (optional)</label>
                    <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any notes..." rows={2} />
                  </div>
                  <Button
                    type="submit"
                    className="w-full bg-brand-700 hover:bg-brand-800"
                    disabled={!canCreateBooking || createBookingMutation.isPending}
                  >
                    <PlusCircle className="mr-2 h-4 w-4" />
                    {createBookingMutation.isPending ? "Adding..." : "Add Booking"}
                  </Button>
                </form>
              </CardContent>
            </Card>

            <div className="space-y-3">
              {bookings.length === 0 ? (
                <Card>
                  <CardContent className="flex min-h-40 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                    <BedDouble className="h-6 w-6" />
                    No bookings yet.
                  </CardContent>
                </Card>
              ) : bookings.map(booking => (
                <Card key={booking.id}>
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-gray-900">{booking.guest_name}</p>
                          <span className="text-xs text-muted-foreground">· {booking.country}</span>
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">{booking.phone}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                          <span>{format(new Date(booking.check_in), "MMM d")} → {format(new Date(booking.check_out), "MMM d, yyyy")}</span>
                          <span>{booking.nights} night{booking.nights !== 1 ? "s" : ""}</span>
                          <span className="font-semibold text-brand-700">€{Number(booking.total_price).toFixed(2)}</span>
                        </div>
                        {booking.notes && (
                          <p className="mt-2 text-xs text-muted-foreground">{booking.notes}</p>
                        )}
                      </div>
                      {canManage(booking.created_by) && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-red-600"
                          onClick={() => deleteBookingMutation.mutate(booking.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </TabsContent>

        {/* ── EXPENSES TAB ── */}
        <TabsContent value="expenses">
          <div className="mt-4 grid gap-6 xl:grid-cols-[400px_minmax(0,1fr)]">
            <Card className="h-fit">
              <CardHeader><CardTitle className="text-base">New Expense</CardTitle></CardHeader>
              <CardContent>
                <form
                  onSubmit={e => { e.preventDefault(); if (canCreateExpense) createExpenseMutation.mutate(); }}
                  className="space-y-4"
                >
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">Description</label>
                    <Input value={expDescription} onChange={e => setExpDescription(e.target.value)} placeholder="e.g. Cleaning, Repair..." />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">Amount (€)</label>
                    <Input type="number" min="0" step="0.01" value={expAmount} onChange={e => setExpAmount(e.target.value)} placeholder="0.00" />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">Date</label>
                    <Input type="date" value={expDate} onChange={e => setExpDate(e.target.value)} />
                  </div>
                  <Button
                    type="submit"
                    className="w-full bg-brand-700 hover:bg-brand-800"
                    disabled={!canCreateExpense || createExpenseMutation.isPending}
                  >
                    <PlusCircle className="mr-2 h-4 w-4" />
                    {createExpenseMutation.isPending ? "Adding..." : "Add Expense"}
                  </Button>
                </form>
              </CardContent>
            </Card>

            <div className="space-y-3">
              {expenses.length === 0 ? (
                <Card>
                  <CardContent className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
                    No expenses yet.
                  </CardContent>
                </Card>
              ) : expenses.map(expense => (
                <Card key={expense.id}>
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-gray-900">{expense.description}</p>
                        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="font-semibold text-red-600">€{Number(expense.amount).toFixed(2)}</span>
                          <span>{format(new Date(expense.date), "MMM d, yyyy")}</span>
                        </div>
                      </div>
                      {canManage(expense.created_by) && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-red-600"
                          onClick={() => deleteExpenseMutation.mutate(expense.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </TabsContent>

        {/* ── SUMMARY TAB ── */}
        <TabsContent value="summary">
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-50">
                    <TrendingUp className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total Revenue</p>
                    <p className="text-2xl font-bold text-gray-900">€{totalRevenue.toFixed(2)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-50">
                    <TrendingDown className="h-5 w-5 text-red-600" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total Expenses</p>
                    <p className="text-2xl font-bold text-gray-900">€{totalExpenses.toFixed(2)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${netProfit >= 0 ? "bg-brand-50" : "bg-red-50"}`}>
                    <Euro className={`h-5 w-5 ${netProfit >= 0 ? "text-brand-700" : "text-red-600"}`} />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Net Profit</p>
                    <p className={`text-2xl font-bold ${netProfit >= 0 ? "text-gray-900" : "text-red-600"}`}>
                      {netProfit < 0 ? "-" : ""}€{Math.abs(netProfit).toFixed(2)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-50">
                    <BedDouble className="h-5 w-5 text-sky-600" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total Bookings</p>
                    <p className="text-2xl font-bold text-gray-900">{bookings.length}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50">
                    <BedDouble className="h-5 w-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total Nights Booked</p>
                    <p className="text-2xl font-bold text-gray-900">{totalNights}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no output, no errors.

---

## Task 4: Sidebar Navigation

**Files:**
- Modify: `src/components/sidebar.tsx`

**Interfaces:**
- Produces: "Bookings" section visible in sidebar after "Project Tracking"

- [ ] **Step 1: Update lucide import in `src/components/sidebar.tsx`**

Replace:
```ts
import {
  LayoutDashboard, FolderKanban, StickyNote, Users, LogOut, Sparkles,
  ClipboardList, CheckSquare,
} from "lucide-react";
```

With:
```ts
import {
  LayoutDashboard, FolderKanban, StickyNote, Users, LogOut, Sparkles,
  ClipboardList, CheckSquare, BedDouble,
} from "lucide-react";
```

- [ ] **Step 2: Add Bookings section to `navSections` in `src/components/sidebar.tsx`**

Replace:
```ts
const navSections = [
  {
    title: "Operations",
    items: [
      { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
      { href: "/dashboard/employees", label: "Employees", icon: Users },
      { href: "/dashboard/operations/employee-tasks", label: "Employee Tasks", icon: ClipboardList },
      { href: "/dashboard/operations/personal-tasks", label: "My Tasks", icon: CheckSquare },
    ],
  },
  {
    title: "Project Tracking",
    items: [
      { href: "/dashboard/projects", label: "Projects", icon: FolderKanban },
      { href: "/dashboard/notes", label: "Notes", icon: StickyNote },
    ],
  },
];
```

With:
```ts
const navSections = [
  {
    title: "Operations",
    items: [
      { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
      { href: "/dashboard/employees", label: "Employees", icon: Users },
      { href: "/dashboard/operations/employee-tasks", label: "Employee Tasks", icon: ClipboardList },
      { href: "/dashboard/operations/personal-tasks", label: "My Tasks", icon: CheckSquare },
    ],
  },
  {
    title: "Project Tracking",
    items: [
      { href: "/dashboard/projects", label: "Projects", icon: FolderKanban },
      { href: "/dashboard/notes", label: "Notes", icon: StickyNote },
    ],
  },
  {
    title: "Bookings",
    items: [
      { href: "/dashboard/bookings", label: "Bookings", icon: BedDouble },
    ],
  },
];
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no output, no errors.

- [ ] **Step 4: Run dev server and verify end-to-end**

```bash
npm run dev
```

Check:
1. Sidebar shows "Bookings" section at the bottom with a bed icon
2. `/dashboard/bookings` loads with three tabs: Bookings, Expenses, Summary
3. Add a booking — confirm nights and total auto-calculate, confirm it appears in the list
4. Add an expense — confirm it appears in the list
5. Switch to Summary tab — confirm revenue, expenses, profit, booking count, total nights all update
6. Delete a booking and expense — confirm they disappear and summary updates
