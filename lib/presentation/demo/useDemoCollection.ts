'use client';

import { useCallback, useState } from 'react';

// A tiny, session-only in-memory list for demo rows added during a walkthrough.
// It lives purely in React state — nothing is persisted to the browser and
// nothing is sent anywhere, so refreshing the page clears it. Used by the Phase
// 5B demo workflows (add product / stock / return / expense) so a presenter can
// show a record being created and then reset between takes, without ever
// touching a real record.

export function useDemoCollection<T>() {
  const [items, setItems] = useState<T[]>([]);

  // Newest first, so a freshly "recorded" demo row appears at the top.
  const add = useCallback((item: T) => setItems((xs) => [item, ...xs]), []);
  const reset = useCallback(() => setItems([]), []);

  return { items, add, reset, count: items.length };
}
