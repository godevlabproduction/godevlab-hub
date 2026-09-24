import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { getUnreadNotificationCount } from "@/lib/supabase/queries";

// Number of unread notifications for the signed-in user. Shared by the sidebar
// badge and the Inbox page (the Inbox invalidates this key after every change).
export function useUnreadCount() {
  const supabase = createClient();
  return useQuery({
    queryKey: ["notifications-unread"],
    queryFn: () => getUnreadNotificationCount(supabase),
    refetchInterval: 30000,
  });
}
