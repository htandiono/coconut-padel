"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { etagFromRevision, type ClientSnapshot } from "@/lib/snapshot";

export function useLiveSnapshot(slug: string, initial: ClientSnapshot) {
  const [snapshot, setSnapshot] = useState(initial);
  const revisionRef = useRef(initial.revision);
  const etagRef = useRef(etagFromRevision(initial.revision));
  const inFlight = useRef(false);
  const mutating = useRef(false);

  const applySnapshot = useCallback((next: ClientSnapshot) => {
    revisionRef.current = next.revision;
    etagRef.current = etagFromRevision(next.revision);
    setSnapshot(next);
  }, []);

  const refresh = useCallback(async () => {
    if (mutating.current || inFlight.current) return;
    if (document.visibilityState === "hidden") return;

    inFlight.current = true;
    try {
      const response = await fetch(`/api/t/${slug}`, {
        cache: "no-store",
        headers: { "If-None-Match": etagRef.current },
      });
      if (response.status === 304) return;

      const nextEtag = response.headers.get("etag");
      if (nextEtag) etagRef.current = nextEtag;
      if (!response.ok) return;

      const data = (await response.json()) as ClientSnapshot;
      if (!data.revision || data.revision === revisionRef.current) return;
      applySnapshot(data);
    } catch {
      // Keep the last good board if a poll drops on a flaky connection.
    } finally {
      inFlight.current = false;
    }
  }, [applySnapshot, slug]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [refresh]);

  useEffect(() => {
    if (snapshot.tournament.status === "finished") return;
    const intervalMs = snapshot.tournament.status === "live" ? 2500 : 4000;
    const timer = window.setInterval(() => {
      void refresh();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [refresh, snapshot.tournament.status]);

  return {
    snapshot,
    applySnapshot,
    setMutating: (value: boolean) => {
      mutating.current = value;
    },
  };
}
