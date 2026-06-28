"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  differenceInDays, format, startOfMonth, endOfMonth, eachDayOfInterval,
  getDay, isBefore, isToday, addMonths, subMonths, parseISO, isSameDay,
} from "date-fns";
import {
  BedDouble, PlusCircle, Trash2, TrendingUp, TrendingDown, Euro,
  ChevronLeft, ChevronRight, CheckCircle2, Clock, Users, Pencil, X, Save,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  getBookings, createBooking, updateBooking, deleteBooking, confirmBooking,
  getExpenses, createExpense, deleteExpense,
} from "@/lib/supabase/queries";
import { useCurrentEmployee } from "@/hooks/use-employee";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { Booking, BookingSource } from "@/types";

const SOURCE_LABELS: Record<BookingSource, string> = {
  private: "Private",
  airbnb: "Airbnb",
  booking: "Booking.com",
};
const SOURCE_STYLES: Record<BookingSource, string> = {
  private: "bg-gray-100 text-gray-700",
  airbnb: "bg-rose-50 text-rose-700",
  booking: "bg-blue-50 text-blue-700",
};

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function getBookingForDay(day: Date, bookings: Booking[]): Booking | null {
  for (const b of bookings) {
    const checkIn = parseISO(b.check_in);
    const checkOut = parseISO(b.check_out);
    if ((isSameDay(day, checkIn) || isBefore(checkIn, day)) && isBefore(day, checkOut)) {
      return b;
    }
  }
  return null;
}

export default function BookingsPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { data: employee } = useCurrentEmployee();
  const today = new Date();

  // Booking form state
  const [guestName, setGuestName] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [pricePerNight, setPricePerNight] = useState("");
  const [guests, setGuests] = useState("1");
  const [source, setSource] = useState<BookingSource>("private");
  const [notes, setNotes] = useState("");

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<Partial<Booking>>({});

  // Expense form state
  const [expDescription, setExpDescription] = useState("");
  const [expAmount, setExpAmount] = useState("");
  const [expDate, setExpDate] = useState("");

  // Calendar state
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());

  const { data: bookings = [] } = useQuery({ queryKey: ["bookings"], queryFn: () => getBookings(supabase) });
  const { data: expenses = [] } = useQuery({ queryKey: ["expenses"], queryFn: () => getExpenses(supabase) });

  const nights = checkIn && checkOut && checkOut > checkIn
    ? differenceInDays(new Date(checkOut), new Date(checkIn))
    : 0;
  const totalPrice = nights > 0 && pricePerNight ? nights * parseFloat(pricePerNight) : 0;

  const editNights = editFields.check_in && editFields.check_out && editFields.check_out > editFields.check_in
    ? differenceInDays(new Date(editFields.check_out), new Date(editFields.check_in))
    : (editFields.nights ?? 0);
  const editTotal = editNights > 0 && editFields.price_per_night
    ? editNights * Number(editFields.price_per_night)
    : (editFields.total_price ?? 0);

  const startEdit = (b: Booking) => {
    setEditingId(b.id);
    setEditFields({ ...b });
  };
  const cancelEdit = () => { setEditingId(null); setEditFields({}); };

  const createBookingMutation = useMutation({
    mutationFn: () => createBooking(supabase, {
      guest_name: guestName, phone, country,
      check_in: checkIn, check_out: checkOut,
      nights, guests: parseInt(guests) || 1,
      price_per_night: parseFloat(pricePerNight),
      total_price: totalPrice,
      notes: notes || undefined,
      source,
      created_by: employee!.id,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bookings"] });
      setGuestName(""); setPhone(""); setCountry(""); setCheckIn(""); setCheckOut("");
      setPricePerNight(""); setGuests("1"); setSource("private"); setNotes("");
    },
  });

  const updateBookingMutation = useMutation({
    mutationFn: () => updateBooking(supabase, editingId!, {
      guest_name: editFields.guest_name!,
      phone: editFields.phone!,
      country: editFields.country!,
      check_in: editFields.check_in!,
      check_out: editFields.check_out!,
      nights: editNights,
      guests: editFields.guests ?? 1,
      price_per_night: Number(editFields.price_per_night),
      total_price: editTotal,
      notes: editFields.notes || undefined,
      source: (editFields.source ?? "private") as BookingSource,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bookings"] });
      cancelEdit();
    },
  });

  const deleteBookingMutation = useMutation({
    mutationFn: (id: string) => deleteBooking(supabase, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bookings"] }),
  });

  const confirmMutation = useMutation({
    mutationFn: (id: string) => confirmBooking(supabase, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bookings"] }),
  });

  const createExpenseMutation = useMutation({
    mutationFn: () => createExpense(supabase, {
      description: expDescription, amount: parseFloat(expAmount), date: expDate, created_by: employee!.id,
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

  // Summary calculations
  const confirmedBookings = bookings.filter(b => b.confirmed);
  const upcomingBookings = bookings.filter(b => !b.confirmed && !isBefore(parseISO(b.check_out), today));
  const totalConfirmedRevenue = confirmedBookings.reduce((s, b) => s + Number(b.total_price), 0);
  const totalUpcomingRevenue = upcomingBookings.reduce((s, b) => s + Number(b.total_price), 0);
  const totalExpensesSum = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const netProfit = totalConfirmedRevenue - totalExpensesSum;
  const totalNights = confirmedBookings.reduce((s, b) => s + b.nights, 0);

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
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
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
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium">Country</label>
                      <Input value={country} onChange={e => setCountry(e.target.value)} placeholder="e.g. Germany" />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium">Guests</label>
                      <Input type="number" min="1" value={guests} onChange={e => setGuests(e.target.value)} placeholder="1" />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">Source</label>
                    <select value={source} onChange={e => setSource(e.target.value as BookingSource)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <option value="private">Private</option>
                      <option value="airbnb">Airbnb</option>
                      <option value="booking">Booking.com</option>
                    </select>
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
                  <Button type="submit" className="w-full bg-brand-700 hover:bg-brand-800" disabled={!canCreateBooking || createBookingMutation.isPending}>
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
              ) : bookings.map(booking => {
                const isEditing = editingId === booking.id;
                return (
                  <Card key={booking.id} className={booking.confirmed ? "border-emerald-200" : ""}>
                    <CardContent className="p-5">
                      {isEditing ? (
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="mb-1 block text-xs font-medium">Guest name</label>
                              <Input value={editFields.guest_name ?? ""} onChange={e => setEditFields(f => ({ ...f, guest_name: e.target.value }))} />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-medium">Phone</label>
                              <Input value={editFields.phone ?? ""} onChange={e => setEditFields(f => ({ ...f, phone: e.target.value }))} />
                            </div>
                          </div>
                          <div className="grid grid-cols-3 gap-3">
                            <div>
                              <label className="mb-1 block text-xs font-medium">Country</label>
                              <Input value={editFields.country ?? ""} onChange={e => setEditFields(f => ({ ...f, country: e.target.value }))} />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-medium">Guests</label>
                              <Input type="number" min="1" value={editFields.guests ?? 1} onChange={e => setEditFields(f => ({ ...f, guests: parseInt(e.target.value) || 1 }))} />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-medium">Source</label>
                              <select value={editFields.source ?? "private"} onChange={e => setEditFields(f => ({ ...f, source: e.target.value as BookingSource }))} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                <option value="private">Private</option>
                                <option value="airbnb">Airbnb</option>
                                <option value="booking">Booking.com</option>
                              </select>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="mb-1 block text-xs font-medium">Check-in</label>
                              <Input type="date" value={editFields.check_in ?? ""} onChange={e => setEditFields(f => ({ ...f, check_in: e.target.value }))} />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-medium">Check-out</label>
                              <Input type="date" value={editFields.check_out ?? ""} onChange={e => setEditFields(f => ({ ...f, check_out: e.target.value }))} />
                            </div>
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium">Price per night (€)</label>
                            <Input type="number" min="0" step="0.01" value={editFields.price_per_night ?? ""} onChange={e => setEditFields(f => ({ ...f, price_per_night: parseFloat(e.target.value) }))} />
                          </div>
                          {editNights > 0 && <p className="text-xs text-muted-foreground">{editNights} nights · Total: <span className="font-semibold text-brand-700">€{editTotal.toFixed(2)}</span></p>}
                          <div>
                            <label className="mb-1 block text-xs font-medium">Notes</label>
                            <Textarea rows={2} value={editFields.notes ?? ""} onChange={e => setEditFields(f => ({ ...f, notes: e.target.value }))} />
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" className="bg-brand-700 hover:bg-brand-800" onClick={() => updateBookingMutation.mutate()} disabled={updateBookingMutation.isPending}>
                              <Save className="mr-1 h-3.5 w-3.5" />{updateBookingMutation.isPending ? "Saving..." : "Save"}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={cancelEdit}><X className="mr-1 h-3.5 w-3.5" />Cancel</Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-semibold text-gray-900">{booking.guest_name}</p>
                              <span className="text-xs text-muted-foreground">· {booking.country}</span>
                              <span className="flex items-center gap-1 text-xs text-muted-foreground"><Users className="h-3 w-3" />{booking.guests}</span>
                              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${SOURCE_STYLES[booking.source]}`}>{SOURCE_LABELS[booking.source]}</span>
                              {booking.confirmed ? (
                                <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"><CheckCircle2 className="h-3 w-3" /> Confirmed</span>
                              ) : (
                                <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"><Clock className="h-3 w-3" /> Pending</span>
                              )}
                            </div>
                            <p className="mt-0.5 text-xs text-muted-foreground">{booking.phone}</p>
                            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                              <span>{format(parseISO(booking.check_in), "MMM d")} → {format(parseISO(booking.check_out), "MMM d, yyyy")}</span>
                              <span>{booking.nights} night{booking.nights !== 1 ? "s" : ""}</span>
                              <span className="font-semibold text-brand-700">€{Number(booking.total_price).toFixed(2)}</span>
                            </div>
                            {booking.notes && <p className="mt-2 text-xs text-muted-foreground">{booking.notes}</p>}
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            {!booking.confirmed && canManage(booking.created_by) && (
                              <Button type="button" variant="ghost" size="sm" className="text-xs text-emerald-700 hover:bg-emerald-50" onClick={() => confirmMutation.mutate(booking.id)} disabled={confirmMutation.isPending}>
                                <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Confirm
                              </Button>
                            )}
                            {canManage(booking.created_by) && (
                              <>
                                <Button type="button" variant="ghost" size="icon" className="text-muted-foreground hover:text-brand-700" onClick={() => startEdit(booking)}>
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button type="button" variant="ghost" size="icon" className="text-muted-foreground hover:text-red-600" onClick={() => deleteBookingMutation.mutate(booking.id)}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        </TabsContent>

        {/* ── EXPENSES TAB ── */}
        <TabsContent value="expenses">
          <div className="mt-4 grid gap-6 xl:grid-cols-[400px_minmax(0,1fr)]">
            <Card className="h-fit">
              <CardHeader><CardTitle className="text-base">New Expense</CardTitle></CardHeader>
              <CardContent>
                <form onSubmit={e => { e.preventDefault(); if (canCreateExpense) createExpenseMutation.mutate(); }} className="space-y-4">
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
                  <Button type="submit" className="w-full bg-brand-700 hover:bg-brand-800" disabled={!canCreateExpense || createExpenseMutation.isPending}>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    {createExpenseMutation.isPending ? "Adding..." : "Add Expense"}
                  </Button>
                </form>
              </CardContent>
            </Card>
            <div className="space-y-3">
              {expenses.length === 0 ? (
                <Card><CardContent className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">No expenses yet.</CardContent></Card>
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
                        <Button type="button" variant="ghost" size="icon" className="text-muted-foreground hover:text-red-600" onClick={() => deleteExpenseMutation.mutate(expense.id)}>
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
          <div className="mt-4 space-y-6">
            {/* Key financials */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50">
                      <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Confirmed Revenue</p>
                      <p className="text-2xl font-bold text-gray-900">€{totalConfirmedRevenue.toFixed(2)}</p>
                      <p className="text-xs text-muted-foreground">{confirmedBookings.length} reservation{confirmedBookings.length !== 1 ? "s" : ""}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50">
                      <Clock className="h-5 w-5 text-amber-600" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Upcoming Expected</p>
                      <p className="text-2xl font-bold text-gray-900">€{totalUpcomingRevenue.toFixed(2)}</p>
                      <p className="text-xs text-muted-foreground">{upcomingBookings.length} pending reservation{upcomingBookings.length !== 1 ? "s" : ""}</p>
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
                      <p className="text-2xl font-bold text-gray-900">€{totalExpensesSum.toFixed(2)}</p>
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
                      <p className="text-xs text-muted-foreground">Net Profit (confirmed)</p>
                      <p className={`text-2xl font-bold ${netProfit >= 0 ? "text-gray-900" : "text-red-600"}`}>
                        {netProfit < 0 ? "-" : ""}€{Math.abs(netProfit).toFixed(2)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Stats row */}
            <div className="grid gap-4 sm:grid-cols-3">
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-50">
                      <BedDouble className="h-5 w-5 text-sky-600" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Total Nights (confirmed)</p>
                      <p className="text-2xl font-bold text-gray-900">{totalNights}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-50">
                      <TrendingUp className="h-5 w-5 text-purple-600" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Total if All Confirmed</p>
                      <p className="text-2xl font-bold text-gray-900">€{(totalConfirmedRevenue + totalUpcomingRevenue).toFixed(2)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-50">
                      <Users className="h-5 w-5 text-gray-600" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Total Guests (confirmed)</p>
                      <p className="text-2xl font-bold text-gray-900">{confirmedBookings.reduce((s, b) => s + b.guests, 0)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* All reservations table */}
            <Card>
              <CardHeader><CardTitle className="text-base">All Reservations</CardTitle></CardHeader>
              <CardContent>
                {bookings.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No reservations yet.</p>
                ) : (
                  <div className="space-y-2">
                    {[...bookings].sort((a, b) => a.check_in.localeCompare(b.check_in)).map(b => {
                      const isPast = isBefore(parseISO(b.check_out), today);
                      const isOngoing = !isBefore(parseISO(b.check_out), today) && !isBefore(today, parseISO(b.check_in));
                      return (
                        <div key={b.id} className={`flex items-center justify-between gap-4 rounded-lg border px-4 py-3 ${isPast ? "border-gray-100 bg-gray-50 opacity-70" : isOngoing ? "border-brand-200 bg-brand-50" : "border-gray-200 bg-white"}`}>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-medium text-gray-900">{b.guest_name}</p>
                              <span className="text-xs text-muted-foreground">· {b.country}</span>
                              <span className="flex items-center gap-1 text-xs text-muted-foreground"><Users className="h-3 w-3" />{b.guests}</span>
                            </div>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {format(parseISO(b.check_in), "MMM d")} → {format(parseISO(b.check_out), "MMM d, yyyy")} · {b.nights} night{b.nights !== 1 ? "s" : ""}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-3">
                            <span className="text-sm font-semibold text-gray-900">€{Number(b.total_price).toFixed(2)}</span>
                            {b.confirmed ? (
                              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Confirmed</span>
                            ) : isPast ? (
                              <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">Unconfirmed</span>
                            ) : isOngoing ? (
                              <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">Ongoing</span>
                            ) : (
                              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">Upcoming</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── CALENDAR TAB ── */}
        <TabsContent value="calendar">
          <CalendarView bookings={bookings} month={calendarMonth} onMonthChange={setCalendarMonth} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CalendarView({
  bookings,
  month,
  onMonthChange,
}: {
  bookings: Booking[];
  month: Date;
  onMonthChange: (m: Date) => void;
}) {
  const today = new Date();
  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const leadingDays = (getDay(monthStart) + 6) % 7;

  const upcomingBookings = bookings
    .filter(b => !isBefore(parseISO(b.check_out), today))
    .sort((a, b) => a.check_in.localeCompare(b.check_in));

  const pastBookings = bookings
    .filter(b => isBefore(parseISO(b.check_out), today))
    .sort((a, b) => b.check_in.localeCompare(a.check_in));

  return (
    <div className="mt-4 space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">{format(month, "MMMM yyyy")}</CardTitle>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" onClick={() => onMonthChange(subMonths(month, 1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" className="text-xs" onClick={() => onMonthChange(new Date())}>
                Today
              </Button>
              <Button variant="ghost" size="icon" onClick={() => onMonthChange(addMonths(month, 1))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-1 grid grid-cols-7 gap-1">
            {DAY_LABELS.map(d => (
              <div key={d} className="py-1 text-center text-xs font-semibold text-muted-foreground">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: leadingDays }).map((_, i) => <div key={`e-${i}`} />)}
            {days.map(day => {
              const booking = getBookingForDay(day, bookings);
              const isPast = isBefore(day, today) && !isToday(day);
              const isCheckIn = booking ? isSameDay(day, parseISO(booking.check_in)) : false;
              const isCheckOut = booking ? isSameDay(day, parseISO(booking.check_out)) : false;

              let cellBg = "bg-gray-50", textColor = "text-gray-400", borderStyle = "border border-gray-100";
              if (isToday(day)) {
                cellBg = booking ? "bg-brand-700" : "bg-brand-50";
                textColor = booking ? "text-white" : "text-brand-700";
                borderStyle = "border-2 border-brand-700";
              } else if (booking && !isPast) {
                cellBg = "bg-emerald-50"; textColor = "text-emerald-800"; borderStyle = "border border-emerald-200";
              } else if (booking && isPast) {
                cellBg = "bg-gray-100"; textColor = "text-gray-500"; borderStyle = "border border-gray-200";
              } else if (!isPast) {
                cellBg = "bg-white"; textColor = "text-gray-700"; borderStyle = "border border-gray-100";
              }

              return (
                <div key={day.toISOString()} className={`rounded-lg p-1.5 ${cellBg} ${borderStyle} min-h-[72px]`}>
                  <div className={`mb-1 text-xs font-semibold ${textColor}`}>{format(day, "d")}</div>
                  {booking && (
                    <div className="space-y-0.5">
                      {isCheckIn && (
                        <div className={`rounded px-1 py-0.5 text-[10px] font-bold ${isPast ? "bg-gray-200 text-gray-600" : "bg-emerald-600 text-white"}`}>IN</div>
                      )}
                      <p className={`truncate text-[10px] font-medium leading-tight ${textColor}`}>{booking.guest_name.split(" ")[0]}</p>
                      <p className={`text-[10px] leading-tight ${isPast ? "text-gray-400" : "text-emerald-600"}`}>€{Number(booking.price_per_night).toFixed(0)}/n</p>
                      <p className={`text-[10px] leading-tight ${isPast ? "text-gray-400" : "text-emerald-600"}`}><Users className="inline h-2.5 w-2.5" /> {booking.guests}</p>
                      {isCheckOut && (
                        <div className={`rounded px-1 py-0.5 text-[10px] font-bold ${isPast ? "bg-gray-300 text-gray-600" : "bg-amber-100 text-amber-700"}`}>OUT</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-emerald-50 border border-emerald-200" /> Upcoming</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-gray-100 border border-gray-200" /> Past</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-brand-700" /> Today</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-white border border-gray-100" /> Free</span>
          </div>
        </CardContent>
      </Card>

      {upcomingBookings.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-900">Upcoming Reservations</h3>
          {upcomingBookings.map(b => {
            const isOngoing = !isBefore(today, parseISO(b.check_in));
            return (
              <Card key={b.id} className="border-emerald-200">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-gray-900">{b.guest_name}</p>
                        <span className="text-xs text-muted-foreground">· {b.country}</span>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground"><Users className="h-3 w-3" />{b.guests}</span>
                        {b.confirmed
                          ? <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"><CheckCircle2 className="h-3 w-3" /> Confirmed</span>
                          : <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"><Clock className="h-3 w-3" /> Pending</span>
                        }
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{b.phone}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span className="font-medium">{format(parseISO(b.check_in), "MMM d")} → {format(parseISO(b.check_out), "MMM d, yyyy")}</span>
                        <span>{b.nights} night{b.nights !== 1 ? "s" : ""}</span>
                        <span className="font-semibold text-emerald-600">€{Number(b.total_price).toFixed(2)}</span>
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                      {isOngoing ? "Ongoing" : `in ${differenceInDays(parseISO(b.check_in), today)}d`}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {pastBookings.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-500">Past Reservations</h3>
          {pastBookings.map(b => (
            <Card key={b.id} className="opacity-70">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-gray-700">{b.guest_name}</p>
                      <span className="text-xs text-muted-foreground">· {b.country}</span>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground"><Users className="h-3 w-3" />{b.guests}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span>{format(parseISO(b.check_in), "MMM d")} → {format(parseISO(b.check_out), "MMM d, yyyy")}</span>
                      <span>{b.nights} night{b.nights !== 1 ? "s" : ""}</span>
                      <span className="font-semibold text-gray-600">€{Number(b.total_price).toFixed(2)}</span>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                    {b.confirmed ? "Confirmed" : "Unconfirmed"}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
