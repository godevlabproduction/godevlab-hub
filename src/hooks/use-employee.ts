import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { getCurrentEmployee } from "@/lib/supabase/queries";

export function useCurrentEmployee() {
  const supabase = createClient();
  return useQuery({
    queryKey: ["current-employee"],
    queryFn: () => getCurrentEmployee(supabase),
  });
}
