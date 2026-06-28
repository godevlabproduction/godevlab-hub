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
