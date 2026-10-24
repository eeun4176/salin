/**
 * Owner Suggestions Hook
 * The owners known on this phone (census, the program request, stubs),
 * loaded once per page for the owner-name suggestions.
 */

import { useEffect, useState } from "react";

import { deviceOwners, type OwnerSuggestion } from "@/core/programs/owner-suggestions";
import { useAuthStore } from "@/stores/auth-store";

export function useOwnerSuggestions() {
  const account = useAuthStore((state) => state.session?.key);
  const [owners, setOwners] = useState<OwnerSuggestion[]>([]);
  useEffect(() => {
    if (!account) return;
    let live = true;
    void deviceOwners(account).then((all) => live && setOwners(all), (failure: unknown) => console.error(failure));
    return () => {
      live = false;
    };
  }, [account]);
  return owners;
}
